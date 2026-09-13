/**
 * 谁是卧底客户端辅助：导航、倒计时、成员过滤
 */
const {
  SPY_PAGE,
  SPEAK_ROUND_MS,
  SPEAK_TURN_MS,
  VOTE_ROUND_MS,
  formatCountdown,
  computeMsLeft,
  getDefaultSpyCount,
  MIN_PLAYERS,
  roleLabel,
  winnerLabel
} = require('./spyGameState');
const { followSubScreenRoomPoll } = require('./subScreenRoomPoll');
const { openUrl } = require('./pageNavigate');
const { goRoomPage } = require('./goRoomPage');
const { buildAvatarList, buildAvatarListAsync } = require('./avatars');
const { handleRoomGoneFromResult } = require('./roomDissolved');
const {
  bindPageToRoomSession,
  dispatchRoomCommand,
  getActiveRoomSession,
  getRoomPageSnapshot,
  unbindPageFromRoomSession
} = require('../modules/room-session/index');

/** 拉取房间；若已解散/不在房间则统一回首页并返回 null */
async function fetchRoomDataOrExit(roomId) {
  let result;
  try {
    result = await getRoomPageSnapshot(roomId, { refresh: true });
  } catch (error) {
    result = { ok: false, errCode: error && error.errCode, errMsg: error && (error.errMsg || error.message) };
  }
  if (handleRoomGoneFromResult(result, roomId)) return null;
  return result;
}

function buildSpyPageUrl(pageKey, roomId, query = {}) {
  const roomIdEnc = encodeURIComponent(roomId || '');
  const pathMap = {
    intro: '/packageSpy/pages/modeIndex/index',
    cardLibrary: '/packageSpy/pages/cardLibrary/index',
    speak: '/packageSpy/pages/speak/index',
    vote: '/packageSpy/pages/vote/index',
    result: '/packageSpy/pages/result/index',
    settle: '/packageSpy/pages/settle/index'
  };
  let url = `${pathMap[pageKey] || pathMap.intro}?roomId=${roomIdEnc}`;
  Object.keys(query || {}).forEach((key) => {
    if (query[key] == null || query[key] === '') return;
    url += `&${key}=${encodeURIComponent(query[key])}`;
  });
  return url;
}

function filterPlayerMembers(members, options = {}) {
  return (members || []).filter((m) => {
    if (!m) return false;
    // 谁是卧底：全员平等参玩（含原 GOD）；其它模式可 excludeGod
    if (options.excludeGod && m.role === 'GOD') return false;
    if (options.excludeHostSelf && m.isMe) return false;
    return true;
  });
}

function parseIsHostOption(options) {
  if (!options) return false;
  const raw = options.isHost;
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}

