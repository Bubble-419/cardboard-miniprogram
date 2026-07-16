const {
  buildGamepageUrl,
  buildStatementUrl,
  buildClosingStatementUrl,
  buildClosingEndUrl,
  getSelectedModeId
} = require('./modeRoutes');
const {
  getCurrentRoute,
  normalizeRoute,
  openUrl,
  safeOpenUrl,
  openPartnerPage
} = require('./pageNavigate');

/** 副屏等待态：停留在 subAwait 并根据 scene 切换 UI */
const SUB_AWAIT_ROUTE = 'pages/sub-pages/subAwait/index';

const AWAIT_PAGE_TO_SCENE = {
  auth: 'bg',
  selectbg: 'bg',
  confirmbg: 'bg',
  selectmode: 'mode',
  selectplayer: 'player',
  confirmfirstplayer: 'confirmFirstPlayer'
};

const SCENE_UI = {
  bg: {
    navbarTitle: '',
    mainText: '等待主屏选择情境',
    mainTextLines: [],
    subText: '等待中...',
    multiLine: false
  },
  mode: {
    navbarTitle: '',
    mainText: '等待主屏幕选择游戏模式和目标',
    mainTextLines: [],
    subText: '等待中...',
    multiLine: false
  },
  player: {
    navbarTitle: '确认首位翻牌玩家',
    mainText: '',
    mainTextLines: ['请到主屏幕上抽取', '首位翻牌玩家'],
    subText: '等待中...',
    multiLine: true
  },
  confirmFirstPlayer: {
    navbarTitle: '确认首位出牌玩家',
    mainText: '等待房主确认首位出牌玩家',
    mainTextLines: [],
    subText: '等待中...',
    multiLine: false
  }
};

const PAGE_PROGRESS_RANK = {
  addplayer: 0,
  auth: 10,
  selectbg: 10,
  confirmbg: 10,
  submitproblem: 20,
  selectproblem: 30,
  selectmode: 40,
  selectplayer: 50,
  confirmfirstplayer: 60,
  gamepage: 70,
  creativeinput: 80,
  creativesummary: 90,
  statement: 100,
  closingstatement: 105,
  discussion: 110,
  closingend: 115,
  leaderboard: 120
};

const ROUTE_TO_PAGE = {
  'pages/main-pages/addPlayer/index': 'addplayer',
  'pages/main-pages/submitProblem/index': 'submitproblem',
  'pages/main-pages/selectProblem/index': 'selectproblem',
  'pages/main-pages/selectMode/index': 'selectmode',
  'pages/main-pages/selectPlayer/index': 'selectplayer',
  'pages/main-pages/partnerMode/confirmFirstPlayer/index': 'confirmfirstplayer',
  'pages/main-pages/halliGalli/gamepage/index': 'gamepage',
  'pages/main-pages/partnerMode/gamepage/index': 'gamepage',
  'pages/main-pages/creativeInput/index': 'creativeinput',
  'pages/main-pages/creativeSummary/index': 'creativesummary',
  'pages/main-pages/partnerMode/statement/index': 'statement',
  'pages/main-pages/partnerMode/closingStatement/index': 'closingstatement',
  'pages/main-pages/partnerMode/closingEnd/index': 'closingend',
  'pages/main-pages/discussion/index': 'discussion',
  'pages/leaderboard/index': 'leaderboard'
};

function getPageKeyForCurrentRoute() {
  return ROUTE_TO_PAGE[getCurrentRoute()] || '';
}

/** 已在较新页面时，忽略滞后的房间状态回跳（如已在 summary 时被拉回 input） */
function shouldSkipStaleBackwardRedirect(targetPage) {
  const currentPage = getPageKeyForCurrentRoute();
  const target = (targetPage || '').toLowerCase();
  const staleTargetsByCurrent = {
    creativesummary: ['creativeinput', 'gamepage', 'playsuccess', 'playfail']
  };
  const staleTargets = staleTargetsByCurrent[currentPage];
  return Array.isArray(staleTargets) && staleTargets.includes(target);
}

const SCENE_PROGRESS_RANK = {
  bg: 10,
  mode: 40,
  player: 50,
  confirmFirstPlayer: 60
};

