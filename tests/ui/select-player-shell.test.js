'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROUTES, describeRoute, createNavigationCoordinator } = require('../../modules/room-navigation/index');
const {
  ROOM_SHELL_OWNER,
  ROOM_SHELL_SCREEN,
  classifyRoomShellRoute
} = require('../../modules/room-navigation/roomShellRoute');
const {
  SELECT_PLAYER_SHELL_SCREEN,
  projectSelectPlayerShell
} = require('../../pages/main-pages/selectPlayer/shell');

function loadSelectPlayerPage() {
  const originalPage = global.Page;
  let definition;
  global.Page = (value) => { definition = value; };
  const modulePath = require.resolve('../../pages/main-pages/selectPlayer/index');
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Page = originalPage;
  return definition;
}

function makePage() {
  const definition = loadSelectPlayerPage();
  return {
    ...definition,
    data: { ...definition.data, roomId: '12345678' },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (typeof callback === 'function') callback();
    }
  };
}

function waitingSnapshot(scene, revision = 5) {
  return {
    ok: true,
    revision,
    roomId: '12345678',
    isHost: false,
    members: [{ memberId: 'm1', playerIndex: 1, nickName: '房主' }],
    view: {
      route: { name: 'subAwait', params: { scene } },
      session: { mode: 'HALLI_GALLI', workflow: { step: 'CHOOSE_SCENARIO' } }
    }
  };
}

test('情境等待与选择首位等待共用 selectPlayer Setup Shell', async () => {
  const scenario = describeRoute({ name: 'subAwait', params: { scene: 'bg' } }, '12345678');
  const firstPlayer = describeRoute({ name: 'subAwait', params: { scene: 'player' } }, '12345678');
  assert.equal(scenario.path, ROUTES.selectPlayer.path);
  assert.equal(firstPlayer.path, ROUTES.selectPlayer.path);
  assert.match(scenario.url, /roomShellScreen=waiting/);

  const opened = [];
  const previousPages = global.getCurrentPages;
  global.getCurrentPages = () => [{ route: ROUTES.selectPlayer.path.slice(1), data: {} }];
  try {
    const navigation = createNavigationCoordinator({
      open: async (descriptor) => opened.push(descriptor)
    });
    const first = await navigation.reconcile(
      { name: 'subAwait', params: { scene: 'bg' } },
      5,
      { roomId: '12345678' }
    );
    const second = await navigation.reconcile(
      { name: 'subAwait', params: { scene: 'player' } },
      6,
      { roomId: '12345678' }
    );
    assert.equal(first.reason, 'SAME_ROUTE');
    assert.equal(second.reason, 'SAME_ROUTE');
    assert.deepEqual(opened, []);
  } finally {
    global.getCurrentPages = previousPages;
  }
});

test('导航与 Setup Shell 共用同一个权威 route 分类器', () => {
  assert.deepEqual(
    classifyRoomShellRoute({ name: 'subAwait', params: { scene: 'player' } }),
    {
      owner: ROOM_SHELL_OWNER.SELECT_PLAYER,
      screen: ROOM_SHELL_SCREEN.WAITING,
      routeName: 'subAwait',
      scene: 'player'
    }
  );
  assert.equal(
    classifyRoomShellRoute({ name: 'subAwait', params: { scene: 'confirmFirstPlayer' } }).owner,
    ROOM_SHELL_OWNER.PARTNER
  );
});

test('Setup Shell 只按完整 Member View 在等待场景之间切屏', () => {
  const scenario = projectSelectPlayerShell(waitingSnapshot('bg'));
  const firstPlayer = projectSelectPlayerShell(waitingSnapshot('player', 6));

  assert.equal(scenario.screen, SELECT_PLAYER_SHELL_SCREEN.WAITING);
  assert.equal(scenario.waiting.scene, 'bg');
  assert.equal(scenario.waiting.mainText, '等待房主设置情境');
  assert.equal(firstPlayer.screen, SELECT_PLAYER_SHELL_SCREEN.WAITING);
  assert.equal(firstPlayer.waiting.scene, 'player');
  assert.equal(firstPlayer.waiting.mainText, '等待房主抽取首位翻牌玩家');
});

