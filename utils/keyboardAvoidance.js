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

/**
 * 贴底输入栏使用原生事件给出的 px 高度，只移动一份 UI；调用方需关闭 adjust-position，
 * 避免系统上推与手动位移叠加。
 */
function buildKeyboardLiftStyle(height) {
  const px = normalizeKeyboardHeight(height);
  return px > 0 ? `transform: translate3d(0, -${px}px, 0);` : '';
}

function buildKeyboardMaskBottomStyle(height, baseInset = '180rpx + env(safe-area-inset-bottom)') {
  const px = normalizeKeyboardHeight(height);
  return `bottom: calc(${px}px + ${baseInset});`;
}

module.exports = {
  buildKeyboardLiftStyle,
  buildKeyboardMaskBottomStyle,
  keyboardHeightFromEvent,
  normalizeKeyboardHeight
};
