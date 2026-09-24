const DEFAULT_LOADING_DELAY_MS = 500;
// 微信导航在极少数运行时窗口中可能不触发任何回调；必须释放导航锁，让下一次 View 同步能够重试。
const DEFAULT_NAVIGATION_TIMEOUT_MS = 6000;
const INTERACTION_LOCK_DATA = Object.freeze({
  interactionLocked: false,
  interactionLoading: false,
  interactionLoadingText: '加载中…'
});

function safeSetData(page, patch) {
  if (!page || typeof page.setData !== 'function') return;
  try {
    page.setData(patch);
  } catch (e) {
    // 页面可能已在请求完成前卸载，此时无需再刷新锁层。
  }
}

function isPageInteractionLocked(page) {
  return !!(
    page
    && (
      page.__pageInteractionPromise
      || (page.data && page.data.interactionLocked)
    )
  );
}

/**
 * 为页面注入锁定状态，并统一守卫 WXML 交互处理器。
 * 页面只需声明会被用户直接触发的方法名；锁定期间这些方法全部忽略。
 */
function withPageInteractionLock(pageDefinition, interactionMethods = [], options = {}) {
  if (!pageDefinition || typeof pageDefinition !== 'object') {
    throw new TypeError('pageDefinition 必须为对象');
  }

  pageDefinition.data = {
    ...INTERACTION_LOCK_DATA,
    ...(pageDefinition.data || {})
  };

  const passthroughMethods = new Set(options.passthroughMethods || []);
  [...new Set(interactionMethods)].forEach((methodName) => {
    const original = pageDefinition[methodName];
    if (typeof original !== 'function') {
      throw new TypeError(`交互处理器 ${methodName} 不存在`);
    }
    pageDefinition[methodName] = function guardedPageInteraction(...args) {
      if (!passthroughMethods.has(methodName) && isPageInteractionLocked(this)) {
        return undefined;
      }
      return original.apply(this, args);
    };
  });

  return pageDefinition;
}

/**
 * 将微信小程序的回调式导航 API 转成 Promise。
 * 正常等待导航 API 明确成功或失败；运行时丢失全部回调时按超时失败释放，供权威路由重试。
 */
function waitForPageNavigation(method, options = {}) {
  return new Promise((resolve) => {
    const navigation = typeof wx !== 'undefined' && wx && wx[method];
    if (typeof navigation !== 'function') {
      resolve({
        ok: false,
        error: new TypeError(`wx.${method} 不可用`)
      });
      return;
    }

    const originalSuccess = options.success;
    const originalFail = options.fail;
    const originalComplete = options.complete;
    const requestedTimeoutMs = Number(options.navigationTimeoutMs);
    const navigationTimeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
      ? requestedTimeoutMs
      : DEFAULT_NAVIGATION_TIMEOUT_MS;
    const navigationOptions = { ...options };
    delete navigationOptions.navigationTimeoutMs;
    let settled = false;
    let timeoutTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve(result);
    };

    timeoutTimer = setTimeout(() => {
      const error = new Error(`wx.${method} 导航超时`);
      error.code = 'NAVIGATION_TIMEOUT';
      finish({ ok: false, error });
    }, navigationTimeoutMs);

    try {
      navigation.call(wx, {
        ...navigationOptions,
        success(result) {
          try {
            if (typeof originalSuccess === 'function') originalSuccess(result);
          } finally {
            finish({ ok: true, result });
          }
        },
        fail(error) {
          try {
            if (typeof originalFail === 'function') originalFail(error);
          } finally {
            finish({ ok: false, error });
          }
        },
        complete(result) {
          try {
            if (typeof originalComplete === 'function') originalComplete(result);
          } finally {
            // 未收到 success/fail 时（部分测试桩或旧运行时）仍要结束 Promise，避免页面锁死。
            finish({ ok: true, result: result || { completed: true } });
          }
        }
      });
    } catch (error) {
      finish({ ok: false, error });
    }
  });
}

/**
 * 执行一次“异步准备 + 页面导航”的排他交互。
 * prepareNavigation 成功时返回 { method, ...navigationOptions }，
 * 无需导航（例如服务器返回失败）时返回空值。
 * 导航的回调等待由本模块统一处理，页面锁不会在路由过渡期间提前释放。
 */
function runPageNavigation(page, prepareNavigation, options = {}) {
  return runPageInteraction(page, async () => {
    const target = await prepareNavigation();
    if (!target) return target;
    if (typeof target !== 'object') {
      throw new TypeError('prepareNavigation 必须返回导航配置或空值');
    }
    const { method = 'navigateTo', ...navigationOptions } = target;
    return waitForPageNavigation(method, navigationOptions);
  }, options);
}

/**
 * 执行一次页面级排他交互。
 *
 * - 调用后立即挂透明遮罩，拦截页面上的其他交互；
 * - 超过 loadingDelayMs 后才展示 loading；
 * - 同一页面已有任务时复用在途 Promise，不重复执行新任务；
 * - 无论成功或失败，最终都会释放锁。
 */
function runPageInteraction(page, task, options = {}) {
  if (!page || typeof task !== 'function') {
    return Promise.reject(new TypeError('page 和 task 必填'));
  }

  if (page.__pageInteractionPromise) {
    return page.__pageInteractionPromise;
  }

  const loadingDelayMs = options.loadingDelayMs != null
    ? Math.max(0, Number(options.loadingDelayMs) || 0)
    : DEFAULT_LOADING_DELAY_MS;
  const loadingText = options.loadingText || '加载中…';
  const token = {};
  page.__pageInteractionToken = token;

  safeSetData(page, {
    interactionLocked: true,
    interactionLoading: false,
    interactionLoadingText: loadingText
  });

  const loadingTimer = setTimeout(() => {
    if (page.__pageInteractionToken !== token) return;
    safeSetData(page, { interactionLoading: true });
  }, loadingDelayMs);

  const taskPromise = Promise.resolve().then(() => task());
  const guardedPromise = taskPromise.finally(() => {
    clearTimeout(loadingTimer);
    if (page.__pageInteractionToken !== token) return;
    page.__pageInteractionToken = null;
    page.__pageInteractionPromise = null;
    safeSetData(page, {
      interactionLocked: false,
      interactionLoading: false
    });
  });

  page.__pageInteractionPromise = guardedPromise;
  return guardedPromise;
}

module.exports = {
  DEFAULT_LOADING_DELAY_MS,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  INTERACTION_LOCK_DATA,
  isPageInteractionLocked,
  waitForPageNavigation,
  runPageNavigation,
  runPageInteraction,
  withPageInteractionLock
};
