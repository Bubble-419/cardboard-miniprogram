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

function getSceneUI(scene) {
  return SCENE_UI[scene] || SCENE_UI.bg;
}

function isAwaitPage(page) {
  return Object.prototype.hasOwnProperty.call(AWAIT_PAGE_TO_SCENE, (page || '').toLowerCase());
}

function getSceneForPage(page) {
  return AWAIT_PAGE_TO_SCENE[(page || '').toLowerCase()] || 'bg';
}

function getCurrentRoute() {
  const pages = getCurrentPages();
  if (!pages.length) return '';
  return pages[pages.length - 1].route || '';
}

function normalizeRoute(url) {
  return (url || '').replace(/^\//, '').split('?')[0];
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
  const name = encodeURIComponent(state.currentPlayerName || `玩家${idx}`);

  if (isAwaitPage(p)) {
    return { action: 'await', scene: getSceneForPage(p) };
  }

  const redirectMap = {
    submitproblem: `/pages/main-pages/submitProblem/index?roomId=${roomIdEnc}`,
    selectproblem: `/pages/main-pages/selectProblem/index?roomId=${roomIdEnc}`,
    gamepage: `/pages/main-pages/halliGalli/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`,
    statement: `/pages/main-pages/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isSubScreen=1`,
    discussion: `/pages/main-pages/discussion/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}`,
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

/** 打开 subAwait：已在该页则只切换 scene，否则 reLaunch 避免 redirectTo 失败导致退回首页 */
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
  wx.reLaunch({
    url,
    fail: (err) => {
      console.warn('reLaunch subAwait failed', err, url);
    }
  });
  return true;
}

let _navLock = false;

function safeOpenUrl(url) {
  const targetRoute = normalizeRoute(url);
  const currentRoute = getCurrentRoute();
  if (currentRoute === targetRoute) {
    return false;
  }

  if (_navLock) return false;
  _navLock = true;
  setTimeout(() => {
    _navLock = false;
  }, 800);

  wx.redirectTo({
    url,
    fail: (err) => {
      console.warn('redirectTo failed, try reLaunch', err, url);
      wx.reLaunch({
        url,
        fail: (err2) => console.warn('reLaunch failed', err2, url)
      });
    },
    complete: () => {
      setTimeout(() => {
        _navLock = false;
      }, 300);
    }
  });
  return true;
}

/** 副屏轮询：根据主屏 currentPage 跳转至 subAwait 或业务页 */
function navigateByRoomState(page, roomState, roomId) {
  const nav = resolveSubScreenNavigation(page, roomState, roomId);
  if (!nav) return false;

  if (nav.action === 'await') {
    return openSubAwait(roomId, nav.scene);
  }

  if (nav.action === 'redirect') {
    return safeOpenUrl(nav.url);
  }

  return false;
}

module.exports = {
  SUB_AWAIT_ROUTE,
  AWAIT_PAGE_TO_SCENE,
  SCENE_UI,
  getSceneUI,
  isAwaitPage,
  getSceneForPage,
  getCurrentRoute,
  buildSubAwaitUrl,
  resolveSubScreenNavigation,
  applySubAwaitScene,
  openSubAwait,
  navigateByRoomState
};
