'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');
const { withLocalScreens } = require('../../modules/room-navigation/localScreens');
const { ensureRoomSession } = require('../../modules/room-session');
const createSpecialMove = require('../../pages/main-pages/partnerMode/specialMove/controller');
const createCase = require('../../pages/main-pages/case/controller');
const createCrop = require('../../pages/main-pages/partnerMode/imageCrop/controller');

// 只替换微信原生/云传输边界；控制器、宿主、RoomSession 和服务端投影均使用真实实现。
async function withRuntime(run) {
  const previous = { wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  const snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  const memberId = snapshot.view.actor.memberId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId }
  });
  await h.command('host', 'CONFIRM_FIRST_PLAYER', { context: { sessionId }, payload: { memberId } });
  const app = { globalData: { roomId: '12345678' } };
  const ticks = [], requests = [], imageReads = [], exports = [], toasts = [];
  global.getApp = () => app;
  global.wx = {
    nextTick: (callback) => ticks.push(callback),
    getWindowInfo: () => ({ windowHeight: 800, windowWidth: 375, statusBarHeight: 44 }),
    getSystemInfoSync: () => ({ windowHeight: 800, windowWidth: 375 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32, width: 87, right: 360 }),
    getStorageSync() {}, setStorageSync() {}, showLoading() {}, hideLoading() {},
    showToast: (options) => toasts.push(options),
    getImageInfo: (options) => imageReads.push(options),
    canvasToTempFilePath: (options) => exports.push(options),
    navigateTo() { assert.fail('辅助屏幕不应创建物理页面'); },
    redirectTo() { assert.fail('本地测量不应改变房间路由'); },
    reLaunch() { assert.fail('本地测量不应重建房间页面'); },
    cloud: { async callFunction({ name, data }) {
      requests.push({ name, data });
      assert.equal(name, 'roomQuery', '布局和本地返回不能发出业务 Command');
      const actor = { userId: 'host' };
      if (data.action === 'current') return { result: await h.app.readCurrentRoom(actor) };
      if (data.action === 'snapshot') return { result: await h.app.readSnapshot(data.roomId, actor) };
      if (data.action === 'sync') return { result: await h.app.sync(data.roomId, data.afterSeq, actor) };
      assert.fail(`unexpected query ${data.action}`);
    } }
  };
  const definition = withLocalScreens({ data: { roomId: '12345678', draft: '保留草稿' } }, {
    '/special': { name: 'special', routes: ['partnerGame'], create: createSpecialMove,
      intents: ['handleToggleProblemExpand'] },
    '/case': { name: 'case', routes: ['partnerGame'], create: createCase },
    '/crop': { name: 'crop', routes: ['partnerGame'], create: createCrop },
    '/detail': { name: 'detail', routes: ['partnerGame'], create: () => ({ data: {} }) }
  });
  const page = { ...definition, route: 'pages/main-pages/partnerMode/gamepage/index',
    data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }
  };
  global.getCurrentPages = () => [page];
  page.onLoad({ roomId: '12345678' });
  page.onShow();
  const session = ensureRoomSession();
  try {
    await session.open();
    session.pause(); // 测量竞态由测试推进，不等待实际两秒轮询。
    const before = await h.snapshot('host');
    const f = { page, host: page._localScreens, ticks, imageReads, exports, toasts, requests,
      async settle() { await new Promise((resolve) => setImmediate(resolve)); },
      flushTicks() { while (ticks.length) ticks.shift()(); },
      async mount(url, scope = queryScope(), options = {}) {
        const opened = this.host.open(url, options);
        this.host.ready(page.data.localScreens.at(-1).token, scope);
        assert.equal((await opened).ok, true);
        await this.settle();
        return this.host.current();
      },
      remount(scope) { this.host.ready(page.data.localScreens.at(-1).token, scope); }
    };
    await run(f);
    assert.deepEqual((await h.snapshot('host')).view, before.view, '布局、覆盖及返回不改变原有业务 View');
    assert.equal(page.data.draft, '保留草稿');
  } finally {
    page.onUnload();
    session.dispose();
    Object.assign(global, previous);
  }
}