function getSceneUI(scene) {
  return SCENE_UI[scene] || SCENE_UI.bg;
}

function isAwaitPage(page) {
  return Object.prototype.hasOwnProperty.call(AWAIT_PAGE_TO_SCENE, (page || '').toLowerCase());
}

function getSceneForPage(page) {
  return AWAIT_PAGE_TO_SCENE[(page || '').toLowerCase()] || 'bg';
}

function getPageProgressRank(page) {
  return PAGE_PROGRESS_RANK[(page || '').toLowerCase()] ?? -1;
}

function getSceneProgressRank(scene) {
  return SCENE_PROGRESS_RANK[scene] ?? 0;
}

function getCurrentSubAwaitScene() {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (current && current.route === SUB_AWAIT_ROUTE && current.data) {
    return current.data.scene || 'bg';
  }
  return '';
}

/** subAwait 已处于较新等待态时，忽略滞后的业务页回跳（如 selectMode 时误跳 selectProblem） */
function shouldSkipStaleSubScreenRedirect(targetPage) {
  if (getCurrentRoute() !== SUB_AWAIT_ROUTE) return false;
  const scene = getCurrentSubAwaitScene();
  const sceneRank = getSceneProgressRank(scene);
  const targetRank = getPageProgressRank(targetPage);
  return sceneRank > 0 && targetRank >= 0 && targetRank < sceneRank;
}

function buildSubAwaitUrl(roomId, scene) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  let url = `/pages/sub-pages/subAwait/index?roomId=${encodeURIComponent(id)}`;
  if (scene) {
    url += `&scene=${encodeURIComponent(scene)}`;
  }
  return url;
}

function resolveModeIdForNavigation(state) {
  const s = state || {};
  if (s.selectedModeId) return s.selectedModeId;
  if (s.partnerGamePhase === 'discussion' || s.partnerGamePhase === 'closing') {
    return 'partner';
  }
  if (s.selectedDesignProblem && typeof s.selectedDesignProblem === 'object') {
    return 'partner';
  }
  return getSelectedModeId('halliGalli');
}

function resolveHostMainPageUrl(page, roomState, roomId) {
  const p = (page || '').toLowerCase();
  const roomIdEnc = encodeURIComponent(roomId);
  const state = roomState || {};
  const hostMap = {
    auth: `/pages/main-pages/modeIndex/index?roomId=${roomIdEnc}`,
    selectbg: `/pages/main-pages/selectBG/index?roomId=${roomIdEnc}`,
    confirmbg: `/pages/main-pages/partnerMode/confirmBG/index?roomId=${roomIdEnc}`,
    selectmode: `/pages/main-pages/selectMode/index?roomId=${roomIdEnc}`,
    selectplayer: `/pages/main-pages/selectPlayer/index?roomId=${roomIdEnc}&isHost=1`,
    confirmfirstplayer: `/pages/main-pages/partnerMode/confirmFirstPlayer/index?roomId=${roomIdEnc}&isHost=1`
  };
  return hostMap[p] || null;
}

function resolveSubScreenNavigation(page, roomState, roomId, options = {}) {
  const p = (page || '').toLowerCase();
  const roomIdEnc = encodeURIComponent(roomId);
  const state = roomState || {};
  const idx = state.currentPlayerIndex != null ? state.currentPlayerIndex : 1;
  const playerName = state.currentPlayerName || `玩家${idx}`;
  const modeId = resolveModeIdForNavigation(state);
  const isHost = options.isHost === true;

  if (isAwaitPage(p)) {
    if (isHost) {
      const hostUrl = resolveHostMainPageUrl(p, state, roomId);
      if (hostUrl) {
        return { action: 'redirect', url: hostUrl };
      }
    }
    return { action: 'await', scene: getSceneForPage(p) };
  }

  const redirectMap = {
    addplayer: `/pages/main-pages/addPlayer/index?roomId=${roomIdEnc}`,
    submitproblem: `/pages/main-pages/submitProblem/index?roomId=${roomIdEnc}`,
    selectproblem: `/pages/main-pages/selectProblem/index?roomId=${roomIdEnc}`,
    gamepage: buildGamepageUrl(roomId, idx, modeId, {
      phase: state.partnerGamePhase === 'discussion'
        ? 'discussion'
        : (state.partnerGamePhase === 'closing' ? 'closing' : undefined),
      closingStep: state.partnerClosingStep || undefined
    }),
    statement: buildStatementUrl(roomId, idx, playerName, {
      isSubScreen: true,
      isWaiting: true
    }),
    closingstatement: buildClosingStatementUrl(roomId, {
      closingVoteSessionId: state.closingVoteSessionId || '',
      _t: Date.now()
    }),
    closingend: buildClosingEndUrl(roomId),
    discussion: `/pages/main-pages/discussion/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${encodeURIComponent(playerName)}`,
    leaderboard: `/pages/leaderboard/index?roomId=${roomIdEnc}&isSubScreen=1`,
    creativeinput: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}`,
    creativesummary: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}`
  };

  if (redirectMap[p]) {
    return { action: 'redirect', url: redirectMap[p] };
  }

  return null;
}

