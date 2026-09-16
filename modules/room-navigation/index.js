'use strict';

const ROUTES = Object.freeze({
  addPlayer: { path: '/pages/main-pages/addPlayer/index', mode: 'reLaunch', pageKey: 'addplayer' },
  modeIndex: { path: '/pages/main-pages/modeIndex/index', mode: 'redirectTo', pageKey: 'modeindex' },
  subAwait: { path: '/pages/sub-pages/subAwait/index', mode: 'redirectTo', pageKey: 'subawait' },
  submitProblem: { path: '/pages/main-pages/submitProblem/index', mode: 'redirectTo', pageKey: 'submitproblem' },
  selectProblem: { path: '/pages/main-pages/selectProblem/index', mode: 'redirectTo', pageKey: 'selectproblem' },
  selectPlayer: { path: '/pages/main-pages/selectPlayer/index', mode: 'redirectTo', pageKey: 'selectplayer' },
  confirmFirstPlayer: { path: '/pages/main-pages/partnerMode/confirmFirstPlayer/index', mode: 'redirectTo', pageKey: 'confirmfirstplayer' },
  partnerGame: { path: '/pages/main-pages/partnerMode/gamepage/index', mode: 'redirectTo', pageKey: 'gamepage' },
  closingStatement: { path: '/pages/main-pages/partnerMode/closingStatement/index', mode: 'redirectTo', pageKey: 'closingstatement' },
  leaderboard: { path: '/pages/leaderboard/index', mode: 'redirectTo', pageKey: 'leaderboard' },
  halliGame: { path: '/pages/main-pages/halliGalli/gamepage/index', mode: 'redirectTo', pageKey: 'gamepage' },
  creativeInput: { path: '/pages/main-pages/creativeInput/index', mode: 'redirectTo', pageKey: 'creativeinput' },
  creativeSummary: { path: '/pages/main-pages/creativeSummary/index', mode: 'redirectTo', pageKey: 'creativesummary' },
  spyIntro: { path: '/packageSpy/pages/modeIndex/index', mode: 'redirectTo', pageKey: 'spymodeindex' },
  spySpeak: { path: '/packageSpy/pages/speak/index', mode: 'redirectTo', pageKey: 'spyspeak' },
  spyVote: { path: '/packageSpy/pages/vote/index', mode: 'redirectTo', pageKey: 'spyvote' },
  spyResult: { path: '/packageSpy/pages/result/index', mode: 'redirectTo', pageKey: 'spyresult' },
  spySettle: { path: '/packageSpy/pages/settle/index', mode: 'redirectTo', pageKey: 'spysettle' }
});

/** 叠层归属：仍停在所属 route 时不拆；route 一旦离开所属页就跟随。`*` 表示除回大厅外都保留。 */
const OVERLAY_OWNERS = Object.freeze({
  'pages/inspiration/index': '*',
  'pages/main-pages/case/index': '*',
  'pages/main-pages/partnerMode/imageCrop/index': '*',
  'pages/main-pages/partnerMode/specialMove/index': ['partnerGame'],
  'packageSpy/pages/cardLibrary/index': '*',
  'pages/main-pages/brainstormMode/index': ['addPlayer'],
  'pages/main-pages/selectBG/index': ['modeIndex'],
  'pages/main-pages/partnerMode/confirmBG/index': ['modeIndex']
});

function currentPage() {
  if (typeof getCurrentPages !== 'function') return null;
  const pages = getCurrentPages();
  return pages.length ? pages[pages.length - 1] : null;
}

function isReadOnlyConfirmOverlay(page) {
  if (!page || page.route !== 'pages/main-pages/partnerMode/confirmBG/index') return false;
  const data = page.data || {};
  return !!(page._fromGameView || data.fromGameView
    || ['game', 'select', 'submit'].includes(String(data.from || '')));
}

function isLocalOverlay(current, routeName) {
  const page = currentPage();
  if (isReadOnlyConfirmOverlay(page)) return routeName !== 'addPlayer';
  const owners = OVERLAY_OWNERS[current];
  if (!owners) return false;
  if (owners === '*') return routeName !== 'addPlayer';
  return owners.includes(routeName);
}

function queryString(params) {
  return Object.entries(params || {}).filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
}

function describeRoute(route, roomId) {
  if (!route || !ROUTES[route.name]) return null;
  const config = ROUTES[route.name];
  const query = queryString({ roomId, ...(route.params || {}) });
  return { ...config, name: route.name, url: `${config.path}${query ? `?${query}` : ''}` };
}

function currentPath() {
  if (typeof getCurrentPages !== 'function') return '';
  const pages = getCurrentPages();
  return pages.length ? pages[pages.length - 1].route : '';
}

function createNavigationCoordinator(options) {
  const open = options && options.open;
  let lastSeq = 0;
  let lastRoomId = '';
  let active = false;
  let pending = null;

  async function reconcile(route, seq, context) {
    const nextSeq = Number(seq) || 0;
    const nextRoomId = String(context && context.roomId || '');
    if (nextRoomId !== lastRoomId) {
      // Event seq 只在单个 Room 内单调；跨房后必须重置导航水位。
      lastRoomId = nextRoomId;
      lastSeq = 0;
      pending = null;
    }
    if (nextSeq < lastSeq) return { ok: false, skipped: true, reason: 'STALE_SEQ' };
    const descriptor = describeRoute(route, context && context.roomId);
    if (!descriptor) return { ok: false, skipped: true, reason: 'UNKNOWN_ROUTE' };
    const current = currentPath();
    if (current === descriptor.path.slice(1)) { lastSeq = nextSeq; return { ok: true, skipped: true, reason: 'SAME_ROUTE' }; }
    // 灵感/裁剪/选模式/填情境等叠层：仍属于当前 route 时不拆；route 变化后跟随。
    if (current && isLocalOverlay(current, route.name)) {
      return { ok: false, skipped: true, reason: 'LOCAL_OVERLAY' };
    }
    if (context && typeof context.beforeNavigate === 'function'
      && context.beforeNavigate(context.pageSnapshot, descriptor.pageKey) === true) {
      lastSeq = nextSeq;
      return { ok: true, skipped: true, reason: 'HANDLED' };
    }
    if (active) {
      pending = { route, seq: nextSeq, context };
      return { ok: false, skipped: true, reason: 'IN_FLIGHT' };
    }
    active = true;
    try {
      lastSeq = nextSeq;
      if (typeof open === 'function') await open(descriptor);
      else if (typeof wx !== 'undefined' && typeof wx[descriptor.mode] === 'function') {
        await new Promise((resolve) => wx[descriptor.mode]({ url: descriptor.url, complete: resolve }));
      }
      return { ok: true };
    } finally {
      active = false;
      if (pending) {
        const next = pending; pending = null;
        reconcile(next.route, next.seq, next.context);
      }
    }
  }

  return { reconcile, getLastSeq: () => lastSeq, getLastRoomId: () => lastRoomId };
}

module.exports = { ROUTES, describeRoute, createNavigationCoordinator };
