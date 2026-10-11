'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadPageDefinition(app) {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => app;
  global.wx = {
    showToast() {},
    getStorageSync() { return null; },
    setStorageSync() {},
    getWindowInfo() { return { windowHeight: 800, statusBarHeight: 44 }; },
    getMenuButtonBoundingClientRect() { return { top: 48, height: 32, width: 87, right: 360 }; }
  };
  const modulePath = require.resolve('../../pages/main-pages/partnerMode/specialMove/index');
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition, data) {
  const page = {
    ...definition,
    data: { ...definition.data, ...data },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (typeof callback === 'function') callback();
    }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key].bind(page);
  });
  page._jumpToActionCard = () => {};
  page.loadRoomData = async () => {};
  page._stopStatePolling = () => {};
  page._returnToGamepage = async () => {};
  return page;
}

async function withRuntime(app, run) {
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  global.getApp = () => app;
  global.wx = { showToast() {} };
  try {
    return await run();
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
}

function fixture() {
  const commands = [];
  const app = { globalData: {} };
  let preview = null;
  let revision = 2;
  app.globalData.roomId = '12345678';
  app.globalData.roomSession = {
    roomId: '12345678',
    getSnapshot: () => ({
      ok: true,
      revision,
      roomId: '12345678',
      roomState: { partnerGamePhase: 'closing', partnerSpecialMovePreview: preview },
      view: { route: { name: 'closingStatement', params: {} } }
    }),
    getView: () => ({
      actor: { capabilities: { USE_PARTNER_SPECIAL: { allowed: true } } },
      session: { sessionId: 's1', activeTurn: { turnId: 't1' } }
    }),
    dispatch: async (command) => {
      commands.push(command);
      if (command.type === 'SET_PARTNER_SPECIAL_PREVIEW') {
        preview = command.payload.active ? 'HELP_LUCK' : null;
        revision += 1;
      }
      return { ok: true, outcome: { committedThroughSeq: revision } };
    }
  };
  const definition = loadPageDefinition(app);
  const page = makePage(definition, {
    roomId: '12345678', sessionId: 's1', turnId: 't1', currentRound: 1,
    selectedAction: 'helpLuck', viewMode: 'wheel'
  });
  return { app, page, commands };
}

test('反面随机拼预览和返回转盘同步预览状态但不消耗特殊行动', async () => {
  const { app, page, commands } = fixture();
  await withRuntime(app, async () => {
    await page.handleConfirm();
    assert.equal(page.data.viewMode, 'reverseRandom');
    assert.equal(commands.length, 1);
    assert.equal(commands[0].type, 'SET_PARTNER_SPECIAL_PREVIEW');
    assert.deepEqual(commands[0].payload, { kind: 'HELP_LUCK', active: true });

    await page.handleGoBack();
    assert.equal(page.data.viewMode, 'wheel');
    assert.equal(commands.length, 2);
    assert.equal(commands[1].type, 'SET_PARTNER_SPECIAL_PREVIEW');
    assert.deepEqual(commands[1].payload, { kind: 'HELP_LUCK', active: false });
    assert.equal(commands.some((command) => command.type === 'USE_PARTNER_SPECIAL'), false,
      '预览和返回转盘都不应消耗特殊行动');
  });
});

test('反面随机拼只在取消采用或采用卡组时消耗特殊行动', async () => {
  for (const action of ['handleCancelAdopt', 'handleAdoptDeck']) {
    const { app, page, commands } = fixture();
    page.setData({ viewMode: 'reverseRandom' });
    await withRuntime(app, async () => page[action]());
    assert.equal(commands.length, 1, `${action} 应当只发送一次指令`);
    assert.equal(commands[0].type, 'USE_PARTNER_SPECIAL');
    assert.deepEqual(commands[0].payload, { kind: 'HELP_LUCK' });
  }
});

test('反面随机拼预览从完整 Snapshot 恢复，返回转盘同步清除，旧 View 不覆盖新屏幕', async () => {
  const { app, page, commands } = fixture();
  const definition = loadPageDefinition(app);
  page.loadRoomData = definition.loadRoomData.bind(page);
  page._checkProblemTextOverflow = page._syncAvatarTimerFromRoom = page._applyRoundSummaries = () => {};
  page._normalizeRoundSummaries = () => [];
  const members = [{ memberId: 'm1', playerIndex: 1, seatNo: 1, isMe: true, isHost: false, nickName: '玩家1' }];
  let snapshot = { ok: true, roomId: '12345678', revision: 20, members,
    roomState: { sessionId: 's1', currentPlayerIndex: 1, currentRound: 1,
      partnerGamePhase: 'play', partnerSpecialMovePreview: 'HELP_LUCK' },
    view: { route: { name: 'partnerGame' }, actor: { memberId: 'm1', seatNo: 1 },
      session: { sessionId: 's1', activeTurn: { turnId: 't1', specialPreview: 'HELP_LUCK' } } } };
  app.globalData.roomSession.getState = () => ({ status: 'READY', roomId: '12345678', lastRequestCompletedAt: Date.now() });
  app.globalData.roomSession.getSnapshot = () => snapshot;
  await withRuntime(app, async () => {
    await page.loadRoomData();
    assert.equal(page.data.viewMode, 'reverseRandom');
    assert.equal(page.data.selectedAction, 'helpLuck');
    const old = snapshot;
    app.globalData.roomSession.dispatch = async (command) => {
      commands.push(command);
      snapshot = { ...snapshot, revision: 21, roomState: { ...snapshot.roomState, partnerSpecialMovePreview: null } };
      return { ok: true, outcome: { committedThroughSeq: 21 } };
    };
    await page.handleGoBack();
    assert.equal(commands[0].type, 'SET_PARTNER_SPECIAL_PREVIEW');
    assert.equal(commands[0].payload.active, false);
    assert.equal(page.data.viewMode, 'wheel');
    app.globalData.roomSession.getSnapshot = () => old;
    await page.loadRoomData();
    assert.equal(page.data.viewMode, 'wheel', '迟到的旧 Snapshot 不得恢复已清除的预览');
  });
});

test('在线叠层订阅消费 Event 归约后的完整 View，与 Snapshot 恢复同一预览屏幕', async () => {
  const { app, page, commands } = fixture();
  const definition = loadPageDefinition(app);
  let listener;
  app.globalData.roomSession.getState = () => ({ status: 'READY', roomId: '12345678' });
  app.globalData.roomSession.subscribe = (callback) => { listener = callback; return () => {}; };
  page._startSoundLevelSampling = page._syncAvatarTimerFromRoom = page._applyRoundSummaries = () => {};
  page._normalizeRoundSummaries = () => [];
  const oldPages = global.getCurrentPages;
  global.getCurrentPages = () => [
    { route: 'pages/main-pages/partnerMode/gamepage/index', data: {} },
    { route: 'pages/main-pages/partnerMode/specialMove/index', data: {} }
  ];
  const restored = { ok: true, revision: 30, roomId: '12345678',
    roomState: { sessionId: 's1', currentRound: 1, currentPlayerIndex: 1,
      partnerGamePhase: 'play', partnerSpecialMovePreview: 'HELP_LUCK' },
    view: { route: { name: 'partnerGame', params: {} } } };
  try {
    await withRuntime(app, async () => {
      definition._startStatePolling.call(page);
      await new Promise((resolve) => setImmediate(resolve));
      listener(restored);
      assert.equal(page.data.viewMode, 'reverseRandom');
      assert.equal(page.data.selectedAction, 'helpLuck');
      listener({ ...restored, revision: 31,
        roomState: { ...restored.roomState, partnerSpecialMovePreview: null } });
      assert.equal(page.data.viewMode, 'wheel');
      listener(restored);
      assert.equal(page.data.viewMode, 'wheel', '旧订阅回调不能复活已经清除的预览');
      assert.equal(commands.length, 0, '消费 View 不得反向发送预览指令');
    });
  } finally {
    global.getCurrentPages = oldPages;
    if (page._roomSessionUnsub) page._roomSessionUnsub();
  }
});

test('旧 silent URL 重建叠层时，权威静默已结束仍须退出，不依赖本地计时已启动', async () => {
  const { page } = fixture();
  page.setData({ viewMode: 'silent', silentTimerActive: false });
  page._joinSilent = true;
  const exits = [];
  page._closeSpecialOverlay = async (snapshot) => { exits.push(snapshot.revision); return { ok: true }; };
  const current = { ok: true, revision: 9,
    roomState: { partnerSilentMode: false, partnerGamePhase: 'play' },
    view: { route: { name: 'partnerGame', params: {} } } };
  assert.equal(page._applySpecialView(current), false, '过期叠层不再启动旧屏幕副作用');
  assert.deepEqual(exits, [9]);
  assert.equal(page._applySpecialView(current), false);
  assert.deepEqual(exits, [9], '首屏读取与订阅消费同一 View 不能重复关闭页面');
  assert.equal(page._applySpecialView({ ...current, revision: 8 }), false);
  assert.deepEqual(exits, [9], '迟到 View 不应再次退出或恢复旧屏幕');
});

test('主动结束静默时，订阅退出与按钮返回共享一次在途导航', async () => {
  const { app, page } = fixture();
  const definition = loadPageDefinition(app);
  page._returnToGamepage = definition._returnToGamepage.bind(page);
  page._redirectToGamepageFromRoom = definition._redirectToGamepageFromRoom.bind(page);
  page.setData({ viewMode: 'silent', isCurrentPlayer: true, silentTimerActive: true });
  page._stopSilentTimerUi = () => page.setData({ silentTimerActive: false });
  app.globalData.roomSession.dispatch = async () => {
    page._applySpecialView({ ok: true, revision: 41,
      roomState: { partnerSilentMode: false, partnerGamePhase: 'play' },
      view: { route: { name: 'partnerGame', params: {} } } });
    return { ok: true };
  };
  const originalPages = global.getCurrentPages;
  global.getCurrentPages = () => [
    { route: 'pages/main-pages/partnerMode/gamepage/index', data: {} },
    { route: 'pages/main-pages/partnerMode/specialMove/index', data: {} }
  ];
  const navigations = [];
  try {
    await withRuntime(app, async () => {
      global.wx.navigateBack = (options) => navigations.push(options);
      const ending = page._endSilent();
      try {
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(navigations.length, 1, 'Command 发布 View 后的按钮回调不能再次弹栈');
        assert.equal(page._endingSilent, true, '仍等待已发起的导航完成');
      } finally {
        navigations.forEach((options) => options.success({}));
        await ending;
      }
      assert.equal(page._endingSilent, false);
      await page._returnToGamepage();
      assert.equal(navigations.length, 1, '成功关闭后迟到的同一返回意图也不能再次导航');
    });
  } finally {
    global.getCurrentPages = originalPages;
  }
});

test('叠层关闭失败后可用同一权威 View 重试，成功后保持退出幂等', async () => {
  const { page } = fixture();
  let attempts = 0;
  let subscriptions = 0;
  page._startStatePolling = () => { subscriptions += 1; };
  page._closeSpecialOverlay = async () => ({ ok: ++attempts > 1 });
  assert.equal((await page._redirectToGamepageFromRoom({})).ok, false);
  assert.equal((await page._redirectToGamepageFromRoom({})).ok, true);
  assert.equal((await page._redirectToGamepageFromRoom({})).ok, true);
  assert.equal(attempts, 2);
  assert.equal(subscriptions, 1, '退出失败后重新订阅，后续 View 才能再次跟随');
});

test('跟随权威路由抛错后释放退出任务并恢复订阅，隐藏页面不重启订阅', async () => {
  const { page } = fixture();
  const failure = new Error('navigation failed');
  page._closeSpecialOverlay = async () => { throw failure; };
  let subscriptions = 0;
  page._startStatePolling = () => { subscriptions += 1; };
  await assert.rejects(page._redirectToGamepageFromRoom({}), (error) => error === failure);
  assert.equal(page._gamepageReturnPromise, null);
  assert.equal(subscriptions, 1);
  page._pageVisible = false;
  await assert.rejects(page._redirectToGamepageFromRoom({}), (error) => error === failure);
  assert.equal(page._gamepageReturnPromise, null);
  assert.equal(subscriptions, 1);
});

test('退出失败恢复真实订阅时不回放同一 View 循环导航，后续发布仍能重试', async () => {
  const { app, page } = fixture();
  const definition = loadPageDefinition(app);
  page._stopStatePolling = definition._stopStatePolling.bind(page);
  page.setData({ viewMode: 'silent' });
  let snapshot = { ok: true, revision: 50, roomId: '12345678',
    roomState: { partnerSilentMode: false, partnerGamePhase: 'play' },
    view: { route: { name: 'partnerGame', params: {} } } };
  const listeners = new Set();
  let subscriptions = 0;
  let attempts = 0;
  app.globalData.roomSession.getState = () => ({ status: 'READY', roomId: '12345678' });
  app.globalData.roomSession.getSnapshot = () => snapshot;
  // 与 RoomSession 一样，注册时同步回放当前完整 View，使用真实页面绑定器。
  app.globalData.roomSession.subscribe = (callback) => {
    subscriptions += 1;
    listeners.add(callback);
    callback(snapshot);
    return () => listeners.delete(callback);
  };
  page._closeSpecialOverlay = async () => {
    page._stopStatePolling();
    return { ok: ++attempts >= 3 };
  };
  const originalPages = global.getCurrentPages;
  global.getCurrentPages = () => [
    { route: 'pages/main-pages/partnerMode/gamepage/index', data: {} },
    { route: 'pages/main-pages/partnerMode/specialMove/index', data: {} }
  ];
  try {
    await withRuntime(app, async () => {
      page._startStatePolling();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(attempts, 1, '没有新发布时，失败后的订阅回放不得再次触发导航');
      assert.equal(subscriptions, 2, '失败后仍恢复订阅以接收后续 View');
      snapshot = { ...snapshot, revision: 51 };
      [...listeners].forEach((callback) => callback(snapshot));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(attempts, 2, '下一次权威发布应允许重试，但不循环重放');
      snapshot = { ...snapshot, revision: 52 };
      [...listeners].forEach((callback) => callback(snapshot));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(attempts, 3);
      assert.equal((await page._redirectToGamepageFromRoom(snapshot)).ok, true);
      assert.equal(attempts, 3, '成功关闭仍保持幂等');
    });
  } finally {
    global.getCurrentPages = originalPages;
    page._stopStatePolling();
  }
});

test('静默结束且权威路由已离开游戏时，跟随新路由而非重建旧 gamepage', async () => {
  const { app, page } = fixture();
  const definition = loadPageDefinition(app);
  page._redirectToGamepageFromRoom = definition._redirectToGamepageFromRoom.bind(page);
  page.setData({ viewMode: 'silent' });
  page._stopSilentTimerUi = () => {};
  const originalPages = global.getCurrentPages;
  global.getCurrentPages = () => [
    { route: 'pages/main-pages/partnerMode/gamepage/index', data: {} },
    { route: 'pages/main-pages/partnerMode/specialMove/index', data: {} }
  ];
  const navigations = [];
  try {
    await withRuntime(app, async () => {
      for (const name of ['navigateBack', 'redirectTo', 'reLaunch']) {
        global.wx[name] = (options) => { navigations.push([name, options.url]); options.success({}); };
      }
      await page._redirectToGamepageFromRoom({ ok: true, roomId: '12345678', revision: 100,
        roomState: { partnerSilentMode: false }, view: { route: { name: 'addPlayer', params: {} } } });
      assert.equal(navigations.length, 1);
      assert.equal(navigations[0][0], 'reLaunch');
      assert.match(navigations[0][1], /\/addPlayer\/index/);
    });
  } finally {
    global.getCurrentPages = originalPages;
  }
});

test('Master 完成后关闭本地叠层并复用下层 gamepage，不用 redirect 重建页面', async () => {
  const { app, page } = fixture();
  const definition = loadPageDefinition(app);
  page._returnToGamepage = definition._returnToGamepage.bind(page);
  page._redirectToGamepageFromRoom = definition._redirectToGamepageFromRoom.bind(page);

  const calls = [];
  const previousPages = global.getCurrentPages;
  global.getCurrentPages = () => [
    { route: 'pages/main-pages/partnerMode/gamepage/index', data: {} },
    { route: 'pages/main-pages/partnerMode/specialMove/index', data: {} }
  ];
  try {
    await withRuntime(app, async () => {
      global.wx = {
        showToast() {},
        navigateBack(options) {
          calls.push('navigateBack');
          options.success({});
        },
        redirectTo(options) {
          calls.push('redirectTo');
          options.success({});
        },
        reLaunch(options) {
          calls.push('reLaunch');
          options.success({});
        }
      };
      const result = await page._returnToGamepage();
      assert.equal(result.ok, true);
      assert.deepEqual(calls, ['navigateBack']);
    });
  } finally {
    global.getCurrentPages = previousPages;
  }
});

test('进入收尾阶段后关闭本地叠层，由下层 RoomShell 消费权威 View', async () => {
  const { app, page, commands } = fixture();
  let returnedState = null;
  page._redirectToGamepageFromRoom = async (snapshot) => {
    returnedState = snapshot.roomState;
    return { ok: true };
  };

  await withRuntime(app, async () => page.activateClosing());

  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'USE_PARTNER_SPECIAL');
  assert.deepEqual(commands[0].payload, { kind: 'CLOSING' });
  assert.deepEqual(returnedState, { partnerGamePhase: 'closing', partnerSpecialMovePreview: null });
});

