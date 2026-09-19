'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  projectPartnerRoomShell,
  PARTNER_SHELL_SCREEN
} = require('../../pages/main-pages/partnerMode/utils/partnerRoomShell');
const {
  ROUTES,
  describeRoute,
  createNavigationCoordinator
} = require('../../modules/room-navigation/index');

function loadGamePageDefinition() {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    showToast() {},
    getStorageSync() { return null; },
    setStorageSync() {},
    nextTick(callback) { callback(); },
    getWindowInfo() { return { windowHeight: 800, windowWidth: 375, statusBarHeight: 44 }; },
    getMenuButtonBoundingClientRect() { return { top: 48, height: 32, width: 87, right: 360 }; }
  };
  const modulePath = require.resolve('../../pages/main-pages/partnerMode/gamepage/index');
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makeGamePage() {
  const definition = loadGamePageDefinition();
  const page = {
    ...definition,
    data: { ...definition.data, roomId: '12345678' },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (typeof callback === 'function') callback();
    }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key].bind(page);
  });
  page._stopRoundSpeech = () => {};
  page._stopRoundTimerBurstPoll = () => {};
  page._bindInspirationKeyboard = () => {};
  page._unbindInspirationKeyboard = () => {};
  page._refreshInspirationCount = () => Promise.resolve();
  page._refreshCloudAvatarsIfNeeded = () => {};
  page._captureReviewMyPlayerIndex = () => {};
  page._ingestExpressMessages = () => {};
  page._openSilentOverlayIfNeeded = () => {};
  page._hydrateCloudRoundMedia = () => {};
  page._persistHistoryReviewSnapshot = () => {};
  page._syncRoundSpeech = () => {};
  page._applySharedRoundTimer = () => {};
  page._restartRoundTimer = () => {};
  page._syncRoundTimerVisible = () => {};
  page._ensureSharedRoundTimerOnEnter = () => Promise.resolve();
  page._clearRoundStartedAtCache = () => {};
  page._buildDisplayCardState = () => ({
    displayRoundSummaries: [],
    cardCount: 1,
    cardIndex: 0,
    paginationDots: [{ key: '0', active: true, sizeClass: 'dot-large' }],
    selectedPlayerIndex: 1,
    indicatorPlayerIndex: 1,
    isPlayerFilterActive: false
  });
  return page;
}

function closingSnapshot(overrides = {}) {
  return {
    ok: true,
    revision: 12,
    roomId: '12345678',
    roomState: {
      sessionId: 'session-1',
      closingVoteSessionId: 'closing-1',
      closingVoteInitiatorIndex: 1,
      ...overrides.roomState
    },
    view: {
      route: { name: 'closingStatement', params: {} },
      actor: {
        seatNo: 2,
        voteStatus: { submitted: false },
        ...overrides.actor
      },
      session: {
        sessionId: 'session-1',
        ...overrides.session
      }
    }
  };
}

function gameSnapshot(revision = 13) {
  return {
    ok: true,
    revision,
    roomId: '12345678',
    workshopName: '重构回归',
    members: [{
      memberId: 'member-host',
      playerIndex: 1,
      seatNo: 1,
      nickName: '房主',
      isHost: true,
      isMe: true,
      status: 'ACTIVE'
    }],
    roomState: {
      sessionId: 'session-1',
      partnerGamePhase: 'play',
      currentRound: 1,
      currentPlayerIndex: 1,
      partnerRoundSummaries: [],
      partnerExpressMessages: [],
      totalRequired: 0
    },
    view: {
      route: { name: 'partnerGame', params: {} },
      actor: { seatNo: 1 },
      session: { sessionId: 'session-1' }
    }
  };
}

function waitingForFirstPlayerSnapshot(revision = 10) {
  return {
    ok: true,
    revision,
    roomId: '12345678',
    roomState: { sessionId: 'session-1' },
    view: {
      route: { name: 'subAwait', params: { scene: 'confirmFirstPlayer' } },
      actor: { seatNo: 2 },
      session: { sessionId: 'session-1' }
    }
  };
}

