/**
 * 小程序页面跳转：统一防抖、排队与「未注册」重试，避免多页面轮询并发导航报错
 */

const REGISTERED_ROUTES = new Set([
  'pages/main-pages/aaa/index',
  'pages/auth/index',
  'pages/main-pages/addPlayer/index',
  'pages/sub-pages/subAwait/index',
  'pages/main-pages/submitProblem/index',
  'pages/main-pages/selectProblem/index',
  'pages/main-pages/selectMode/index',
  'pages/main-pages/selectPlayer/index',
  'pages/main-pages/partnerMode/confirmBG/index',
  'pages/main-pages/partnerMode/confirmFirstPlayer/index',
  'pages/main-pages/partnerMode/gamepage/index',
  'pages/main-pages/partnerMode/specialMove/index',
  'pages/main-pages/partnerMode/statement/index',
  'pages/main-pages/partnerMode/closingStatement/index',
  'pages/main-pages/partnerMode/closingEnd/index',
  'pages/main-pages/playSuccess/index',
  'pages/main-pages/playFail/index',
  'pages/main-pages/selectBG/index',
  'pages/main-pages/modeIndex/index',
  'pages/main-pages/brainstormMode/index',
  'packageSpy/pages/modeIndex/index',
  'packageSpy/pages/cardLibrary/index',
  'packageSpy/pages/assign/index',
  'packageSpy/pages/speak/index',
  'packageSpy/pages/vote/index',
  'packageSpy/pages/result/index',
  'packageSpy/pages/nextRound/index',
  'packageSpy/pages/settle/index',
  'pages/main-pages/halliGalli/gamepage/index',
  'pages/main-pages/creativeInput/index',
  'pages/main-pages/creativeSummary/index',
  'pages/main-pages/discussion/index',
  'pages/inspiration/index',
  'pages/leaderboard/index'
]);

function getCurrentRoute() {
  const pages = getCurrentPages();
  if (!pages.length) return '';
  return pages[pages.length - 1].route || '';
}

/** 回看案例 / 只读情境等叠层页：跟随跳转不得拆掉当前页 */
const FLOW_OVERLAY_ROUTES = new Set([
  'pages/main-pages/case/index',
  'pages/inspiration/index'
]);

function isFlowOverlayRoute() {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (!current) return false;
  const route = current.route || '';
  if (FLOW_OVERLAY_ROUTES.has(route)) return true;
  if (route === 'pages/main-pages/partnerMode/confirmBG/index') {
    return !!(current._fromGameView || (current.data && current.data.fromGameView));
  }
  return false;
}