// 可分别推进 nextTick、selector 回调和 canvas 回调，精确重现原生迟到响应。
function queryScope() {
  const scope = { queries: [] };
  scope.createSelectorQuery = () => {
    const selectors = [], rectCallbacks = [];
    const query = {
      select(selector) { selectors.push(selector); return query; },
      boundingClientRect(callback) { rectCallbacks.push(callback); return query; },
      fields() { return query; },
      exec(callback) {
        scope.queries.push({ selectors, finish(results) {
          rectCallbacks.forEach((handler, index) => { if (handler) handler(results[index]); });
          if (callback) callback(results);
        } });
      }
    };
    return query;
  };
  return scope;
}

function collapseProblem(f, screen) {
  screen.setData({ selectedProblemText: '需要折叠显示的长设计问题', problemExpanded: true });
  f.host.intent(f.page.data.localScreens.at(-1).token, 'handleToggleProblemExpand', {});
  assert.equal(screen.data.problemExpanded, false);
}

test('特殊行动的折叠测量排队后被详情覆盖，不访问已销毁作用域；返回重新测量', async () => {
  await withRuntime(async (f) => {
    const scope = queryScope();
    const screen = await f.mount('/special?roomId=12345678', scope);
    f.flushTicks();
    collapseProblem(f, screen);
    const detail = await f.mount('/detail');
    assert.doesNotThrow(() => f.flushTicks());
    assert.equal(scope.queries.length, 0);
    await f.host.close(detail);
    const restored = queryScope();
    f.remount(restored);
    f.flushTicks();
    assert.equal(restored.queries.length, 1, '重新 ready 后必须测量当前组件');
    restored.queries[0].finish([{ height: 20 }, { height: 80 }]);
    assert.equal(screen.data.problemTextOverflow, true);
  });
});

test('特殊行动旧 selector 结果在覆盖、同组件前后台循环或卸载后都不能刷新 UI', async () => {
  for (const transition of ['cover', 'background', 'unload']) {
    await withRuntime(async (f) => {
      const scope = queryScope();
      const screen = await f.mount('/special?roomId=12345678', scope);
      f.flushTicks();
      collapseProblem(f, screen);
      f.flushTicks();
      const old = scope.queries.at(-1);
      if (transition === 'cover') {
        const detail = await f.mount('/detail');
        await f.host.close(detail);
        f.remount(scope); // 即使 native scope 对象相同，也不是同一次可见生命周期。
      } else if (transition === 'background') {
        f.page.onHide();
        f.page.onShow();
      } else f.page.onUnload();
      old.finish([{ height: 20 }, { height: 80 }]);
      assert.equal(screen.data.problemTextOverflow, false, `${transition}: 旧结果无效`);
      if (transition !== 'unload') {
        f.flushTicks();
        scope.queries.at(-1).finish([{ height: 20 }, { height: 80 }]);
        assert.equal(screen.data.problemTextOverflow, true, '当前生命周期的新结果正常生效');
      }
    });
  }
});

test('案例排队测量及返回后迟到的旧高度不能覆盖当前滚动区域', async () => {
  await withRuntime(async (f) => {
    const oldScope = queryScope();
    const screen = await f.mount('/case?roomId=12345678', oldScope);
    const detail = await f.mount('/detail');
    assert.doesNotThrow(() => f.flushTicks());
    assert.equal(oldScope.queries.length, 0);
    await f.host.close(detail);
    const restored = queryScope();
    f.remount(restored);
    f.flushTicks();
    const old = restored.queries[0];
    f.page.onHide(); f.page.onShow(); f.flushTicks();
    restored.queries.at(-1).finish([{ height: 100 }]);
    old.finish([{ height: 500 }]);
    assert.equal(screen.data.scrollHeight, 700);
  });
});