function makeSpyCommandId(action) {
  return `spy_${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 从已经渲染的 Snapshot 捕获并发令牌，点击时不得改用后台刚同步到的新轮次。 */
function captureSpyCommandContext(result) {
  const session = result && result.view && result.view.session;
  const spyGame = result && result.roomState && result.roomState.spyGame;
  if (!session || !spyGame) return null;
  return Object.freeze({
    sessionId: session.sessionId || '',
    gameId: spyGame.gameId || '',
    speakerTurnId: spyGame.speakerTurnId || '',
    voteSessionId: spyGame.voteSessionId || '',
    roundNo: spyGame.roundNo
  });
}

function spyCommandContextForAction(action, captured) {
  const context = captured || {};
  if (['startAssign', 'startGame', 'returnToLobby'].includes(action)) {
    return { sessionId: context.sessionId || '' };
  }
  if (['advanceSpeak', 'finishSpeak', 'startVote'].includes(action)) {
    return { sessionId: context.sessionId || '', gameId: context.gameId || '',
      speakerTurnId: context.speakerTurnId || '' };
  }
  if (action === 'submitVote') {
    return { sessionId: context.sessionId || '', gameId: context.gameId || '',
      voteSessionId: context.voteSessionId || '' };
  }
  if (['nextRound', 'continueRound'].includes(action)) {
    return { sessionId: context.sessionId || '', gameId: context.gameId || '',
      roundNo: context.roundNo };
  }
  if (['restart', 'complete'].includes(action)) {
    return { sessionId: context.sessionId || '', gameId: context.gameId || '' };
  }
  return {};
}

function spyResultFromSnapshot(result, snapshot) {
  const view = snapshot && snapshot.view;
  const session = view && view.session;
  const spyGame = snapshot && snapshot.roomState && snapshot.roomState.spyGame;
  const routeName = view && view.route && view.route.name;
  const pageByRoute = {
    spyIntro: SPY_PAGE.intro,
    spySpeak: SPY_PAGE.speak,
    spyVote: SPY_PAGE.vote,
    spyResult: SPY_PAGE.result,
    spySettle: SPY_PAGE.settle
  };
  return {
    ...(result || {}),
    spyGame,
    currentPage: pageByRoute[routeName] || '',
    card: view && view.actor && view.actor.privateModeState,
    settled: !!(session && session.workflow.step === 'SPY_SETTLED'),
    tied: !!(session && session.workflow.step === 'SPY_TIE_SPEAK'),
    finished: !!(session && session.status === 'COMPLETED'),
    autoVote: !!(session && session.workflow.step === 'SPY_VOTE')
  };
}

/**
 * Spy 页面动作适配。写入统一转换成 V3 语义命令；本人密牌直接来自 ActorView。
 */
async function callSpyAction(action, data = {}) {
  const roomId = data && data.roomId;
  if (!action || !roomId) {
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'action 与 roomId 必填' };
  }

  if (action === 'getMyCard') {
    try {
      const snapshot = await getRoomPageSnapshot(roomId, { refresh: false });
      return spyResultFromSnapshot({ ok: true }, snapshot);
    } catch (error) {
      return { ok: false, errCode: error && error.errCode || 'SNAPSHOT_ERROR',
        errMsg: error && (error.errMsg || error.message) || '读取密牌失败' };
    }
  }

  let type = null;
  let payload = {};

  switch (action) {
    case 'startAssign':
    case 'startGame':
      type = 'START_SPY_GAME';
      break;
    case 'advanceSpeak':
    case 'finishSpeak':
      type = 'ADVANCE_SPY_SPEAKER';
      break;
    case 'startVote':
      type = 'OPEN_SPY_VOTE';
      break;
    case 'submitVote':
      type = 'SUBMIT_SPY_VOTE';
      if (data.abstain) payload = { abstain: true };
      else {
        const snapshot = await getRoomPageSnapshot(roomId, { refresh: false });
        const target = (snapshot.members || []).find((member) => Number(member.playerIndex) === Number(data.targetPlayerIndex));
        if (!target) return { ok: false, errCode: 'STALE_CONTEXT', errMsg: '投票目标已经离开' };
        payload = { targetMemberId: target.memberId };
      }
      break;
    case 'nextRound':
    case 'continueRound':
      type = 'START_NEXT_SPY_ROUND';
      break;
    case 'restart':
      type = 'RESTART_SPY_GAME';
      break;
    case 'complete':
      type = 'COMPLETE_SPY_SESSION';
      break;
    case 'returnToLobby':
      type = 'RETURN_TO_LOBBY';
      break;
    default:
      return { ok: false, errCode: 'UNKNOWN_ACTION', errMsg: `未知 action: ${action}` };
  }

  try {
    const result = await dispatchRoomCommand(type, payload,
      spyCommandContextForAction(action, data.context), {
        roomId: String(roomId),
        commandId: data.commandId || makeSpyCommandId(action)
      });
    if (!result || result.ok !== true) return result || { ok: false, errCode: 'EMPTY_RESULT', errMsg: '无返回' };
    const session = getActiveRoomSession();
    const snapshot = session && session.getSnapshot
      ? session.getSnapshot()
      : await getRoomPageSnapshot(roomId, { refresh: false });
    return spyResultFromSnapshot(result, snapshot);
  } catch (e) {
    return {
      ok: false,
      errCode: (e && e.errCode) || 'SPY_COMMAND_ERROR',
      errMsg: (e && e.errMsg) || (e && e.message) || '操作失败'
    };
  }
}

/** onTick(msLeft) 可选：每次刷新倒计时后回调，用于超时自动动作（如投票页弃票） */
function startSpyCountdownTicker(page, getStartedAt, durationMs, dataKey = 'countdownText', onTick) {
  const tick = () => {
    if (!page || page._pageAlive === false) return;
    try {
      const startedAt = typeof getStartedAt === 'function' ? getStartedAt() : getStartedAt;
      const session = getActiveRoomSession();
      const state = session && session.getState ? session.getState() : null;
      const projectedNow = state && Number(state.serverNow);
      const now = Number.isFinite(projectedNow) ? projectedNow : Date.now();
      const left = computeMsLeft(startedAt, durationMs, now);
      page.setData({ [dataKey]: formatCountdown(left), countdownMsLeft: left });
      if (typeof onTick === 'function') onTick(left);
    } catch (e) {
      // 页面已销毁时忽略，避免 __subPageFrameEndTime__ 空指针
    }
  };
  tick();
  return setInterval(tick, 500);
}

/** 页面可见时才 setData，防止 hide/unload 后轮询写回崩溃 */
function safePageSetData(page, data, callback) {
  if (!page || page._pageAlive === false || !data) return false;
  try {
    page.setData(data, callback);
    return true;
  } catch (e) {
    return false;
  }
}

/** 统一 playerIndex 比较，避免 number/string 混用导致投票进度不同步 */
function samePlayerIndex(a, b) {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

function playerIndexIncludes(list, index) {
  if (!Array.isArray(list) || index == null) return false;
  const n = Number(index);
  return list.some((item) => Number(item) === n);
}

/**
 * 轮询刷新：busy 时记 pending，结束后补跑，避免丢掉阶段跳转/人数更新
 * @returns {Promise<boolean>} 是否实际执行了本次 refresh
 */
async function withSpyRefreshGuard(page, refreshFn) {
  if (!page || page._pageAlive === false) return false;
  if (page._refreshing) {
    page._pendingRefresh = true;
    return false;
  }
  page._refreshing = true;
  try {
    if (page._pageAlive !== false) {
      await refreshFn();
    }
  } finally {
    page._refreshing = false;
    if (page._pendingRefresh && page._pageAlive !== false) {
      page._pendingRefresh = false;
      Promise.resolve()
        .then(() => withSpyRefreshGuard(page, refreshFn))
        .catch(() => {});
    } else {
      page._pendingRefresh = false;
    }
  }
  return true;
}

/**
 * Spy 读路径挂在唯一 RoomClient 上，页面只消费投影后的快照。
 */
function startSpyRoomPoll(page, options) {
  if (!page) return Promise.resolve(null);
  const onPollResult = options && options.onPollResult;

  return bindPageToRoomSession(page, {
    getRoomId() {
      return page.data && page.data.roomId;
    },
    emitCurrent: false,
    followNavigation: false,
    onSnapshot(snapshot) {
      if (page._pageAlive === false) return;
      if (!snapshot) return;
      const roomId = page.data && page.data.roomId;
      if (!roomId) return;

      // 解散/不在房间：ok:false，必须先处理回首页（不可因 ok 短路）
      const raw = snapshot.raw;
      if (raw && handleRoomGoneFromResult(raw, roomId)) return;
      if (!snapshot.ok) {
        if (handleRoomGoneFromResult({
          ok: false,
          errCode: snapshot.errCode,
          errMsg: snapshot.errMsg,
          roomDissolved: snapshot.errCode === 'ROOM_DISSOLVED'
            || snapshot.errCode === 'ROOM_NOT_FOUND',
          event: snapshot.errCode === 'ROOM_DISSOLVED' ? 'room_dissolved' : undefined
        }, roomId)) {
          return;
        }
        return;
      }
      if (!raw || raw.ok !== true) return;
      if (typeof onPollResult === 'function') {
        onPollResult.call(page, raw);
      }
    }
  }).catch((e) => {
    console.warn('startSpyRoomPoll', e);
    return null;
  });
}

function stopSpyRoomPoll(page) {
  if (!page) return;
  unbindPageFromRoomSession(page);
}

/** 写命令后主动拉一次会话，避免等下一轮 poll */
function bumpSpyRoomSession() {
  try {
    const session = getActiveRoomSession();
    if (session && typeof session.refresh === 'function') {
      return session.refresh().catch(() => null);
    }
  } catch (e) {
    // ignore
  }
  return Promise.resolve(null);
}

module.exports = {
  SPY_PAGE,
  SPEAK_ROUND_MS,
  SPEAK_TURN_MS,
  VOTE_ROUND_MS,
  MIN_PLAYERS,
  formatCountdown,
  computeMsLeft,
  getDefaultSpyCount,
  roleLabel,
  winnerLabel,
  buildSpyPageUrl,
  filterPlayerMembers,
  parseIsHostOption,
  captureSpyCommandContext,
  spyCommandContextForAction,
  callSpyAction,
  fetchRoomDataOrExit,
  followSubScreenRoomPoll,
  openUrl,
  goRoomPage,
  buildAvatarList,
  buildAvatarListAsync,
  startSpyCountdownTicker,
  safePageSetData,
  samePlayerIndex,
  playerIndexIncludes,
  withSpyRefreshGuard,
  startSpyRoomPoll,
  stopSpyRoomPoll,
  bumpSpyRoomSession
};