function nonCurrentPlayerGameSnapshot(masterMode, revision = 20) {
  const snapshot = gameSnapshot(revision);
  snapshot.members = [
    {
      memberId: 'member-host', playerIndex: 1, seatNo: 1,
      nickName: '房主', isHost: true, isMe: true, status: 'ACTIVE'
    },
    {
      memberId: 'member-2', playerIndex: 2, seatNo: 2,
      nickName: '玩家2', isHost: false, isMe: false, status: 'ACTIVE'
    }
  ];
  snapshot.isHost = true;
  snapshot.roomState.currentPlayerIndex = 2;
  snapshot.roomState.partnerMasterMode = masterMode;
  snapshot.roomState.progress = {
    turnId: 'turn-1',
    scoredCount: 0,
    requiredScoreCount: 1
  };
  snapshot.roomState.myScore = null;
  snapshot.view.actor = { seatNo: 1 };
  snapshot.view.session.activeTurn = { turnId: 'turn-1' };
  return snapshot;
}

test('Partner RoomShell 只根据 Member View route 选择业务屏幕', () => {
  const game = projectPartnerRoomShell({
    ok: true,
    revision: 11,
    view: { route: { name: 'partnerGame', params: {} } },
    roomState: { sessionId: 'session-1' }
  });
  assert.equal(game.screen, PARTNER_SHELL_SCREEN.GAME);
  assert.equal(game.routeName, 'partnerGame');

  const closing = projectPartnerRoomShell(closingSnapshot());
  assert.equal(closing.screen, PARTNER_SHELL_SCREEN.CLOSING_VOTE);
  assert.equal(closing.routeName, 'closingStatement');
  assert.deepEqual(closing.closingVote, {
    sessionId: 'session-1',
    closingVoteSessionId: 'closing-1',
    isInitiator: false,
    hasVoted: false,
    voteResult: ''
  });
});

test('Partner RoomShell 的收尾投票模型可由 Snapshot 或 Event 归约后的同一 View 等价重建', () => {
  const snapshotModel = projectPartnerRoomShell(closingSnapshot());
  const eventReducedModel = projectPartnerRoomShell(closingSnapshot({
    actor: { voteStatus: { submitted: true, vote: 'question' } }
  }));

  assert.equal(snapshotModel.key, 'session-1:closing-1');
  assert.equal(eventReducedModel.key, snapshotModel.key);
  assert.equal(eventReducedModel.closingVote.hasVoted, true);
  assert.equal(eventReducedModel.closingVote.voteResult, 'question');
});

test('Partner 运行期与收尾投票共用一个物理 Shell 页面，切换时不调用微信导航', async () => {
  assert.equal(ROUTES.partnerGame.path, ROUTES.closingStatement.path);
  assert.match(
    describeRoute({ name: 'closingStatement', params: {} }, '12345678').url,
    /roomShellScreen=closingVote/,
    '从其他页面首次进入时应先显示 Shell 加载态，不能闪出游戏操作区'
  );
  const opened = [];
  const previousPages = global.getCurrentPages;
  global.getCurrentPages = () => [{ route: ROUTES.partnerGame.path.slice(1), data: {} }];
  try {
    const navigation = createNavigationCoordinator({
      open: async (descriptor) => opened.push(descriptor)
    });
    const result = await navigation.reconcile(
      { name: 'closingStatement', params: {} },
      12,
      { roomId: '12345678' }
    );
    assert.equal(result.reason, 'SAME_ROUTE');
    assert.deepEqual(opened, []);
  } finally {
    global.getCurrentPages = previousPages;
  }
});

test('等待确认首位玩家与 Partner 游戏共用物理 Shell', async () => {
  const waiting = describeRoute(
    { name: 'subAwait', params: { scene: 'confirmFirstPlayer' } },
    '12345678'
  );
  assert.equal(waiting.path, ROUTES.partnerGame.path);
  assert.match(waiting.url, /roomShellScreen=waiting/);
  assert.match(waiting.url, /scene=confirmFirstPlayer/);

  const opened = [];
  const previousPages = global.getCurrentPages;
  global.getCurrentPages = () => [{ route: ROUTES.partnerGame.path.slice(1), data: {} }];
  try {
    const navigation = createNavigationCoordinator({
      open: async (descriptor) => opened.push(descriptor)
    });
    const result = await navigation.reconcile(
      { name: 'subAwait', params: { scene: 'confirmFirstPlayer' } },
      10,
      { roomId: '12345678' }
    );
    assert.equal(result.reason, 'SAME_ROUTE');
    assert.deepEqual(opened, []);
  } finally {
    global.getCurrentPages = previousPages;
  }
});