test('Setup Shell 对 Host 选择页与外部 route 做明确分流', () => {
  const selector = projectSelectPlayerShell({
    ok: true,
    revision: 7,
    isHost: true,
    members: [{ memberId: 'm1', playerIndex: 1, nickName: '房主' }],
    view: { route: { name: 'selectPlayer', params: { phase: 'SELECT_FIRST_PLAYER' } } }
  });
  assert.equal(selector.screen, SELECT_PLAYER_SHELL_SCREEN.SELECTOR);
  assert.equal(selector.selector.isHost, true);
  assert.equal(selector.selector.members.length, 1);

  const external = projectSelectPlayerShell({
    ok: true,
    revision: 8,
    view: { route: { name: 'halliGame', params: {} } }
  });
  assert.equal(external.screen, SELECT_PLAYER_SHELL_SCREEN.EXTERNAL);
});

test('selectPlayer 页面消费 Shell Model 原地切换等待场景与 Host 选择器', () => {
  const page = makePage();

  page._applyRoomContext(waitingSnapshot('bg'));
  assert.equal(page.data.roomShellScreen, SELECT_PLAYER_SHELL_SCREEN.WAITING);
  assert.equal(page.data.waitingModel.mainText, '等待房主设置情境');

  page._applyRoomContext(waitingSnapshot('player', 6));
  assert.equal(page.data.roomShellScreen, SELECT_PLAYER_SHELL_SCREEN.WAITING);
  assert.equal(page.data.waitingModel.mainText, '等待房主抽取首位翻牌玩家');

  page._applyRoomContext(waitingSnapshot('bg', 5));
  assert.equal(page.data.waitingModel.mainText, '等待房主抽取首位翻牌玩家',
    '较旧的异步 Snapshot 不得把 Setup Shell 打回上一等待场景');

  page._applyRoomContext({
    ok: true,
    revision: 7,
    isHost: true,
    selectedModeId: 'halliGalli',
    members: [{ memberId: 'm1', playerIndex: 1, nickName: '房主' }],
    view: { route: { name: 'selectPlayer', params: { phase: 'SELECT_FIRST_PLAYER' } } }
  });
  assert.equal(page.data.roomShellScreen, SELECT_PLAYER_SHELL_SCREEN.SELECTOR);
  assert.equal(page.data.isHost, true);
  assert.equal(page.data.members.length, 1);
});

test('触点数量不得超过当前房间成员数', () => {
  const page = makePage();
  const touches = Array.from({ length: 3 }, (_, index) => ({
    identifier: index + 1,
    clientX: 40 + index * 50,
    clientY: 300
  }));
  page.data.members = [
    { memberId: 'member-1', playerIndex: 1 },
    { memberId: 'member-2', playerIndex: 2 }
  ];
  page.data.minPlayers = 2;

  try {
    page.onTouchStart({ touches, changedTouches: touches });

    assert.equal(page.data.activeTouches.length, 2);
    assert.equal(page.data.playerCount, 2);
    assert.deepEqual(page.data.activeTouches.map((touch) => touch.id), [1, 2]);
  } finally {
    page._clearLongPressTimer();
  }
});