test('裁图排队布局失效后不访问旧节点；返回重新测量且取消仅通知一次', async () => {
  await withRuntime(async (f) => {
    let cancelled = 0;
    const oldScope = queryScope();
    const screen = await f.mount('/crop?src=photo.jpg', oldScope, {
      events: { cropCancel: () => { cancelled += 1; } }
    });
    f.imageReads[0].success({ width: 800, height: 600 });
    const detail = await f.mount('/detail');
    assert.doesNotThrow(() => f.flushTicks());
    assert.equal(oldScope.queries.length, 0);
    await f.host.close(detail);
    const restored = queryScope();
    f.remount(restored); f.flushTicks();
    assert.equal(restored.queries.length, 1);
    restored.queries[0].finish([{ left: 0, top: 80, width: 375, height: 500 }]);
    assert.match(screen.data.cropStyle, /width:/);
    await screen.onCancel();
    assert.equal(cancelled, 1);
    assert.equal(f.host.current(), undefined);
  });
});

test('裁图返回重新挂载保留所选比例和原图区域；确认仍仅返回一次原有裁剪结果', async () => {
  await withRuntime(async (f) => {
    const scope = queryScope();
    const confirmed = [], cancelled = [];
    const screen = await f.mount('/crop?src=photo.jpg', scope, { events: {
      cropConfirm: (value) => confirmed.push(value), cropCancel: () => cancelled.push(true)
    } });
    f.imageReads[0].success({ width: 800, height: 600 });
    f.flushTicks();
    scope.queries[0].finish([{ left: 0, top: 80, width: 375, height: 500 }]);
    await screen.onSelectPreset({ currentTarget: { dataset: { preset: '16:9' } } });
    const ratioLabel = screen.data.ratioLabel;
    const detail = await f.mount('/detail');
    await f.host.close(detail);
    const restored = queryScope(); f.remount(restored); f.flushTicks();
    restored.queries[0].finish([{ left: 0, top: 80, width: 300, height: 400 }]);
    assert.equal(screen.data.activePreset, '16:9');
    assert.equal(screen.data.ratioLabel, ratioLabel);
    const saving = screen.onConfirm();
    await f.settle();
    const { canvas, image } = canvasFixture();
    restored.queries.at(-1).finish([{ node: canvas }]);
    image.onload();
    assert.equal(f.exports[0].destWidth, 800);
    assert.equal(f.exports[0].destHeight, 450, '缩放后的裁剪仍对应同一原图区域');
    f.exports[0].success({ tempFilePath: '/tmp/cropped.jpg' });
    await saving;
    assert.deepEqual(confirmed, [{ tempFilePath: '/tmp/cropped.jpg' }]);
    assert.equal(cancelled.length, 0);
    assert.equal(f.host.current(), undefined);
  });
});

test('裁图收到新的原图仍按原业务初始化为方形，不沿用上一张图的裁剪区域', async () => {
  await withRuntime(async (f) => {
    const scope = queryScope();
    const screen = await f.mount('/crop?src=photo.jpg', scope);
    f.imageReads[0].success({ width: 800, height: 600 }); f.flushTicks();
    scope.queries[0].finish([{ left: 0, top: 80, width: 375, height: 500 }]);
    await screen.onSelectPreset({ currentTarget: { dataset: { preset: '16:9' } } });
    screen.getOpenerEventChannel().emit('initCrop', { src: 'another.jpg' });
    f.imageReads[1].success({ width: 800, height: 600 }); f.flushTicks();
    scope.queries.at(-1).finish([{ left: 0, top: 80, width: 375, height: 500 }]);
    assert.equal(screen.data.activePreset, '1:1');
    assert.equal(screen.data.ratioLabel, '1 : 1');
  });
});