function normalizeRoute(url) {
  return (url || '').replace(/^\//, '').split('?')[0];
}

function isNotRegisteredError(err) {
  const msg = (err && err.errMsg) || '';
  return /not been registered|not registered/i.test(msg);
}

function isRouteRegistered(route) {
  return REGISTERED_ROUTES.has(route);
}

const _nav = {
  inFlight: false,
  pendingUrl: '',
  timer: null,
  lastTarget: '',
  lastAt: 0
};

const MIN_INTERVAL_MS = 500;
const MAX_RETRY = 10;

function _clearTimer() {
  if (_nav.timer) {
    clearTimeout(_nav.timer);
    _nav.timer = null;
  }
}

function _releaseNav() {
  _nav.inFlight = false;
  const pending = _nav.pendingUrl;
  _nav.pendingUrl = '';
  if (pending) {
    const route = normalizeRoute(pending);
    if (route !== getCurrentRoute() && !isFlowOverlayRoute()) {
      _nav.timer = setTimeout(() => openUrl(pending, { _fromQueue: true }), 80);
    }
  }
}

/**
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.preferNavigate] 子页面栈内优先 navigateTo
 * @param {boolean} [options.immediate] 跳过首跳延迟
 * @param {number} [options.retryCount] 内部重试计数
 * @param {boolean} [options._fromQueue] 内部排队调用
 */
function openUrl(url, options = {}) {
  if (!url || typeof url !== 'string') return false;

  const targetRoute = normalizeRoute(url);
  const currentRoute = getCurrentRoute();

  if (targetRoute === currentRoute) {
    return false;
  }

  // 正在回看案例/情境：禁止跟随把用户拉回 submit/select 等主流程
  if (!options.allowOverlayLeave && isFlowOverlayRoute()) {
    return false;
  }

  if (!isRouteRegistered(targetRoute)) {
    console.warn('[pageNavigate] 路由未在 app.json 注册', targetRoute);
    return false;
  }

  const retryCount = options.retryCount || 0;
  const now = Date.now();

  if (!options._fromQueue && retryCount === 0) {
    if (_nav.lastTarget === targetRoute && now - _nav.lastAt < MIN_INTERVAL_MS) {
      return false;
    }
    if (_nav.inFlight) {
      _nav.pendingUrl = url;
      return false;
    }
  }

  _clearTimer();
  const delay = retryCount === 0
    ? (options.immediate ? 0 : 120)
    : (250 + retryCount * 180);

  _nav.timer = setTimeout(() => {
    _nav.timer = null;
    _runNav(url, targetRoute, options, retryCount);
  }, delay);

  return true;
}

function _runNav(url, targetRoute, options, retryCount) {
  if (targetRoute === getCurrentRoute()) {
    _releaseNav();
    return;
  }

  _nav.inFlight = true;
  _nav.lastTarget = targetRoute;
  _nav.lastAt = Date.now();

  const onSuccess = () => _releaseNav();

  const onFail = (err, stage) => {
    if (isNotRegisteredError(err) && retryCount < MAX_RETRY) {
      _nav.inFlight = false;
      openUrl(url, { ...options, retryCount: retryCount + 1, _fromQueue: true });
      return;
    }
    if (stage === 'navigateTo') {
      wx.redirectTo({ url, success: onSuccess, fail: (e2) => onFail(e2, 'redirectTo') });
      return;
    }
    if (stage === 'redirectTo') {
      // spy 等流程禁用 reLaunch，避免整栈重建白屏；改为短暂重试 redirectTo
      if (options.noReLaunch) {
        if (retryCount < 4) {
          _nav.inFlight = false;
          openUrl(url, {
            ...options,
            retryCount: retryCount + 1,
            _fromQueue: true,
            immediate: true
          });
          return;
        }
        console.warn('[pageNavigate] redirectTo 重试耗尽', err, url);
        _releaseNav();
        return;
      }
      wx.reLaunch({
        url,
        success: onSuccess,
        fail: (e3) => {
          console.warn('[pageNavigate] 跳转失败', e3, url);
          _releaseNav();
        }
      });
      return;
    }
    console.warn('[pageNavigate] 跳转失败', err, url);
    _releaseNav();
  };

  if (options.preferNavigate && retryCount === 0) {
    wx.navigateTo({ url, success: onSuccess, fail: (e) => onFail(e, 'navigateTo') });
    return;
  }

  wx.redirectTo({ url, success: onSuccess, fail: (e) => onFail(e, 'redirectTo') });
}

/** @deprecated 使用 openUrl；兼容旧调用，第二参数可为 retryCount 或 options */
function safeOpenUrl(url, retryCountOrOptions) {
  if (typeof retryCountOrOptions === 'number' && retryCountOrOptions > 0) {
    return openUrl(url, { retryCount: retryCountOrOptions });
  }
  if (retryCountOrOptions && typeof retryCountOrOptions === 'object') {
    return openUrl(url, retryCountOrOptions);
  }
  return openUrl(url);
}

function openPartnerPage(url) {
  return openUrl(url, { preferNavigate: true });
}

/** 清空排队/在途导航（主动回大厅前调用，避免竞态把人拉回游戏） */
function clearPendingNavigation() {
  _clearTimer();
  _nav.inFlight = false;
  _nav.pendingUrl = '';
  _nav.lastTarget = '';
  _nav.lastAt = 0;
}

function getPrevRoute() {
  const pages = getCurrentPages();
  if (!pages || pages.length < 2) return '';
  return pages[pages.length - 2].route || '';
}

function _openFallback(url) {
  if (!url || typeof url !== 'string') return;
  const route = normalizeRoute(url);
  if (route === getCurrentRoute()) return;
  wx.redirectTo({
    url,
    fail: () => {
      wx.reLaunch({
        url,
        fail: (err) => console.warn('[pageNavigate] fallback 失败', err, url)
      });
    }
  });
}

/**
 * 语义化返回：栈上一页不符合期望时走 fallback，避免房主 redirectTo 卸页后 navigateBack「退两级」。
 * @param {object} [options]
 * @param {string|string[]} [options.expectedPrev] 期望的上一页 route（可带/不带前导 /）
 * @param {string} [options.fallbackUrl] 期望不符或 navigateBack 失败时的去向
 * @param {number} [options.delta]
 */
function safeNavigateBack(options = {}) {
  const delta = options.delta > 0 ? options.delta : 1;
  const fallbackUrl = options.fallbackUrl || '';
  const expected = options.expectedPrev;
  const expectedList = !expected
    ? []
    : (Array.isArray(expected) ? expected : [expected]).map(normalizeRoute).filter(Boolean);

  const pages = getCurrentPages();
  if (!pages || pages.length <= delta) {
    _openFallback(fallbackUrl);
    return false;
  }

  if (expectedList.length) {
    const prevRoute = getPrevRoute();
    if (!expectedList.includes(prevRoute)) {
      _openFallback(fallbackUrl);
      return false;
    }
  }

  wx.navigateBack({
    delta,
    fail: () => _openFallback(fallbackUrl)
  });
  return true;
}

module.exports = {
  getCurrentRoute,
  getPrevRoute,
  normalizeRoute,
  isRouteRegistered,
  isFlowOverlayRoute,
  openUrl,
  safeOpenUrl,
  openPartnerPage,
  clearPendingNavigation,
  safeNavigateBack
};