function applySubAwaitScene(scene) {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (current && current.route === SUB_AWAIT_ROUTE && typeof current.applyScene === 'function') {
    current.applyScene(scene);
    return true;
  }
  return false;
}

let _subAwaitNavLock = false;
let _pendingSubAwaitUrl = '';

function _releaseSubAwaitLock(delay = 2000) {
  setTimeout(() => {
    _subAwaitNavLock = false;
    _pendingSubAwaitUrl = '';
  }, delay);
}

/** 打开 subAwait：已在该页则只切换 scene；否则 redirectTo，避免重复 reLaunch 超时 */
function openSubAwait(roomId, scene) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  if (!id) {
    console.warn('openSubAwait: missing roomId');
    return false;
  }

  if (getCurrentRoute() === SUB_AWAIT_ROUTE) {
    applySubAwaitScene(scene);
    return true;
  }

  const url = buildSubAwaitUrl(id, scene);

  if (_subAwaitNavLock) {
    if (_pendingSubAwaitUrl === url) {
      return false;
    }
    return false;
  }

  _subAwaitNavLock = true;
  _pendingSubAwaitUrl = url;
  openUrl(url);
  setTimeout(() => _releaseSubAwaitLock(), 2000);
  return true;
}

/** 副屏轮询：根据主屏 currentPage 跳转至 subAwait 或业务页 */
function navigateByRoomState(page, roomState, roomId, options = {}) {
  const p = (page || '').toLowerCase();
  const state = roomState || {};
  const current = getCurrentRoute();

  // 大厅页不应被拉回收尾过渡页（避免 closingEnd ↔ addPlayer 振荡）
  if (p === 'closingend' && current === 'pages/main-pages/addPlayer/index') {
    return false;
  }

  if (state.brainstormSessionEnded === true) {
    const staleAfterEnd = ['closingend', 'closingstatement', 'gamepage', 'statement'];
    if (staleAfterEnd.includes(p) && current === 'pages/main-pages/addPlayer/index') {
      return false;
    }
  }

  const nav = resolveSubScreenNavigation(page, roomState, roomId, options);
  if (!nav) return false;

  if (nav.action === 'await') {
    return openSubAwait(roomId, nav.scene);
  }

  if (nav.action === 'redirect') {
    if (shouldSkipStaleSubScreenRedirect(page)) {
      return false;
    }
    if (shouldSkipStaleBackwardRedirect(page)) {
      return false;
    }
    return openUrl(nav.url);
  }

  return false;
}

/** @deprecated 使用 navigateByRoomState */
function followRoomState(page, roomState, roomId) {
  return navigateByRoomState(page, roomState, roomId);
}

module.exports = {
  SUB_AWAIT_ROUTE,
  AWAIT_PAGE_TO_SCENE,
  SCENE_UI,
  getSceneUI,
  isAwaitPage,
  getSceneForPage,
  getPageProgressRank,
  getPageKeyForCurrentRoute,
  shouldSkipStaleBackwardRedirect,
  getSceneProgressRank,
  shouldSkipStaleSubScreenRedirect,
  getCurrentRoute,
  buildSubAwaitUrl,
  resolveSubScreenNavigation,
  applySubAwaitScene,
  openSubAwait,
  navigateByRoomState,
  followRoomState,
  openUrl,
  safeOpenUrl,
  openPartnerPage
};