test('等待确认首位玩家可由 Snapshot 或 Event 归约后的同一 View 投影成 Shell 屏幕', () => {
  const snapshotModel = projectPartnerRoomShell(waitingForFirstPlayerSnapshot());
  const eventReducedModel = projectPartnerRoomShell(waitingForFirstPlayerSnapshot(11));

  assert.equal(snapshotModel.screen, PARTNER_SHELL_SCREEN.WAITING);
  assert.equal(snapshotModel.waiting.scene, 'confirmFirstPlayer');
  assert.equal(eventReducedModel.screen, snapshotModel.screen);
  assert.equal(eventReducedModel.key, snapshotModel.key);
});

test('Partner RoomShell 对非运行期 route 明确交还全局导航处理', () => {
  const model = projectPartnerRoomShell({
    ok: true,
    revision: 20,
    view: { route: { name: 'leaderboard', params: { from: 'closingEnd' } } },
    roomState: { sessionId: 'session-1' }
  });
  assert.equal(model.screen, PARTNER_SHELL_SCREEN.EXTERNAL);
  assert.equal(model.routeName, 'leaderboard');
});

test('RoomShell 屏幕切换不被卡片滑动或打分交互锁延迟', async () => {
  const page = makeGamePage();
  page._cardSwipeBusy = true;
  page._scoreUiBusy = true;

  let applied = page._applyRoomContext(closingSnapshot());
  await applied.applied;
  assert.equal(page.data.roomShellScreen, PARTNER_SHELL_SCREEN.CLOSING_VOTE);
  assert.equal(page.data.closingVoteModel.hasVoted, false);

  applied = page._applyRoomContext(closingSnapshot({
    actor: { voteStatus: { submitted: true, vote: 'pass' } }
  }));
  await applied.applied;
  assert.equal(page.data.closingVoteModel.hasVoted, true, '同水位的 Actor View 刷新仍要更新本人投票态');

  const newer = closingSnapshot({
    actor: { voteStatus: { submitted: true, vote: 'question' } }
  });
  newer.revision = 13;
  applied = page._applyRoomContext(newer);
  await applied.applied;
  assert.equal(page.data.closingVoteModel.hasVoted, true);
  assert.equal(page.data.closingVoteModel.voteResult, 'question');

  const stale = closingSnapshot({
    actor: { voteStatus: { submitted: false } }
  });
  stale.revision = 11;
  page._applyRoomContext(stale);
  assert.equal(page.data.closingVoteModel.voteResult, 'question', '旧水位不得把 Shell 打回旧状态');
});

test('等待确认首位玩家和进入游戏在同一页面实例切换且不受游戏交互锁阻塞', async () => {
  const page = makeGamePage();
  page._cardSwipeBusy = true;
  page._scoreUiBusy = true;
  let gameBindings = 0;
  let waitingCleanups = 0;
  page._bindInspirationKeyboard = () => { gameBindings += 1; };
  page._unbindInspirationKeyboard = () => { waitingCleanups += 1; };
  page._refreshInspirationCount = () => Promise.resolve();

  let applied = page._applyRoomContext(waitingForFirstPlayerSnapshot());
  await applied.applied;
  assert.equal(page.data.roomShellScreen, PARTNER_SHELL_SCREEN.WAITING);
  assert.equal(page.data.waitingModel.scene, 'confirmFirstPlayer');
  assert.equal(page.data.waitingModel.mainText, '等待房主确认首位出牌玩家');
  assert.equal(page._pendingRoomContext, null);
  assert.equal(page._cardSwipeBusy, false);
  assert.equal(page._scoreUiBusy, false);
  assert.equal(waitingCleanups, 1, '进入等待屏幕时要清理游戏输入副作用');

  applied = page._applyRoomContext(gameSnapshot(11));
  await applied.applied;
  assert.equal(page.data.roomShellScreen, PARTNER_SHELL_SCREEN.GAME);
  assert.equal(page.data.waitingModel, null);
  assert.equal(page._pendingRoomContext, null);
  assert.equal(gameBindings, 1, '同页进入游戏时必须显式恢复游戏输入副作用');
});

