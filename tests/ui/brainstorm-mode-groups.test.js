'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadPageDefinition() {
  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  global.getApp = () => ({ globalData: {} });
  const modulePath = '../../pages/main-pages/brainstormMode/index';
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  return definition;
}

test('选择模式页按组件卡和模板卡分组，并保持指定顺序', () => {
  const definition = loadPageDefinition();
  assert.deepEqual(
    definition.data.modeGroups.map((group) => ({
      title: group.title,
      modes: group.modes.map((mode) => ({ id: mode.id, tag: mode.tag }))
    })),
    [
      {
        title: '组件卡',
        modes: [
          { id: 'ganDengYan', tag: '复习' },
          { id: 'partner', tag: '脑暴' }
        ]
      },
      {
        title: '模板卡',
        modes: [
          { id: 'spy', tag: '复习' },
          { id: 'halliGalli', tag: '脑暴' }
        ]
      }
    ]
  );

  const wxml = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/brainstormMode/index.wxml'
  ), 'utf8');
  assert.match(wxml, /wx:for="\{\{modeGroups\}\}"/);
  assert.match(wxml, /class="mode-group-title"[^>]*>\{\{group\.title\}\}/);
  assert.match(wxml, /wx:for="\{\{group\.modes\}\}"/);
  assert.match(wxml, /class="mode-cover"[^>]*mode="aspectFit"/);
  assert.match(wxml, /class="mode-tag">\{\{item\.tag\}\}/);
});