test('收尾 Command 同步发布真实订阅时，只弹栈一次，不与全局 redirect 竞争', async () => {
  const { app, page } = fixture();
  const definition = loadPageDefinition(app);
  page._stopStatePolling = definition._stopStatePolling.bind(page);
  page._startSoundLevelSampling = () => {};
  page._syncAvatarTimerFromRoom = page._syncSilentCardFeedback = () => {};
  page._pageVisible = true;
  let snapshot = { ok: true, roomId: '12345678', revision: 1000,
    members: [{ isMe: true, playerIndex: 1 }],
    roomState: { currentPlayerIndex: 1, currentPage: 'gamepage', partnerGamePhase: 'play' },
    view: { route: { name: 'partnerGame', params: {} } } };
  const listeners = new Set();
  app.globalData.roomSession.getState = () => ({ status: 'READY', roomId: '12345678' });
  app.globalData.roomSession.getSnapshot = () => snapshot;
  app.globalData.roomSession.subscribe = (callback) => {
    listeners.add(callback);
    callback(snapshot);
    return () => listeners.delete(callback);
  };
  app.globalData.roomSession.dispatch = async () => {
    snapshot = { ...snapshot, revision: 1001,
      roomState: { ...snapshot.roomState, currentPage: 'closingstatement', partnerGamePhase: 'closing' },
      view: { route: { name: 'closingStatement', params: {} } } };
    [...listeners].forEach((callback) => callback(snapshot));
    return { ok: true, outcome: { committedThroughSeq: 1001 } };
  };
  const originalPages = global.getCurrentPages;
  global.getCurrentPages = () => [
    { route: 'pages/main-pages/partnerMode/gamepage/index', data: {} },
    { route: 'pages/main-pages/partnerMode/specialMove/index', data: {} }
  ];
  const calls = [];
  const callbacks = [];
  try {
    await withRuntime(app, async () => {
      global.wx.navigateBack = (options) => { calls.push('navigateBack'); options.success({}); };
      global.wx.redirectTo = (options) => { calls.push('redirectTo'); callbacks.push(options); };
      try {
        page._startStatePolling();
        await new Promise((resolve) => setImmediate(resolve));
        await page.activateClosing();
        assert.deepEqual(calls, ['navigateBack'], '真实订阅与按钮必须共享同一次叠层退出');
      } finally {
        callbacks.forEach((options) => options.success({}));
        page._stopStatePolling();
      }
    });
  } finally {
    global.getCurrentPages = originalPages;
  }
});