test('收尾存在疑问后可在同一页面实例恢复游戏屏幕', async () => {
  const page = makeGamePage();
  let applied = page._applyRoomContext(closingSnapshot());
  await applied.applied;

  page._cardSwipeBusy = true;
  page._scoreUiBusy = true;
  applied = page._applyRoomContext(gameSnapshot());
  await applied.applied;

  assert.equal(page.data.roomShellScreen, PARTNER_SHELL_SCREEN.GAME);
  assert.equal(page.data.closingVoteModel, null);
  assert.equal(page.data.sessionId, 'session-1');
  assert.equal(page._pendingRoomContext, null, '权威 Shell 切屏不能被旧游戏手势排队');
});

test('Master Event 刷新不会让非当前玩家离开 game 屏幕或丢失打分资格 UI', async () => {
  const page = makeGamePage();
  let applied = page._applyRoomContext(nonCurrentPlayerGameSnapshot(false));
  await applied.applied;
  assert.equal(page.data.isCurrentPlayer, false);
  assert.equal(page.data.starRatingCollapsed, false);

  applied = page._applyRoomContext(nonCurrentPlayerGameSnapshot(true, 21));
  await applied.applied;
  assert.equal(page.data.roomShellScreen, PARTNER_SHELL_SCREEN.GAME);
  assert.equal(page.data.isCurrentPlayer, false);
  assert.equal(page.data.isMasterMode, true);
  assert.equal(page.data.specialActionBadge, 'Master模式');
  assert.equal(page.data.starRatingCollapsed, false);
});

test('收尾投票屏幕恢复前台时不启动游戏计时、语音或灵感副作用', () => {
  const page = makeGamePage();
  page.data.roomShellScreen = PARTNER_SHELL_SCREEN.CLOSING_VOTE;
  let polling = 0;
  let gameEffects = 0;
  page._bindInspirationKeyboard = () => {};
  page._startStatePolling = () => { polling += 1; };
  page._refreshInspirationCount = () => { gameEffects += 1; };
  page._ensureSharedRoundTimerOnEnter = () => {
    gameEffects += 1;
    return Promise.resolve();
  };

  page.onShow();

  assert.equal(polling, 1, '收尾投票仍需恢复唯一 RoomSession 订阅');
  assert.equal(gameEffects, 0, '收尾投票不得执行游戏屏幕的计时与输入副作用');
});

test('等待确认首位玩家屏幕恢复前台时只恢复 RoomSession，不启动游戏副作用', () => {
  const page = makeGamePage();
  page.data.roomShellScreen = PARTNER_SHELL_SCREEN.WAITING;
  let polling = 0;
  let gameEffects = 0;
  page._bindInspirationKeyboard = () => {};
  page._startStatePolling = () => { polling += 1; };
  page._refreshInspirationCount = () => { gameEffects += 1; };
  page._ensureSharedRoundTimerOnEnter = () => {
    gameEffects += 1;
    return Promise.resolve();
  };

  page.onShow();

  assert.equal(polling, 1);
  assert.equal(gameEffects, 0);
});

test('离开 Partner Shell 的权威 route 交给全局导航，不闪回游戏屏幕', async () => {
  const page = makeGamePage();
  let applied = page._applyRoomContext(closingSnapshot());
  await applied.applied;

  const completed = gameSnapshot(14);
  completed.view.route = { name: 'leaderboard', params: { from: 'closingEnd' } };
  applied = page._applyRoomContext(completed);
  await applied.applied;

  assert.equal(page.data.roomShellScreen, PARTNER_SHELL_SCREEN.CLOSING_VOTE);
  assert.equal(applied.shellScreen, PARTNER_SHELL_SCREEN.EXTERNAL);
});
