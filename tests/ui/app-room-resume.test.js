'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHarness } = require('../helpers/room-v3');
const { ensureRoomSession } = require('../../modules/room-session');
const { withRoomLocalScreens } = require('../../modules/room-session/local-screens');
const createCardLibrary = require('../../packageSpy/pages/cardLibrary/controller');
const { beginScanJoinFromLaunch, endScanJoin, isScanJoinActive } = require('../../utils/scanJoinGate');

test('牌库挂起期间房主取消模式：普通前台恢复保留连接并关闭过期辅助屏幕', async () => {
  const previous = { wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'SPY' } });
  const sessionId = (await h.snapshot('host')).view.session.sessionId;
  const appPath = path.resolve(__dirname, '../../app.js');
  let app;
  const navigated = [];
  global.wx = {
    getStorageSync() {}, setStorageSync() {}, showToast() {}, showLoading() {}, hideLoading() {},
    redirectTo(options) { navigated.push(options.url); options.success({}); },
    reLaunch(options) { navigated.push(options.url); options.success({}); },
    cloud: { init() {}, async callFunction({ name, data }) {
      assert.equal(name, 'roomQuery', '普通恢复和辅助屏幕关闭不能提交业务指令');
      const actor = { userId: 'u2' };
      if (data.action === 'current') return { result: await h.app.readCurrentRoom(actor) };
      if (data.action === 'snapshot') return { result: await h.app.readSnapshot(data.roomId, actor) };
      if (data.action === 'sync') return { result: await h.app.sync(data.roomId, data.afterSeq, actor) };
      assert.fail(`unexpected query ${data.action}`);
    } }
  };
  vm.runInNewContext(fs.readFileSync(appPath, 'utf8'), {
    wx: global.wx, App: (definition) => { app = definition; }, require: createRequire(appPath), console
  }, { filename: appPath });
  global.getApp = () => app;
  endScanJoin();
  app.onLaunch({ path: 'pages/main-pages/aaa/index', scene: 1001, query: {} });
  const definition = withRoomLocalScreens({ data: { roomId: '12345678' } }, {
    '/library': { name: 'library', routes: ['spyIntro'], create: createCardLibrary }
  });
  const page = { ...definition, route: 'packageSpy/pages/modeIndex/index',
    data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }
  };
  global.getCurrentPages = () => [page];
  page.onLoad({ roomId: '12345678', phase: 'SPY_INTRO' });
  page.onShow();
  const session = ensureRoomSession();
  try {
    await session.open();
    const opened = page._localScreens.open('/library?roomId=12345678');
    page._localScreens.ready(page.data.localScreens.at(-1).token, {});
    await opened;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.localScreenActive, true);
    app.onHide();
    page.onHide();
    assert.equal((await h.command('host', 'CANCEL_WORKSHOP_SESSION', { context: { sessionId } })).ok, true);
    // 真实工具的普通恢复会携带当前物理页的 URL 参数；它不是扫码入房意图。
    app.onShow({ path: page.route, scene: 1001, query: { roomId: '12345678', phase: 'SPY_INTRO' } });
    page.onShow();
    await ensureRoomSession().refresh();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ensureRoomSession().getView().route.name, 'subAwait');
    assert.equal(page.data.localScreenActive, false, '最新 Snapshot 必须关闭已经失效的牌库');
    assert.ok(navigated.some((url) => url.startsWith('/pages/sub-pages/subAwait/index')));
  } finally {
    page.onUnload();
    session.dispose();
    ensureRoomSession().dispose();
    endScanJoin();
    Object.assign(global, previous);
  }
});

test('业务页和历史回顾的 URL 不是入房意图，普通恢复不建立扫码闸门', () => {
  try {
    for (const path of [
      'packageSpy/pages/modeIndex/index', 'packageSpy/pages/speak/index',
      'pages/main-pages/modeIndex/index', 'pages/main-pages/submitProblem/index',
      'pages/main-pages/selectPlayer/index', 'pages/main-pages/partnerMode/gamepage/index',
      'pages/main-pages/halliGalli/gamepage/index', 'pages/sub-pages/subAwait/index'
    ]) {
      endScanJoin();
      assert.equal(beginScanJoinFromLaunch({ path, scene: 1001, query: { roomId: '12345678' } }), '');
      assert.equal(isScanJoinActive(), false, path);
    }
    for (const path of ['pages/main-pages/aaa/index', '/pages/main-pages/addPlayer/index']) {
      endScanJoin();
      assert.equal(beginScanJoinFromLaunch({ path, scene: 1001, query: { roomId: '12345678' } },
        { currentRoomId: '12345678' }), '');
      assert.equal(isScanJoinActive(), false, '已经连接的房间只恢复 Snapshot，不重新加入');
    }
  } finally { endScanJoin(); }
});

test('首次入房与扫码进入另一房间仍建立入房闸门，兼容既有入口参数', () => {
  try {
    for (const query of [
      { scene: 'rid%3D87654321' }, { scene: 'roomId=87654321' },
      { roomId: '87654321' }, { rid: '87654321' }
    ]) {
      endScanJoin();
      assert.equal(beginScanJoinFromLaunch({ path: 'pages/main-pages/addPlayer/index', scene: 1047, query },
        { currentRoomId: '12345678' }), '87654321');
      assert.equal(isScanJoinActive('87654321'), true);
    }
    endScanJoin();
    assert.equal(beginScanJoinFromLaunch({ path: 'pages/main-pages/aaa/index', scene: 1001,
      query: { roomId: '12345678' } }), '12345678');
    assert.equal(isScanJoinActive('12345678'), true, '冷启动的真实入房仍受保护');
  } finally { endScanJoin(); }
});
