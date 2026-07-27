/** 谁是卧底：相位、时长、卧底数与胜负判定 */

const SPY_PHASE = {
  INTRO: 'intro',
  ASSIGN: 'assign',
  SPEAK: 'speak',
  VOTE: 'vote',
  RESULT: 'result',
  NEXT_ROUND: 'nextRound',
  SETTLE: 'settle'
};

const SPY_PAGE = {
  intro: 'spymodeindex',
  assign: 'spyassign',
  speak: 'spyspeak',
  vote: 'spyvote',
  result: 'spyresult',
  nextRound: 'spynextround',
  settle: 'spysettle'
};

const SPEAK_ROUND_MS = 5 * 60 * 1000;
const VOTE_ROUND_MS = 2 * 60 * 1000;
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

/**
 * @param {Array<{role:string,alive:boolean}>} players
 * @returns {'civilian'|'spy'|null}
 */
function resolveWinnerSide(players) {
  const alive = (players || []).filter((p) => p && p.alive !== false);
  const spies = alive.filter((p) => p.role === 'spy');
  const civilians = alive.filter((p) => p.role === 'civilian');
  if (spies.length === 0) return 'civilian';
  if (spies.length >= civilians.length) return 'spy';
  return null;
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

function pageForPhase(phase) {
  return SPY_PAGE[phase] || SPY_PAGE.intro;
}

function phaseForPage(page) {
  const p = (page || '').toLowerCase();
  const map = {
    spymodeindex: SPY_PHASE.INTRO,
    spyassign: SPY_PHASE.ASSIGN,
    spyspeak: SPY_PHASE.SPEAK,
    spyvote: SPY_PHASE.VOTE,
    spyresult: SPY_PHASE.RESULT,
    spynextround: SPY_PHASE.NEXT_ROUND,
    spysettle: SPY_PHASE.SETTLE
  };
  return map[p] || null;
}

module.exports = {
  SPY_PHASE,
  SPY_PAGE,
  SPEAK_ROUND_MS,
  VOTE_ROUND_MS,
  MIN_PLAYERS,
  getDefaultSpyCount,
  formatCountdown,
  computeMsLeft,
  resolveWinnerSide,
  roleLabel,
  winnerLabel,
  pageForPhase,
  phaseForPage
};
