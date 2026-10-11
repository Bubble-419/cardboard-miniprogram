'use strict';

function normalizeKeyboardHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height) || height <= 0) return 0;
  return Math.round(height);
}

function keyboardHeightFromEvent(event) {
  const detailHeight = event && event.detail && event.detail.height;
  return normalizeKeyboardHeight(detailHeight != null ? detailHeight : event && event.height);
}

function readWindowHeight() {
  try {
    if (typeof wx === 'undefined') return 0;
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null);
    const height = info && info.windowHeight;
    return Number.isFinite(Number(height)) && Number(height) > 0
      ? Math.round(Number(height))
      : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * 若软键盘已把页面窗口压矮，fixed bottom 只需补剩余差值。
 * baseWindowHeight 必须在键盘未打开时采样，避免把状态栏差值误当成压缩量。
 */
function effectiveKeyboardBottom(height, baseWindowHeight, currentWindowHeight) {
  const px = normalizeKeyboardHeight(height);
  if (px <= 0) return 0;
  const base = Number(baseWindowHeight);
  const current = Number(currentWindowHeight);
  if (!Number.isFinite(base) || !Number.isFinite(current) || base <= 0 || current <= 0) {
    return px;
  }
  if (current >= base) return px;
  const resized = Math.round(base - current);
  // 窗口已被压缩到接近键盘高度：系统已避让，再设 bottom 会叠出空隙。
  if (resized >= Math.floor(px * 0.8)) return 0;
  if (resized >= 40) return Math.max(0, px - resized);
  return px;
}

/**
 * 贴底输入栏使用原生事件给出的 px 高度，只移动一份 UI；调用方需关闭 adjust-position，
 * 避免系统上推与手动位移叠加。
 */
function buildKeyboardLiftStyle(height) {
  const px = normalizeKeyboardHeight(height);
  return px > 0 ? `transform: translate3d(0, -${px}px, 0);` : '';
}

/**
 * iOS 原生 input/textarea 位于 transform 容器中时可能不跟随、
 * 重复合成或产生残影。
 * 对 position: relative/fixed 的单层输入栏改用 bottom 位移，仍只消费原生 px 高度。
 */
function buildKeyboardBottomStyle(height) {
  const px = normalizeKeyboardHeight(height);
  return px > 0 ? `bottom: ${px}px;` : '';
}

/**
 * 固定顶部的全屏 Flex 页面在键盘打开时缩短可用高度，
 * 由中间可伸缩区承担压缩，底部输入区保持在键盘上沿。
 */
function buildKeyboardViewportStyle(height) {
  const px = normalizeKeyboardHeight(height);
  return px > 0 ? `height: calc(100vh - ${px}px);` : '';
}

function buildKeyboardMaskBottomStyle(height, baseInset = '180rpx + env(safe-area-inset-bottom)') {
  const px = normalizeKeyboardHeight(height);
  return `bottom: calc(${px}px + ${baseInset});`;
}

module.exports = {
  buildKeyboardBottomStyle,
  buildKeyboardLiftStyle,
  buildKeyboardMaskBottomStyle,
  buildKeyboardViewportStyle,
  effectiveKeyboardBottom,
  keyboardHeightFromEvent,
  normalizeKeyboardHeight,
  readWindowHeight
};
