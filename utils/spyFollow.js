/**
 * 谁是卧底：参与者跟随房主页面（防抖，避免轮询 redirect 白屏）
 */
const { getCurrentRoute, openUrl } = require('./pageNavigate');
const { buildSpyPageUrl } = require('./modeRoutes');

const ADD_PLAYER_ROUTE = 'pages/main-pages/addPlayer/index';

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

/** 主动回大厅时全局抑制跟随（覆盖游戏页在途轮询竞态） */
const _lobbyStay = {
  roomId: '',
  active: false
};

function setSpyLobbyStay(roomId) {
  const id = roomId || '';
  _lobbyStay.roomId = String(id);
  _lobbyStay.active = !!id;
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.spyStayOnLobbyRoomId = id || null;
    }
  } catch (e) {
    // ignore
  }
}

function clearSpyLobbyStay() {
  _lobbyStay.roomId = '';
  _lobbyStay.active = false;
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.spyStayOnLobbyRoomId = null;
    }
  } catch (e) {
    // ignore
  }
}

function isSpyLobbyStayActive(roomId) {
  if (!_lobbyStay.active) {
    try {
      const app = getApp();
      const gid = app && app.globalData && app.globalData.spyStayOnLobbyRoomId;
      if (gid) {
        _lobbyStay.roomId = String(gid);
        _lobbyStay.active = true;
      }
    } catch (e) {
      // ignore
    }
  }
  if (!_lobbyStay.active) return false;
  if (!roomId) return true;
  return String(_lobbyStay.roomId) === String(roomId);
}

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

  // 主动停留大厅：禁止任何跟随拉回游戏（除非 force，如点「继续游戏」）
  if (options.force !== true && isSpyLobbyStayActive(id)) {
    return false;
  }

  const targetPage = resolveSpyTargetPage(result.roomState);
  if (!targetPage) return false;

  const targetRoute = SPY_ROUTE_BY_PAGE[targetPage];
  const currentRoute = getCurrentRoute();
  if (!targetRoute || currentRoute === targetRoute) return false;

  // 仅停留在「本页」时由调用方自行处理；这里负责跨页跟随
  if (options.stayOnPage && options.stayOnPage === targetPage) {
    return false;
  }

  // 未 force 时，已在大厅则不拉走（防御二次保险）
  if (options.force !== true && currentRoute === ADD_PLAYER_ROUTE && isSpyLobbyStayActive(id)) {
    return false;
  }

  const now = Date.now();
  if (_lock.targetRoute === targetRoute && now < _lock.until) {
    return false;
  }

  const buildKey = PAGE_TO_BUILD_KEY[targetPage] || 'intro';
  const url = buildSpyPageUrl(buildKey, id);
  const navigated = openUrl(url, { immediate: true, noReLaunch: true });
  // 仅导航真正发起后加锁；openUrl 拒绝/入队失败时不锁，避免卡住后续跟随
  if (navigated) {
    _lock.targetRoute = targetRoute;
    _lock.until = now + 2800;
  }
  return navigated;
}

function clearSpyFollowLock() {
  _lock.targetRoute = '';
  _lock.until = 0;
}

module.exports = {
  SPY_ROUTE_BY_PAGE,
  resolveSpyTargetPage,
  followSpyRoomState,
  clearSpyFollowLock,
  setSpyLobbyStay,
  clearSpyLobbyStay,
  isSpyLobbyStayActive
};
