'use strict';

const {
  ROOM_SHELL_OWNER,
  ROOM_SHELL_SCREEN,
  classifyRoomShellRoute
} = require('./roomShellRoute');

const ROUTES = Object.freeze({
  addPlayer: { path: '/pages/main-pages/addPlayer/index', mode: 'reLaunch', pageKey: 'addplayer' },
  brainstormMode: { path: '/pages/main-pages/brainstormMode/index', mode: 'redirectTo', pageKey: 'brainstormmode' },
  modeIndex: { path: '/pages/main-pages/modeIndex/index', mode: 'redirectTo', pageKey: 'modeindex' },
  subAwait: { path: '/pages/sub-pages/subAwait/index', mode: 'redirectTo', pageKey: 'subawait' },
  submitProblem: { path: '/pages/main-pages/submitProblem/index', mode: 'redirectTo', pageKey: 'submitproblem' },
  selectProblem: { path: '/pages/main-pages/selectProblem/index', mode: 'redirectTo', pageKey: 'selectproblem' },
  selectPlayer: { path: '/pages/main-pages/selectPlayer/index', mode: 'redirectTo', pageKey: 'selectplayer' },
  confirmFirstPlayer: { path: '/pages/main-pages/partnerMode/confirmFirstPlayer/index', mode: 'redirectTo', pageKey: 'confirmfirstplayer' },
  partnerGame: { path: '/pages/main-pages/partnerMode/gamepage/index', mode: 'redirectTo', pageKey: 'gamepage' },
  // Partner 运行态使用稳定 RoomShell；route 只切换 Shell 内屏幕，不再重建页面实例。
  closingStatement: { path: '/pages/main-pages/partnerMode/gamepage/index', mode: 'redirectTo', pageKey: 'closingstatement' },
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

/** 叠层归属：只在明确所属的权威 route 上保留，route 变化后必须立即跟随。 */
const OVERLAY_OWNERS = Object.freeze({
  'pages/inspiration/index': ['partnerGame'],
  'pages/main-pages/case/index': ['submitProblem'],
  'pages/main-pages/partnerMode/imageCrop/index': ['partnerGame'],
  'pages/main-pages/partnerMode/specialMove/index': ['partnerGame'],
  'packageSpy/pages/cardLibrary/index': ['spyIntro'],
  'pages/main-pages/selectBG/index': ['modeIndex']
});

function currentPage() {
  if (typeof getCurrentPages !== 'function') return null;
  const pages = getCurrentPages();
  return pages.length ? pages[pages.length - 1] : null;
}

function confirmOverlayOwner(page) {
  if (!page || page.route !== 'pages/main-pages/partnerMode/confirmBG/index') return '';
  const data = page.data || {};
  const from = String(page._fromSource || data.from || '');
  // submit/select 回看也会把 fromGameView 设为 true，必须先按来源页归属，不能当成对局叠层。
  if (from === 'select') return 'selectProblem';
  if (from === 'submit') return 'submitProblem';
  if (page._fromGameView || data.fromGameView || from === 'game') return 'partnerGame';
  return 'modeIndex';
}

function isLocalOverlay(current, routeName) {
  const page = currentPage();
  const confirmOwner = confirmOverlayOwner(page);
  if (confirmOwner) return confirmOwner === routeName;
  const owners = OVERLAY_OWNERS[current];
  if (!owners) return false;
  return owners.includes(routeName);
}

function queryString(params) {
  return Object.entries(params || {}).filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
}

function describeRoute(route, roomId) {
  if (!route || !ROUTES[route.name]) return null;
  const params = route.params || {};
  const shell = classifyRoomShellRoute(route);
  const config = shell.owner === ROOM_SHELL_OWNER.PARTNER
    ? ROUTES.partnerGame
    : (shell.owner === ROOM_SHELL_OWNER.SELECT_PLAYER ? ROUTES.selectPlayer : ROUTES[route.name]);
  const shellParams = shell.screen === ROOM_SHELL_SCREEN.CLOSING_VOTE
    ? { roomShellScreen: 'closingVote' }
    : (shell.screen === ROOM_SHELL_SCREEN.WAITING
      ? { roomShellScreen: 'waiting' }
      : {});
  const query = queryString({ roomId, ...shellParams, ...params });
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

  function resolvePendingAsSuperseded() {
    if (!pending) return;
    const previous = pending;
    pending = null;
    previous.waiters.forEach(({ resolve }) => resolve({
      ok: false,
      skipped: true,
      reason: 'SUPERSEDED'
    }));
  }

  async function reconcile(route, seq, context) {
    const nextSeq = Number(seq) || 0;
    const nextRoomId = String(context && context.roomId || '');
    if (nextRoomId !== lastRoomId) {
      // Event seq 只在单个 Room 内单调；跨房后必须重置导航水位。
      lastRoomId = nextRoomId;
      lastSeq = 0;
      resolvePendingAsSuperseded();
    }
    if (nextSeq < lastSeq) return { ok: false, skipped: true, reason: 'STALE_SEQ' };
    const descriptor = describeRoute(route, context && context.roomId);
    if (!descriptor) return { ok: false, skipped: true, reason: 'UNKNOWN_ROUTE' };
    const current = currentPath();
    if (current === descriptor.path.slice(1)) { lastSeq = nextSeq; return { ok: true, skipped: true, reason: 'SAME_ROUTE' }; }
    // 灵感、裁剪、填情境等本地叠层：仍属于当前 route 时不拆；route 变化后跟随。
    if (current && isLocalOverlay(current, route.name)) {
      return { ok: false, skipped: true, reason: 'LOCAL_OVERLAY' };
    }
    if (context && typeof context.beforeNavigate === 'function'
      && context.beforeNavigate(context.pageSnapshot, descriptor.pageKey) === true) {
      lastSeq = nextSeq;
      return { ok: true, skipped: true, reason: 'HANDLED' };
    }
    if (active) {
      // 订阅与用户动作可能同时请求同一条权威 route。后发调用必须等待在途导航，
      // 否则页面交互锁会提前释放，甚至再次提交同一个操作。
      return new Promise((resolve, reject) => {
        const waiters = pending ? pending.waiters : [];
        waiters.push({ resolve, reject });
        pending = { route, seq: nextSeq, context, waiters };
      });
    }
    active = true;
    try {
      if (typeof open === 'function') await open(descriptor);
      else if (typeof wx !== 'undefined' && typeof wx[descriptor.mode] === 'function') {
        const opened = await new Promise((resolve) => {
          wx[descriptor.mode]({
            url: descriptor.url,
            success: () => resolve({ ok: true }),
            fail: (error) => resolve({ ok: false, error })
          });
        });
        if (!opened.ok) {
          return { ok: false, reason: 'NAV_FAILED', error: opened.error };
        }
      } else {
        return { ok: false, reason: 'NAV_UNAVAILABLE' };
      }
      lastSeq = nextSeq;
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: 'NAV_FAILED', error };
    } finally {
      active = false;
      if (pending) {
        const next = pending; pending = null;
        reconcile(next.route, next.seq, next.context)
          .then((result) => next.waiters.forEach(({ resolve }) => resolve(result)))
          .catch((error) => next.waiters.forEach(({ reject }) => reject(error)));
      }
    }
  }

  return { reconcile, getLastSeq: () => lastSeq, getLastRoomId: () => lastRoomId };
}

module.exports = { ROUTES, describeRoute, createNavigationCoordinator };
