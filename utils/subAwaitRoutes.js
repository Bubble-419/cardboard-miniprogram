const { buildGamepageUrl, buildStatementUrl, buildClosingStatementUrl, buildClosingEndUrl } = require('./modeRoutes');
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
    mainText: '等待房主设置情境',
    mainTextLines: [],
    subText: '等待中...',
    subTextLine1: '房主正在准备本次工作坊的情境内容',
    subTextLine2: '请稍作等待，精彩即将开始~',
    statusText: '正在等待中...',
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

/** 副屏进度序：用于 subAwait 忽略滞后的「回跳」导航 */
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

function resolveSubScreenNavigation(page, roomState, roomId) {
  const p = (page || '').toLowerCase();
  const roomIdEnc = encodeURIComponent(roomId);
  const state = roomState || {};
  const idx = state.currentPlayerIndex != null ? state.currentPlayerIndex : 1;
  const playerName = state.currentPlayerName || `玩家${idx}`;
  const modeId = (getApp().globalData && getApp().globalData.gameMode) || 'partner';

  if (isAwaitPage(p)) {
    return { action: 'await', scene: getSceneForPage(p) };
  }

  const redirectMap = {
    submitproblem: `/pages/main-pages/submitProblem/index?roomId=${roomIdEnc}`,
    selectproblem: `/pages/main-pages/selectProblem/index?roomId=${roomIdEnc}`,
    gamepage: buildGamepageUrl(roomId, idx, modeId, {
      phase: state.partnerGamePhase === 'discussion'
        ? 'discussion'
        : (state.partnerGamePhase === 'closing' ? 'closing' : undefined),
      closingStep: state.partnerClosingStep || undefined
    }),
    statement: buildStatementUrl(roomId, idx, playerName, { isSubScreen: true }),
    closingstatement: buildClosingStatementUrl(roomId),
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
function navigateByRoomState(page, roomState, roomId) {
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

  const nav = resolveSubScreenNavigation(page, roomState, roomId);
  if (!nav) return false;

  if (nav.action === 'await') {
    return openSubAwait(roomId, nav.scene);
  }

  if (nav.action === 'redirect') {
    if (shouldSkipStaleSubScreenRedirect(page)) {
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
