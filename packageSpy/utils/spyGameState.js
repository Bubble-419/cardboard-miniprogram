/** 谁是卧底：相位、成员过滤与文案。业务时长/胜负只消费服务端锚点。 */

const SPY_PHASE = {
  INTRO: 'intro',
  SPEAK: 'speak',
  VOTE: 'vote',
  RESULT: 'result',
  SETTLE: 'settle'
};

const SPY_PAGE = {
  intro: 'spymodeindex',
  speak: 'spyspeak',
  vote: 'spyvote',
  result: 'spyresult',
  settle: 'spysettle'
};

const MIN_PLAYERS = 3;

function getDefaultSpyCount(playerCount) {
  const n = Number(playerCount) || 0;
  if (n < 3) return 0;
  if (n <= 6) return 1;
  return 2;
}

function formatCountdown(msLeft) {
  const clamped = Math.max(0, Math.floor(msLeft / 1000));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s < 10 ? `0${s}` : s}`;
}

function computeMsLeft(startedAt, durationMs, now = Date.now()) {
  if (!startedAt) return durationMs;
  return Math.max(0, durationMs - (now - Number(startedAt)));
}

function roleLabel(role) {
  if (role === 'spy') return '卧底';
  if (role === 'civilian') return '平民';
  return '未知';
}

function winnerLabel(side) {
  if (side === 'spy') return '卧底胜利';
  if (side === 'civilian') return '平民胜利';
  return '';
}

/**
 * 结算页玩家-词语对照。服务端 reveal 用 nickName，页面模型可能已合并到 players。
 */
function buildSpyRevealPlayers(spyGame) {
  const game = spyGame || {};
  const players = Array.isArray(game.players) ? game.players : [];
  const byMemberId = {};
  players.forEach((player) => {
    if (player && player.memberId) byMemberId[player.memberId] = player;
  });

  let source = [];
  if (Array.isArray(game.reveal) && game.reveal.length) {
    source = game.reveal;
  } else if (Array.isArray(game.lastResult && game.lastResult.reveal) && game.lastResult.reveal.length) {
    source = game.lastResult.reveal;
  } else {
    source = players.filter((player) => player && (player.role || player.word));
  }

  return source.map((item) => {
    const player = (item && item.memberId && byMemberId[item.memberId]) || {};
    const role = item.role || player.role || null;
    const playerIndex = item.playerIndex != null
      ? Number(item.playerIndex)
      : (player.playerIndex != null ? Number(player.playerIndex) : null);
    return {
      memberId: item.memberId || player.memberId || null,
      playerIndex,
      name: item.name || item.nickName || player.name || player.nickName || '',
      word: item.word || player.word || '',
      role,
      roleLabel: roleLabel(role),
      alive: item.alive !== false && player.alive !== false
    };
  }).sort((a, b) => {
    const left = a.playerIndex == null ? Number.MAX_SAFE_INTEGER : a.playerIndex;
    const right = b.playerIndex == null ? Number.MAX_SAFE_INTEGER : b.playerIndex;
    return left - right;
  });
}

function pageForPhase(phase) {
  return SPY_PAGE[phase] || SPY_PAGE.intro;
}

function phaseForPage(page) {
  const p = (page || '').toLowerCase();
  const map = {
    spymodeindex: SPY_PHASE.INTRO,
    spyspeak: SPY_PHASE.SPEAK,
    spyvote: SPY_PHASE.VOTE,
    spyresult: SPY_PHASE.RESULT,
    spysettle: SPY_PHASE.SETTLE
  };
  return map[p] || null;
}

module.exports = {
  SPY_PHASE,
  SPY_PAGE,
  MIN_PLAYERS,
  getDefaultSpyCount,
  formatCountdown,
  computeMsLeft,
  roleLabel,
  winnerLabel,
  buildSpyRevealPlayers,
  pageForPhase,
  phaseForPage
};
