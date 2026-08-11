/**
 * 谁是卧底客户端辅助：导航、倒计时、成员过滤
 */
const { callCloudFunction } = require('./cloudApi');
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
const { buildAvatarList } = require('./avatars');
const { handleRoomGoneFromResult } = require('./roomDissolved');
const { handleRoomLastEvent } = require('./roomMembersSync');

/** 拉取房间；若已解散/不在房间则统一回首页并返回 null */
async function fetchRoomDataOrExit(roomId) {
  const res = await callCloudFunction('getAddPlayerData', { roomId });
  const result = (res && res.result) || {};
  if (handleRoomGoneFromResult(result, roomId)) return null;
  // 只剩 1 人回退房间：停止局内 UI 更新
  if (handleRoomLastEvent(result, roomId)) return null;
  return result;
}

function buildSpyPageUrl(pageKey, roomId, query = {}) {
  const roomIdEnc = encodeURIComponent(roomId || '');
  const pathMap = {
    intro: '/packageSpy/pages/modeIndex/index',
    cardLibrary: '/packageSpy/pages/cardLibrary/index',
    assign: '/packageSpy/pages/assign/index',
    speak: '/packageSpy/pages/speak/index',
    vote: '/packageSpy/pages/vote/index',
    result: '/packageSpy/pages/result/index',
    nextRound: '/packageSpy/pages/nextRound/index',
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

const SPY_PROTOCOL_VERSION = 2;

function makeSpyCommandId(action) {
  return `spy_${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function fetchRoomRevision(roomId) {
  const res = await callCloudFunction('getAddPlayerData', { roomId });
  const result = (res && res.result) || {};
  if (result.revision != null && Number.isFinite(Number(result.revision))) {
    return Number(result.revision);
  }
  const rs = result.roomState || {};
  if (rs.revision != null && Number.isFinite(Number(rs.revision))) {
    return Number(rs.revision);
  }
  return 0;
}

function normalizeSpyCommandResult(result) {
  if (!result) return { ok: false, errCode: 'EMPTY_RESULT', errMsg: '无返回' };
  if (result.ok !== true) return result;
  const effects = result.effects || {};
  return {
    ...result,
    spyGame: result.spyGame != null ? result.spyGame : effects.spyGame,
    currentPage: result.currentPage != null ? result.currentPage : effects.legacyPage,
    card: result.card != null ? result.card : effects.card,
    settled: result.settled != null ? result.settled : effects.settled,
    tied: result.tied != null ? result.tied : effects.tied,
    finished: result.finished != null ? result.finished : effects.finished,
    autoVote: result.autoVote != null ? result.autoVote : effects.autoVote,
    already: result.already != null ? result.already : effects.already
  };
}

/**
 * Spy 写操作：经 roomCommand（V2）。兼容旧 action 名。
 * 需要 revision 的命令会先拉一次 getAddPlayerData。
 */
async function callSpyAction(action, data = {}) {
  const roomId = data && data.roomId;
  if (!action || !roomId) {
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'action 与 roomId 必填' };
  }

  const needsRevision = !(
    action === 'getMyCard'
    || action === 'submitVote'
  );

  let expectedRevision = data.expectedRevision;
  if (needsRevision && expectedRevision == null) {
    try {
      expectedRevision = await fetchRoomRevision(roomId);
    } catch (e) {
      return {
        ok: false,
        errCode: 'DEPENDENCY_UNAVAILABLE',
        errMsg: '读取房间版本失败，请重试'
      };
    }
  }

  let type = null;
  let payload = {};

  switch (action) {
    case 'startAssign':
    case 'startGame':
      type = 'SPY_START_ASSIGN';
      break;
    case 'getMyCard':
      type = 'SPY_GET_MY_CARD';
      break;
    case 'advanceSpeak':
    case 'finishSpeak':
      type = 'SPY_ADVANCE_SPEAKER';
      break;
    case 'startVote':
      type = 'SPY_ADVANCE_SPEAKER';
      payload = { forceVote: true };
      break;
    case 'submitVote':
      type = 'SPY_SUBMIT_VOTE';
      payload = data.abstain
        ? { abstain: true }
        : { targetPlayerIndex: data.targetPlayerIndex };
      break;
    case 'nextRound':
    case 'continueRound':
      type = 'SPY_NEXT_ROUND';
      break;
    case 'restart':
      type = 'SPY_RESTART';
      break;
    default:
      return { ok: false, errCode: 'UNKNOWN_ACTION', errMsg: `未知 action: ${action}` };
  }

  const envelope = {
    protocolVersion: SPY_PROTOCOL_VERSION,
    commandId: data.commandId || makeSpyCommandId(action),
    type,
    roomId: String(roomId),
    payload,
    clientSentAt: Date.now()
  };
  if (needsRevision) {
    envelope.expectedRevision = Number(expectedRevision);
  }

  try {
    const res = await callCloudFunction('roomCommand', envelope);
    return normalizeSpyCommandResult((res && res.result) || {});
  } catch (e) {
    return {
      ok: false,
      errCode: (e && e.errCode) || 'ROOM_COMMAND_ERROR',
      errMsg: (e && e.errMsg) || (e && e.message) || 'roomCommand 调用失败'
    };
  }
}

/** onTick(msLeft) 可选：每次刷新倒计时后回调，用于超时自动动作（如投票页弃票） */
function startSpyCountdownTicker(page, getStartedAt, durationMs, dataKey = 'countdownText', onTick) {
  const tick = () => {
    if (!page || page._pageAlive === false) return;
    try {
      const startedAt = typeof getStartedAt === 'function' ? getStartedAt() : getStartedAt;
      const left = computeMsLeft(startedAt, durationMs);
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
function safePageSetData(page, data) {
  if (!page || page._pageAlive === false || !data) return false;
  try {
    page.setData(data);
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
 * Spy 读路径：挂 App 级 RoomSession（同房 reconfigure，不 dispose）。
 * - emitCurrent:false：进页不立刻同步回放，避免首屏布局被二次 setData 打坏
 * - 首屏仍由页面自己 refresh()/fetch 完成
 * - onPollResult 收到的是 getAddPlayerData 原始 result（snapshot.raw）
 */
function startSpyRoomPoll(page, options) {
  if (!page) return Promise.resolve(null);
  const intervalMs = (options && options.intervalMs) || 1000;
  const onPollResult = options && options.onPollResult;

  if (page._pollTimer) {
    clearInterval(page._pollTimer);
    page._pollTimer = null;
  }

  const {
    bindPageToRoomSession
  } = require('../modules/room-session/index');

  return bindPageToRoomSession(page, {
    getRoomId() {
      return page.data && page.data.roomId;
    },
    intervalMs,
    full: false,
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
      if (handleRoomLastEvent(raw, roomId)) return;
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
  if (page._pollTimer) {
    clearInterval(page._pollTimer);
    page._pollTimer = null;
  }
  try {
    const { unbindPageFromRoomSession } = require('../modules/room-session/index');
    unbindPageFromRoomSession(page);
  } catch (e) {
    // ignore
  }
}

/** 写命令后主动拉一次会话，避免等下一轮 poll */
function bumpSpyRoomSession() {
  try {
    const { getActiveRoomSession } = require('../modules/room-session/index');
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
  callSpyAction,
  callCloudFunction,
  fetchRoomDataOrExit,
  followSubScreenRoomPoll,
  openUrl,
  goRoomPage,
  buildAvatarList,
  startSpyCountdownTicker,
  safePageSetData,
  samePlayerIndex,
  playerIndexIncludes,
  withSpyRefreshGuard,
  startSpyRoomPoll,
  stopSpyRoomPoll,
  bumpSpyRoomSession
};
