/** 微信胶囊对齐的顶部栏尺寸（禁止写死 top） */

function getWindowInfoSafe() {
  try {
    return typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
  } catch (e) {
    return null;
  }
}

function getWindowWidth() {
  const sys = getWindowInfoSafe();
  return (sys && sys.windowWidth) || 375;
}

function resolveStatusBarHeight(sys, fallback) {
  if (!sys) return fallback;
  if (sys.statusBarHeight > 0) return sys.statusBarHeight;
  const insetTop = sys.safeAreaInsets && sys.safeAreaInsets.top;
  if (insetTop > 0) return insetTop;
  if (sys.safeArea && sys.safeArea.top > 0) return sys.safeArea.top;
  return fallback;
}

/**
 * @returns {{
 *   padTop: number,
 *   barHeight: number,
 *   iconSize: number,
 *   capsuleWidth: number,
 *   padRightPx: number,
 *   padRightRpx: number,
 *   statusBarHeight: number
 * }}
 */
function getCapsuleTopBarMetrics(options = {}) {
  const minBarPx = options.minBarPx != null ? options.minBarPx : 32;
  const statusBarFallback = 20;
  const sys = getWindowInfoSafe();
  const statusBarHeight = resolveStatusBarHeight(sys, statusBarFallback);

  let capsuleTop = statusBarHeight;
  let capsuleHeight = minBarPx;
  let capsuleWidth = 87;
  let capsuleRight = getWindowWidth();

  try {
    const menu = wx.getMenuButtonBoundingClientRect();
    // 仅采纳有效胶囊尺寸；menu.top===0 时回退 statusBar，避免 iOS padTop 塌成 0
    if (menu && menu.height > 0) {
      capsuleHeight = Math.round(menu.height);
      if (menu.width > 0) capsuleWidth = Math.round(menu.width);
      if (menu.top > 0) {
        capsuleTop = Math.round(menu.top);
      }
      if (menu.right > 0) capsuleRight = menu.right;
    }
  } catch (e) {
    // ignore
  }

  const windowWidth = getWindowWidth();
  // 头像组合略大于胶囊时，以较大者作为行高，仍保证与胶囊垂直中心对齐
  const avatarNeedPx = Math.ceil((80 * windowWidth) / 750);
  const barHeight = Math.max(capsuleHeight, avatarNeedPx, minBarPx);
  const capsuleCenter = capsuleTop + capsuleHeight / 2;
  const padTop = Math.max(0, Math.round(capsuleCenter - barHeight / 2));
  const padRightPx = Math.max(0, Math.round(windowWidth - capsuleRight));
  const padRightRpx = Math.ceil((padRightPx * 750) / windowWidth);

  return {
    padTop,
    barHeight,
    iconSize: Math.min(barHeight, capsuleHeight),
    capsuleWidth,
    padRightPx,
    padRightRpx,
    statusBarHeight
  };
}

module.exports = {
  getCapsuleTopBarMetrics,
  getWindowWidth
};