test('手动最小裁剪区在更小窗口恢复时不被重新放大，导出原图区域不变', async () => {
  await withRuntime(async (f) => {
    const scope = queryScope();
    const screen = await f.mount('/crop?src=photo.jpg', scope);
    f.imageReads[0].success({ width: 800, height: 600 }); f.flushTicks();
    scope.queries[0].finish([{ left: 0, top: 80, width: 375, height: 500 }]);
    screen.onStageTouchStart({ touches: [{ clientX: 328.125, clientY: 470.625 }] });
    screen.onStageTouchMove({ touches: [{ clientX: 110.875, clientY: 253.375 }] });
    screen.onStageTouchEnd();
    assert.match(screen.data.cropStyle, /width:64px/);
    const detail = await f.mount('/detail'); await f.host.close(detail);
    const restored = queryScope(); f.remount(restored); f.flushTicks();
    restored.queries[0].finish([{ left: 0, top: 80, width: 300, height: 400 }]);
    const saving = screen.onConfirm(); await f.settle();
    const { canvas, image } = canvasFixture();
    restored.queries.at(-1).finish([{ node: canvas }]); image.onload();
    assert.equal(f.exports[0].destWidth, 137);
    assert.equal(f.exports[0].destHeight, 137);
    f.exports[0].success({ tempFilePath: '/tmp/small.jpg' }); await saving;
  });
});

test('裁图 selector、图片加载和导出结果迟到时不再确认已关闭屏幕或干扰新屏幕', async () => {
  for (const stage of ['selector', 'image', 'export']) {
    await withRuntime(async (f) => {
      const scope = queryScope();
      const confirmed = [], cancelled = [];
      const screen = await f.mount('/crop?src=photo.jpg', scope, { events: {
        cropConfirm: (value) => confirmed.push(value), cropCancel: () => cancelled.push(true)
      } });
      f.imageReads[0].success({ width: 800, height: 600 }); f.flushTicks();
      scope.queries[0].finish([{ left: 0, top: 80, width: 375, height: 500 }]);
      const saving = screen.onConfirm();
      await f.settle();
      const query = scope.queries.at(-1);
      const { canvas, image } = canvasFixture();
      if (stage !== 'selector') query.finish([{ node: canvas }]);
      if (stage === 'export') image.onload();
      await f.host.close(screen);
      const next = await f.mount('/detail');
      if (stage === 'selector') query.finish([{ node: canvas }]);
      if (image.onload) image.onload();
      if (f.exports.length) f.exports[0].success({ tempFilePath: '/tmp/stale.jpg' });
      await saving;
      assert.equal(confirmed.length, 0, `${stage}: 已取消的裁图不能回写旧父屏幕`);
      assert.equal(cancelled.length, 1);
      assert.equal(f.host.current(), next);
      assert.equal(f.toasts.length, 0, '失效的查询不在新屏幕弹出裁剪错误');
    });
  }
});

test('裁图被覆盖后，即使原生 selector 不再回调，也立即结束旧导出并释放交互锁', async () => {
  await withRuntime(async (f) => {
    const scope = queryScope();
    const screen = await f.mount('/crop?src=photo.jpg', scope);
    f.imageReads[0].success({ width: 800, height: 600 }); f.flushTicks();
    scope.queries[0].finish([{ left: 0, top: 80, width: 375, height: 500 }]);
    let settled = false;
    const saving = screen.onConfirm().then(() => { settled = true; });
    await f.settle();
    const old = scope.queries.at(-1);
    const detail = await f.mount('/detail');
    await f.settle();
    assert.equal(settled, true, '组件已销毁，不能依赖不存在的回调释放锁');
    assert.equal(screen.data.exporting, false);
    assert.equal(screen.data.interactionLocked, false);
    await saving;
    await f.host.close(detail);
    const restored = queryScope(); f.remount(restored); f.flushTicks();
    restored.queries[0].finish([{ left: 0, top: 80, width: 375, height: 500 }]);
    const retry = screen.onConfirm(); await f.settle();
    const staleCanvas = canvasFixture();
    old.finish([{ node: staleCanvas.canvas }]);
    assert.equal(staleCanvas.image.src, undefined, '旧回调不能恢复已取消的原生工作');
    const { canvas, image } = canvasFixture();
    restored.queries.at(-1).finish([{ node: canvas }]); image.onload();
    f.exports[0].success({ tempFilePath: '/tmp/retry.jpg' });
    await retry;
    assert.equal(f.host.current(), undefined, '返回后仍可正常重新确认');
  });
});

function canvasFixture() {
  const image = {};
  const canvas = { createImage: () => image,
    getContext: () => ({ clearRect() {}, drawImage() {} }) };
  return { canvas, image };
}
