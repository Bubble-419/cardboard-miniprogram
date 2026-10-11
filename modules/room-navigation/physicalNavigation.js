'use strict';

const HOME_URL = '/pages/main-pages/aaa/index';
const NAVIGATION_TIMEOUT_MS = 6000;

function currentPages() {
  return typeof getCurrentPages === 'function' ? getCurrentPages() : [];
}

/** 房间仅保留一个真实页面；业务后退和局部屏幕不依赖系统页面栈。 */
function planPhysicalNavigation(method, options = {}) {
  const pages = currentPages();
  let planned = ['navigateTo', 'navigateBack'].includes(method) ? 'redirectTo' : method;
  if (planned === 'redirectTo' && pages.length > 1) planned = 'reLaunch';
  let url = method === 'navigateBack' ? (options.fallbackUrl || HOME_URL) : options.url;
  // 全局回顾是独立只读页面，明确记录 UI 返回目标，而不是保留活跃页在栈下。
  if (method === 'navigateTo' && /[?&]mode=review(?:&|$)/.test(url || '') && !/[?&]returnTo=/.test(url)) {
    const page = pages[pages.length - 1];
    if (page) {
      const params = page._physicalEntryOptions || page.options || {};
      const query = Object.entries(params).filter(([key, value]) => key !== 'returnTo' && value != null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
      const returnTo = `/${page.route}${query ? `?${query}` : ''}`;
      url += `&returnTo=${encodeURIComponent(returnTo)}`;
    }
  }
  return { method: planned, options: { ...options, ...(url ? { url } : {}) } };
}

function returnToHome() {
  const { waitForPageNavigation } = require('../../utils/pageInteractionLock');
  return waitForPageNavigation('reLaunch', { url: HOME_URL });
}

module.exports = { HOME_URL, NAVIGATION_TIMEOUT_MS, currentPages, planPhysicalNavigation, returnToHome };
