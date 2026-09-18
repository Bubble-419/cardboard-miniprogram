'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNavigationCoordinator } = require('../../modules/room-navigation/index');
const { followRoomRouteAfterCommand } = require('../../modules/room-session/index');

async function withCurrentRoute(route, data, run, extra) {
  const previous = global.getCurrentPages;
  global.getCurrentPages = () => [{ route, data: data || {}, ...(extra || {}) }];
  try {
    return await run();
  } finally {
    global.getCurrentPages = previous;
  }
}

test('导航事件水位按 roomId 隔离，换房后低 seq 仍可驱动页面', async () => {
  const previousGetCurrentPages = global.getCurrentPages;
  global.getCurrentPages = () => [];
  const opened = [];
  try {
    const navigation = createNavigationCoordinator({
      open: async (descriptor) => { opened.push(descriptor.url); }
    });
    await navigation.reconcile({ name: 'modeIndex', params: {} }, 100, { roomId: '11111111' });
    await navigation.reconcile({ name: 'addPlayer', params: {} }, 1, { roomId: '22222222' });
    assert.deepEqual(opened, [
      '/pages/main-pages/modeIndex/index?roomId=11111111',
      '/pages/main-pages/addPlayer/index?roomId=22222222'
    ]);
    assert.equal(navigation.getLastRoomId(), '22222222');
    assert.equal(navigation.getLastSeq(), 1);
  } finally {
    global.getCurrentPages = previousGetCurrentPages;
  }
});

test('选模式叠层在无 Session 时不被拉回大厅，START 后跟随 view.route', async () => {
  const opened = [];
  const navigation = createNavigationCoordinator({
    open: async (descriptor) => { opened.push(descriptor.url); }
  });
  await withCurrentRoute('pages/main-pages/brainstormMode/index', {}, async () => {
    const stay = await navigation.reconcile({ name: 'addPlayer', params: {} }, 1, { roomId: '12345678' });
    assert.equal(stay.reason, 'LOCAL_OVERLAY');
    assert.deepEqual(opened, []);
    const leave = await navigation.reconcile({ name: 'modeIndex', params: {} }, 2, { roomId: '12345678' });
    assert.equal(leave.ok, true);
    assert.equal(opened.pop(), '/pages/main-pages/modeIndex/index?roomId=12345678');
  });
});

test('情境填写叠层停在 CHOOSE_SCENARIO，SET_SCENARIO 后跟随下一页', async () => {
  const opened = [];
  const navigation = createNavigationCoordinator({
    open: async (descriptor) => { opened.push(descriptor.url); }
  });
  await withCurrentRoute('pages/main-pages/selectBG/index', {}, async () => {
    const stay = await navigation.reconcile({ name: 'modeIndex', params: {} }, 3, { roomId: '12345678' });
    assert.equal(stay.reason, 'LOCAL_OVERLAY');
    const leave = await navigation.reconcile({ name: 'selectPlayer', params: {} }, 4, { roomId: '12345678' });
    assert.equal(leave.ok, true);
    assert.equal(opened.pop(), '/pages/main-pages/selectPlayer/index?roomId=12345678');
  });
});

test('回看情境叠层不被游戏同步拆掉，回大厅时关闭', async () => {
  const opened = [];
  const navigation = createNavigationCoordinator({
    open: async (descriptor) => { opened.push(descriptor.url); }
  });
  await withCurrentRoute('pages/main-pages/partnerMode/confirmBG/index', { fromGameView: true }, async () => {
    const stay = await navigation.reconcile({ name: 'partnerGame', params: {} }, 8, { roomId: '12345678' });
    assert.equal(stay.reason, 'LOCAL_OVERLAY');
    assert.deepEqual(opened, []);
  });
  await withCurrentRoute('pages/inspiration/index', {}, async () => {
    const leave = await navigation.reconcile({ name: 'addPlayer', params: {} }, 9, { roomId: '12345678' });
    assert.equal(leave.ok, true);
    assert.equal(opened.pop(), '/pages/main-pages/addPlayer/index?roomId=12345678');
  });
});

test('提交设计问题回看情境叠层仍归属 submitProblem', async () => {
  const opened = [];
  const navigation = createNavigationCoordinator({
    open: async (descriptor) => { opened.push(descriptor.url); }
  });
  await withCurrentRoute(
    'pages/main-pages/partnerMode/confirmBG/index',
    { from: 'submit', fromGameView: true },
    async () => {
      const stay = await navigation.reconcile({ name: 'submitProblem', params: {} }, 11, { roomId: '12345678' });
      assert.equal(stay.reason, 'LOCAL_OVERLAY');
      assert.deepEqual(opened, []);
    },
    { _fromGameView: true, _fromSource: 'submit' }
  );
});

