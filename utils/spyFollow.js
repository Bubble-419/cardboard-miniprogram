/**
 * 谁是卧底：参与者跟随房主页面（防抖，避免轮询 redirect 白屏）
 */
const { getCurrentRoute, openUrl } = require('./pageNavigate');
const { buildSpyPageUrl } = require('./modeRoutes');

const SPY_ROUTE_BY_PAGE = {
  spymodeindex: 'pages/main-pages/spyMode/modeIndex/index',
  spyassign: 'pages/main-pages/spyMode/assign/index',
  spyspeak: 'pages/main-pages/spyMode/speak/index',
  spyvote: 'pages/main-pages/spyMode/vote/index',
  spyresult: 'pages/main-pages/spyMode/result/index',
  spynextround: 'pages/main-pages/spyMode/nextRound/index',
  spysettle: 'pages/main-pages/spyMode/settle/index'
};

const PHASE_TO_PAGE = {
  intro: 'spymodeindex',
  assign: 'spyassign',
  speak: 'spyspeak',
  vote: 'spyvote',
  result: 'spyresult',
  nextRound: 'spynextround',
  settle: 'spysettle'
};

const PAGE_TO_BUILD_KEY = {
  spymodeindex: 'intro',
  spyassign: 'assign',
  spyspeak: 'speak',
  spyvote: 'vote',
  spyresult: 'result',
  spynextround: 'nextRound',
  spysettle: 'settle'
};

const _lock = {
  targetRoute: '',
  until: 0
};

function resolveSpyTargetPage(roomState) {
  const state = roomState || {};
  const page = String(state.currentPage || '').toLowerCase();
  if (SPY_ROUTE_BY_PAGE[page]) return page;

  const phase = state.spyGame && state.spyGame.phase;
  if (phase && PHASE_TO_PAGE[phase]) return PHASE_TO_PAGE[phase];

  return '';
}

/**
 * 参与者根据房间状态跳到对应 spy 页。
 * 已在目标页 / 导航锁期内不重复跳，降低白屏风险。
 */
function followSpyRoomState(result, roomId, options = {}) {
  if (!result || result.ok !== true) return false;
  if (result.isHost === true && options.allowHost !== true) return false;

  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  if (!id) return false;

  const targetPage = resolveSpyTargetPage(result.roomState);
  if (!targetPage) return false;

  const targetRoute = SPY_ROUTE_BY_PAGE[targetPage];
  const currentRoute = getCurrentRoute();
  if (!targetRoute || currentRoute === targetRoute) return false;

  // 仅停留在「本页」时由调用方自行处理；这里负责跨页跟随
  if (options.stayOnPage && options.stayOnPage === targetPage) {
    return false;
  }

  const now = Date.now();
  if (_lock.targetRoute === targetRoute && now < _lock.until) {
    return false;
  }

  _lock.targetRoute = targetRoute;
  _lock.until = now + 2800;

  const buildKey = PAGE_TO_BUILD_KEY[targetPage] || 'intro';
  const url = buildSpyPageUrl(buildKey, id);
  return openUrl(url, { immediate: true, noReLaunch: true });
}

function clearSpyFollowLock() {
  _lock.targetRoute = '';
  _lock.until = 0;
}

module.exports = {
  SPY_ROUTE_BY_PAGE,
  resolveSpyTargetPage,
  followSpyRoomState,
  clearSpyFollowLock
};
