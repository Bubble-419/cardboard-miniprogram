/** 微信胶囊对齐的顶部栏尺寸（禁止写死 top） */

function getWindowWidth() {
  try {
    const sys = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    return (sys && sys.windowWidth) || 375;
  } catch (e) {
    return 375;
  }
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
  let statusBarHeight = statusBarFallback;
  try {
    const sys = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    statusBarHeight = (sys && sys.statusBarHeight) || statusBarFallback;
  } catch (e) {
    // ignore
  }

  let capsuleTop = statusBarHeight;
  let capsuleHeight = minBarPx;
  let capsuleWidth = 87;
  let capsuleRight = getWindowWidth();

  try {
    const menu = wx.getMenuButtonBoundingClientRect();
    if (menu && menu.height) {
      capsuleHeight = Math.round(menu.height);
      capsuleWidth = Math.round(menu.width || 87);
      capsuleTop = Math.round(menu.top != null ? menu.top : statusBarHeight);
      if (menu.right != null) capsuleRight = menu.right;
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