test('选择模式页的四张卡片和底部操作区在同一屏内排布', () => {
  const wxml = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/brainstormMode/index.wxml'
  ), 'utf8');
  const wxss = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/brainstormMode/index.wxss'
  ), 'utf8');

  assert.doesNotMatch(wxml, /<scroll-view/);
  assert.match(wxml, /<page-footer[\s\S]*?fixed="\{\{false\}\}"/);
  assert.match(wxss, /\.container\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?overflow:\s*hidden;/);
  assert.match(wxss, /\.mode-scroll\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;/);
  assert.doesNotMatch(wxss, /\.mode-groups\s*\{[^}]*justify-content:\s*space-between;/);
  assert.match(wxss, /\.mode-group\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.match(wxss, /\.mode-list\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.match(wxss, /\.mode-item\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?height:\s*196rpx;[\s\S]*?padding:\s*18rpx 28rpx;/);
  assert.match(wxss, /\.mode-cover\s*\{[\s\S]*?width:\s*144rpx;[\s\S]*?height:\s*144rpx;/);
  assert.match(wxss, /\.mode-name\s*\{[\s\S]*?font-size:\s*38rpx;/);
  assert.match(wxss, /\.mode-tag\s*\{[\s\S]*?background-color:\s*#DCFCE7;[\s\S]*?color:\s*#3AAE34;/);
  assert.match(wxss, /\.mode-desc\s*\{[\s\S]*?font-size:\s*26rpx;/);
  assert.match(wxss, /\.footer\s*\{[\s\S]*?background:\s*transparent;/);
  assert.match(wxss, /@media screen and \(max-height:\s*700px\)[\s\S]*?\.mode-item\s*\{[\s\S]*?height:\s*168rpx;/);
});

test('房主打开模式选择前先提交权威状态，返回时也执行投影后退', () => {
  const lobbySource = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/addPlayer/index.js'
  ), 'utf8');
  const modeSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/brainstormMode/index.js'
  ), 'utf8');

  assert.match(lobbySource, /dispatchRoomCommand\('BEGIN_MODE_SELECTION'/);
  assert.match(lobbySource, /followRoomRouteAfterCommand\(result, roomId\)/);
  assert.match(modeSource, /executeProjectedBack\(this\.data\.roomId\)/);
});

test('新房间首次选择模式会携带当前 modeSelectionRevision', async () => {
  const definition = loadPageDefinition();
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const originalGetCurrentPages = global.getCurrentPages;
  const roomId = '12345678';
  const modeSelectionRevision = 1;
  let revision = 1;
  let modeStarted = false;
  let dispatchedCommand = null;
  let navigatedUrl = '';
  const toasts = [];

  const currentView = () => ({
    room: { roomId, modeSelectionRevision },
    session: modeStarted ? { sessionId: 'session-1', status: 'CONFIGURING' } : null,
    actor: {
      role: 'HOST',
      capabilities: {
        START_WORKSHOP_SESSION: { allowed: !modeStarted, reason: 'INVALID_TRANSITION' }
      }
    },
    route: modeStarted
      ? { name: 'modeIndex', params: { modeId: 'partner' } }
      : { name: 'brainstormMode', params: { isHost: 1, modeSelectionRevision } }
  });
  const roomSession = {
    roomId,
    getView: currentView,
    getSnapshot: () => ({ ok: true, roomId, revision, view: currentView() }),
    dispatch: async (command) => {
      dispatchedCommand = command;
      if (command.context.modeSelectionRevision !== modeSelectionRevision) {
        return {
          ok: false,
          errCode: 'INVALID_ARGUMENT',
          errMsg: 'context.modeSelectionRevision 必填'
        };
      }
      modeStarted = true;
      revision += 1;
      return { ok: true, outcome: { committedThroughSeq: revision } };
    }
  };
  const app = { globalData: { roomId, roomSession } };
  global.getApp = () => app;
  global.getCurrentPages = () => [{ route: 'pages/main-pages/brainstormMode/index', data: { roomId } }];
  global.wx = {
    showToast(options) { toasts.push(options && options.title); },
    redirectTo(options) {
      navigatedUrl = options.url;
      if (typeof options.success === 'function') options.success({});
    },
    reLaunch(options) {
      navigatedUrl = options.url;
      if (typeof options.success === 'function') options.success({});
    }
  };

  const page = {
    ...definition,
    data: {
      ...definition.data,
      roomId,
      isHost: true,
      selectedModeId: 'partner'
    },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };

  try {
    page._installModeContext(roomSession.getSnapshot());
    await page._confirmMode();

    assert.equal(
      dispatchedCommand && dispatchedCommand.context.modeSelectionRevision,
      modeSelectionRevision
    );
    assert.equal(toasts.includes('context.modeSelectionRevision 必填'), false);
    assert.match(navigatedUrl, /modeIndex/);
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
    global.getCurrentPages = originalGetCurrentPages;
  }
});

test('大厅真实点击处理函数在 Command 成功后跟随提交后的模式页，不被订阅跳转掩盖缺失导入', async () => {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalGetPages = global.getCurrentPages;
  const calls = [];
  let definition;
  const view = { room: { modeSelectionRevision: 0 },
    actor: { capabilities: { BEGIN_MODE_SELECTION: { allowed: true } } },
    route: { name: 'addPlayer', params: {} } };
  const snapshot = { ok: true, revision: 499, roomId: '12345678', view };
  global.Page = (value) => { definition = value; };
  const app = { globalData: { roomSession: {
    roomId: '12345678', getView: () => view, getSnapshot: () => snapshot,
    dispatch: async (command) => {
      calls.push(command.type);
      view.route = { name: 'brainstormMode', params: { isHost: 1 } };
      return { ok: true, outcome: { committedThroughSeq: 499 } };
    }
  } } };
  global.getApp = () => app;
  global.getCurrentPages = () => [{ route: 'pages/main-pages/addPlayer/index', data: {} }];
  global.wx = { hideLoading() {}, showLoading() {}, showToast() {},
    removeStorageSync() {}, redirectTo(options) { calls.push(options.url); options.success({}); } };
  const modulePath = require.resolve('../../pages/main-pages/addPlayer/index');
  try {
    delete require.cache[modulePath];
    require(modulePath);
    const page = { ...definition, _pageAlive: true, data: { ...definition.data, roomId: '12345678' },
      setData(patch) { Object.assign(this.data, patch); }, _stopMemberPolling() {}, _startMemberPolling() {} };
    const result = await page.handleGoBrainstormMode();
    assert.equal(result.ok, true);
    assert.equal(calls[0], 'BEGIN_MODE_SELECTION');
    assert.match(calls[1], /brainstormMode\/index/);
    assert.equal(page._navigatingToBrainstorm, false);
    // 从首页主动查看大厅后，选择过程可能已经存在；应恢复它而非重复 BEGIN。
    calls.length = 0;
    view.actor.capabilities.BEGIN_MODE_SELECTION = { allowed: false, reason: 'INVALID_TRANSITION' };
    page._stayOnLobby = true;
    const resumed = await page.handleGoBrainstormMode();
    assert.equal(resumed.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /brainstormMode\/index/);
    assert.equal(page._stayOnLobby, false);
  } finally {
    delete require.cache[modulePath];
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    global.getCurrentPages = originalGetPages;
  }
});

test('模式页错误角色入口使用权威 View 跟随等待页，不因缺少导航导出崩溃', async () => {
  const definition = loadPageDefinition();
  const navigations = [];
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalGetPages = global.getCurrentPages;
  const snapshot = { ok: true, revision: 500, roomId: '12345678',
    view: { route: { name: 'subAwait', params: { scene: 'brainstormMode' } } } };
  global.getCurrentPages = () => [{ route: 'pages/main-pages/brainstormMode/index', data: {} }];
  global.getApp = () => ({ globalData: { roomSession: {
    roomId: '12345678', getState: () => ({ status: 'READY', roomId: '12345678' }),
    getSnapshot: () => snapshot
  } } });
  global.wx = { showToast() {}, redirectTo(options) { navigations.push(options.url); options.success({}); } };
  const page = { ...definition, data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); } };
  try {
    await page.onLoad({ roomId: '12345678', isHost: '0' });
    assert.equal(navigations.length, 1);
    assert.match(navigations[0], /subAwait\/index.*scene=brainstormMode/);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
    global.getCurrentPages = originalGetPages;
  }
});

test('缺省角色入口即使 onReady 先于权威角色读取完成，仍建立订阅并加载模式封面', async () => {
  const definition = loadPageDefinition();
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalGetPages = global.getCurrentPages;
  const snapshot = { ok: true, revision: 501, roomId: '12345678',
    view: { room: { modeSelectionRevision: 6 }, actor: { role: 'HOST' },
      route: { name: 'brainstormMode', params: {} } } };
  global.getCurrentPages = () => [{ route: 'pages/main-pages/brainstormMode/index', data: {} }];
  global.getApp = () => ({ globalData: { roomSession: {
    roomId: '12345678', getState: () => ({ status: 'READY', roomId: '12345678' }),
    getSnapshot: () => snapshot
  } } });
  global.wx = { showToast() {} };
  let binds = 0;
  let refreshes = 0;
  const page = { ...definition, data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); },
    _bindRoomRoute() { binds += 1; }, _scheduleRoomRefresh() { refreshes += 1; } };
  try {
    const loading = page.onLoad({ roomId: '12345678' });
    page.onReady();
    await loading;
    assert.equal(page.data.isHost, true);
    assert.equal(binds, 1, '订阅不能由尚未完成的角色读取决定');
    assert.equal(refreshes, 1);
    assert.ok(page._coverLoadTimer, '封面挂载不能因为 URL 缺省角色而遗漏');
    assert.deepEqual(page._renderedModeContext, { modeSelectionRevision: 6 });
  } finally {
    if (page._coverLoadTimer) clearTimeout(page._coverLoadTimer);
    global.wx = originalWx;
    global.getApp = originalGetApp;
    global.getCurrentPages = originalGetPages;
  }
});
