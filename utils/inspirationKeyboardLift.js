'use strict';

function readWindowMetrics() {
  try {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    return {
      windowHeight: Number(info && info.windowHeight) || 0,
      screenHeight: Number(info && info.screenHeight) || 0
    };
  } catch (e) {
    return { windowHeight: 0, screenHeight: 0 };
  }
}

/**
 * 灵感栏键盘抬起：原生 input 不会跟随祖先 transform，必须用 position:fixed。
 * Android 还可能同时缩小 webview 并上报键盘高度，需要扣掉缩小量，避免输入栏被顶出屏幕。
 */
function createInspirationKeyboardLift() {
  let baseWindowHeight = 0;

  function captureBase() {
    const metrics = readWindowMetrics();
    if (metrics.windowHeight > 0) baseWindowHeight = metrics.windowHeight;
    return metrics;
  }

  function resolveLiftPx(keyboardHeight) {
    const kh = Math.max(0, Number(keyboardHeight) || 0);
    if (kh <= 0) return 0;
    const metrics = readWindowMetrics();
    if (!baseWindowHeight && metrics.windowHeight) baseWindowHeight = metrics.windowHeight;
    const shrink = baseWindowHeight > 0
      ? Math.max(0, baseWindowHeight - (metrics.windowHeight || 0))
      : 0;
    return Math.max(0, kh - shrink);
  }

  function buildBarStyle(keyboardHeight, options) {
    const lift = resolveLiftPx(keyboardHeight);
    if (lift <= 0) return '';
    const extra = options || {};
    return [
      'position:fixed',
      'left:0',
      'right:0',
      `bottom:${lift}px`,
      'margin:0',
      extra.padding != null ? `padding:${extra.padding}` : 'padding:18rpx 30rpx',
      'z-index:80',
      'box-sizing:border-box',
      extra.background ? `background:${extra.background}` : '',
      ...(Array.isArray(extra.decls) ? extra.decls : [])
    ].filter(Boolean).join(';');
  }

  function buildMaskStyle(keyboardHeight, barReserveRpx) {
    const lift = resolveLiftPx(keyboardHeight);
    const reserve = Number(barReserveRpx) || 136;
    if (lift <= 0) {
      return `bottom: calc(${Math.max(reserve, 180)}rpx + env(safe-area-inset-bottom))`;
    }
    return `bottom: calc(${lift}px + ${reserve}rpx)`;
  }

  return { captureBase, resolveLiftPx, buildBarStyle, buildMaskStyle };
}

module.exports = { readWindowMetrics, createInspirationKeyboardLift };
