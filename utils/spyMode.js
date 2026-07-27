/**
 * 谁是卧底客户端辅助：导航、倒计时、成员过滤
 */
const { callCloudFunction } = require('./cloudApi');
const {
  SPY_PAGE,
  SPEAK_ROUND_MS,
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
    if (m.role === 'GOD') return false;
    // 主持人端列表不包含自己；兼容尚未下发 role 的旧云函数
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
    if (!page || !page._pageAlive) return;
    const startedAt = typeof getStartedAt === 'function' ? getStartedAt() : getStartedAt;
    const left = computeMsLeft(startedAt, durationMs);
    page.setData({ [dataKey]: formatCountdown(left), countdownMsLeft: left });
  };
  tick();
  return setInterval(tick, 500);
}

module.exports = {
  SPY_PAGE,
  SPEAK_ROUND_MS,
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
  startSpyCountdownTicker
};