test('特殊行动页点击设计问题进入详情并传递当前情境', async () => {
  const { app, page } = fixture();
  const selectedBG = { title: '通勤途中', content: '用户正在赶时间' };
  app.globalData.roomSession.getView = () => ({
    session: {
      setup: {
        selectedProblem: { contributionId: 'problem-1' },
        scenario: selectedBG
      }
    }
  });
  page.setData({ selectedProblemText: '如何改善通勤体验？' });

  let navigationOptions = null;
  let channelEvent = null;
  await withRuntime(app, async () => {
    global.wx = {
      showToast() {},
      navigateTo(options) {
        navigationOptions = options;
        options.success({
          eventChannel: {
            emit(name, payload) {
              channelEvent = { name, payload };
            }
          }
        });
      }
    };
    const result = await page.handleViewSituation();
    assert.equal(result.ok, true);
  });

  assert.match(navigationOptions.url, /partnerMode\/confirmBG\/index/);
  assert.match(navigationOptions.url, /from=specialMove/);
  assert.match(navigationOptions.url, /currentPlayerIndex=1/);
  assert.match(navigationOptions.url, /problemText=/);
  assert.deepEqual(channelEvent, {
    name: 'initGameDetail',
    payload: {
      problemText: '如何改善通勤体验？',
      problemId: 'problem-1',
      selectedBG
    }
  });
  assert.deepEqual(app.globalData.selectedProblem, {
    id: 'problem-1',
    text: '如何改善通勤体验？'
  });
  assert.equal(app.globalData.selectedBG, selectedBG);
});

test('特殊行动页设计问题区域绑定详情导航', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/specialMove/index.wxml'),
    'utf8'
  );
  assert.match(wxml, /class="problem-chip[^\"]*"[\s\S]*?bindtap="handleViewSituation"/);

  const detailPageJs = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/confirmBG/index.js'),
    'utf8'
  );
  assert.match(detailPageJs, /from === 'specialMove'/);
  assert.match(detailPageJs, /expectedPrev: 'pages\/main-pages\/partnerMode\/specialMove\/index'/);
});