test('情境等待页在进入收集问题后跟随到提交设计问题', async () => {
  const opened = [];
  const navigation = createNavigationCoordinator({
    open: async (descriptor) => { opened.push(descriptor.url); }
  });
  await withCurrentRoute('pages/sub-pages/subAwait/index', { scene: 'bg' }, async () => {
    const stay = await navigation.reconcile(
      { name: 'subAwait', params: { scene: 'bg', phase: 'CHOOSE_SCENARIO' } },
      5,
      { roomId: '12345678' }
    );
    assert.equal(stay.reason, 'SAME_ROUTE');
    const leave = await navigation.reconcile(
      { name: 'submitProblem', params: { phase: 'COLLECT_DESIGN_PROBLEMS' } },
      6,
      { roomId: '12345678' }
    );
    assert.equal(leave.ok, true);
    assert.equal(
      opened.pop(),
      '/pages/main-pages/submitProblem/index?roomId=12345678&phase=COLLECT_DESIGN_PROBLEMS'
    );
  });
});

test('跟随跳转失败不得抬高水位，后续同步还能再试', async () => {
  let attempts = 0;
  const navigation = createNavigationCoordinator({
    open: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('fail');
    }
  });
  await withCurrentRoute('pages/sub-pages/subAwait/index', {}, async () => {
    const first = await navigation.reconcile({ name: 'submitProblem', params: {} }, 6, { roomId: '12345678' });
    assert.equal(first.ok, false);
    assert.equal(first.reason, 'NAV_FAILED');
    assert.equal(navigation.getLastSeq(), 0);
    const second = await navigation.reconcile({ name: 'submitProblem', params: {} }, 6, { roomId: '12345678' });
    assert.equal(second.ok, true);
    assert.equal(attempts, 2);
    assert.equal(navigation.getLastSeq(), 6);
  });
});

test('相同状态变更触发的后续导航会等待在途导航完成', async () => {
  const previousGetCurrentPages = global.getCurrentPages;
  let currentRoute = 'pages/main-pages/modeIndex/index';
  global.getCurrentPages = () => [{ route: currentRoute, data: {} }];
  let completeFirst;
  const opened = [];
  try {
    const navigation = createNavigationCoordinator({
      open: async (descriptor) => {
        opened.push(descriptor.url);
        if (opened.length === 1) {
          await new Promise((resolve) => { completeFirst = resolve; });
        }
        currentRoute = descriptor.path.slice(1);
      }
    });
    const first = navigation.reconcile({ name: 'selectPlayer', params: {} }, 4, {
      roomId: '12345678'
    });
    await new Promise((resolve) => setImmediate(resolve));
    let followFinished = false;
    const follow = navigation.reconcile({ name: 'selectPlayer', params: {} }, 4, {
      roomId: '12345678'
    }).then((result) => {
      followFinished = true;
      return result;
    });
    await Promise.resolve();
    assert.equal(followFinished, false, '显式跟随必须等待订阅已经发起的导航');

    completeFirst();
    await first;
    const followed = await follow;
    assert.equal(followed.ok, true);
    assert.equal(followed.reason, 'SAME_ROUTE');
    assert.equal(opened.length, 1, '同一目标不能重复打开');
  } finally {
    global.getCurrentPages = previousGetCurrentPages;
  }
});

test('指令同步未到提交水位时先刷新 Snapshot 再跟随权威 route', async () => {
  const previousGetApp = global.getApp;
  const previousGetCurrentPages = global.getCurrentPages;
  const previousWx = global.wx;
  let refreshed = 0;
  let snapshot = {
    ok: true,
    roomId: '87654321',
    revision: 3,
    view: { route: { name: 'modeIndex', params: {} } }
  };
  let opened = '';
  global.getCurrentPages = () => [{ route: 'pages/main-pages/modeIndex/index', data: {} }];
  global.getApp = () => ({
    globalData: {
      roomSession: {
        getSnapshot: () => snapshot,
        refresh: async () => {
          refreshed += 1;
          snapshot = {
            ok: true,
            roomId: '87654321',
            revision: 4,
            view: { route: { name: 'selectPlayer', params: { phase: 'SELECT_FIRST_PLAYER' } } }
          };
          return snapshot;
        }
      }
    }
  });
  global.wx = {
    redirectTo(options) {
      opened = options.url;
      if (typeof options.success === 'function') options.success({});
      if (typeof options.complete === 'function') options.complete({});
    },
    reLaunch(options) {
      opened = options.url;
      if (typeof options.success === 'function') options.success({});
      if (typeof options.complete === 'function') options.complete({});
    }
  };
  try {
    const result = await followRoomRouteAfterCommand({
      ok: true,
      outcome: { committedThroughSeq: 4 }
    }, '87654321');
    assert.equal(result.ok, true);
    assert.equal(refreshed, 1);
    assert.match(opened, /^\/pages\/main-pages\/selectPlayer\/index\?/);
  } finally {
    global.getApp = previousGetApp;
    global.getCurrentPages = previousGetCurrentPages;
    global.wx = previousWx;
  }
});