test('iOS 六人局第六个触摸必须加入抽取池并走正常倒计时', () => {
  const page = makePage();
  const previousGetApp = global.getApp;
  const previousRandom = Math.random;
  const touches = Array.from({ length: 5 }, (_, index) => ({
    identifier: index + 1,
    clientX: 40 + index * 50,
    clientY: 300
  }));
  const members = Array.from({ length: 6 }, (_, index) => ({
    memberId: `member-${index + 1}`,
    playerIndex: index + 1,
    nickName: `玩家${index + 1}`
  }));
  global.getApp = () => ({ globalData: {} });
  Math.random = () => 0.99;

  try {
    page._applyRoomContext({
      ok: true,
      revision: 7,
      isHost: true,
      selectedModeId: 'halliGalli',
      members,
      view: { route: { name: 'selectPlayer', params: { phase: 'SELECT_FIRST_PLAYER' } } }
    });
    page.data.activeTouches = touches.map((touch) => ({
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      timestamp: 1,
      visible: true
    }));
    page.onTouchStart({
      touches,
      changedTouches: [{ identifier: 6, clientX: 320, clientY: 300 }]
    });
    assert.equal(page.data.activeTouches.length, 6, '第六个触摸应从 changedTouches 补入抽取池');
    assert.equal(page.data.playerCount, 6);
    assert.equal(page.data.selectedTouchId, null, '第六个触摸到达时不得立即抽取');
    assert.equal(page.data.selectedPlayerIndex == null, true);
    assert.equal(page._longPressTimer != null, true, '人数齐全后应进入正常长按倒计时');

    page._clearLongPressTimer();
    page.selectRandomPlayer();
    assert.equal(page.data.selectedTouchId, 6, '第六个触摸必须实际参与随机抽取');
    assert.equal(page.data.selectedPlayerIndex, 6);
  } finally {
    page._clearLongPressTimer();
    if (page.animationDoneTimer) clearTimeout(page.animationDoneTimer);
    global.getApp = previousGetApp;
    Math.random = previousRandom;
  }
});

test('iOS 六人局只有五个触点时不得提前抽取', () => {
  const page = makePage();
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  const scheduled = [];
  page.data.members = Array.from({ length: 6 }, (_, index) => ({
    memberId: `member-${index + 1}`,
    playerIndex: index + 1
  }));
  page.data.minPlayers = 6;
  page.data.activeTouches = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    x: 40 + index * 50,
    y: 300
  }));
  global.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return scheduled.length;
  };
  global.clearTimeout = () => {};

  try {
    page.updatePlayerCount();
    assert.equal(scheduled.length, 0, '五个触点不足六人时不应安排兜底抽取');
    assert.equal(page.data.selectedTouchId, null);
    assert.equal(page.data.selectedPlayerIndex == null, true);
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});

test('非 iOS 六人局仍按全部触点进入原倒计时流程', () => {
  const page = makePage();
  const previousWx = global.wx;
  const members = Array.from({ length: 6 }, (_, index) => ({
    memberId: `member-${index + 1}`,
    playerIndex: index + 1
  }));
  const touches = members.map((_, index) => ({
    identifier: index + 1,
    clientX: 30 + index * 40,
    clientY: 300
  }));
  global.wx = { getSystemInfoSync: () => ({ platform: 'android', system: 'Android 16' }) };

  try {
    page._applyRoomContext({
      ok: true,
      revision: 7,
      isHost: true,
      selectedModeId: 'halliGalli',
      members,
      view: { route: { name: 'selectPlayer', params: { phase: 'SELECT_FIRST_PLAYER' } } }
    });
    page.data.activeTouches = touches.slice(0, 5).map((touch) => ({
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      timestamp: 1,
      visible: true
    }));
    page.onTouchStart({ touches, changedTouches: [touches[5]] });

    assert.equal(page.data.activeTouches.length, 6);
    assert.equal(page.data.selectedPlayerIndex == null, true);
  } finally {
    page._clearLongPressTimer();
    global.wx = previousWx;
  }
});

test('selectPlayer 首屏和离开 Shell 时都保持无交互加载态', () => {
  const page = makePage();
  assert.equal(page.data.roomShellScreen, SELECT_PLAYER_SHELL_SCREEN.LOADING);

  page._applyRoomContext({
    ok: true,
    revision: 9,
    view: { route: { name: 'halliGame', params: {} } }
  });
  assert.equal(page.data.roomShellScreen, SELECT_PLAYER_SHELL_SCREEN.LOADING);
  assert.equal(page.data.waitingModel, null);
});

test('selectPlayer Setup Shell 由受控等待组件和原选择器拼接', () => {
  const markup = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/selectPlayer/index.wxml'),
    'utf8'
  );
  const config = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/selectPlayer/index.json'),
    'utf8'
  ));
  assert.match(markup, /<room-wait-screen/);
  assert.match(markup, /roomShellScreen === 'waiting'/);
  assert.match(markup, /roomShellScreen === 'selector'/);
  assert.match(markup, /wx:else class="room-shell-loading"/);
  assert.equal(config.usingComponents['room-wait-screen'], '/components/room-wait-screen/index');
});
