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

function buildSpyPageUrl(pageKey, roomId, query = {}) {
  const roomIdEnc = encodeURIComponent(roomId || '');
  const pathMap = {
    intro: '/pages/main-pages/spyMode/modeIndex/index',
    cardLibrary: '/pages/main-pages/spyMode/cardLibrary/index',
    assign: '/pages/main-pages/spyMode/assign/index',
    speak: '/pages/main-pages/spyMode/speak/index',
    vote: '/pages/main-pages/spyMode/vote/index',
    result: '/pages/main-pages/spyMode/result/index',
    nextRound: '/pages/main-pages/spyMode/nextRound/index',
    settle: '/pages/main-pages/spyMode/settle/index'
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

async function callSpyAction(action, data = {}) {
  const res = await callCloudFunction('spyGameAction', { action, ...data });
  return (res && res.result) || {};
}

function startSpyCountdownTicker(page, getStartedAt, durationMs, dataKey = 'countdownText') {
  const tick = () => {
    if (!page || page._pageAlive === false) return;
    try {
      const startedAt = typeof getStartedAt === 'function' ? getStartedAt() : getStartedAt;
      const left = computeMsLeft(startedAt, durationMs);
      page.setData({ [dataKey]: formatCountdown(left), countdownMsLeft: left });
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
  followSubScreenRoomPoll,
  openUrl,
  goRoomPage,
  buildAvatarList,
  startSpyCountdownTicker,
  safePageSetData,
  samePlayerIndex,
  playerIndexIncludes,
  withSpyRefreshGuard
};
