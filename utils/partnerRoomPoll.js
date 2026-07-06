/**
 * 合伙人模式房间轮询辅助：页面隐藏时自动停止，避免多页面并发跳转
 */

function bindPartnerPageVisibility(pageInstance, callbacks) {
  const { onShow: userShow, onHide: userHide, onUnload: userUnload } = callbacks || {};
  let visible = false;

  const origShow = pageInstance.onShow;
  const origHide = pageInstance.onHide;
  const origUnload = pageInstance.onUnload;

  pageInstance.onShow = function (options) {
    visible = true;
    if (typeof origShow === 'function') origShow.call(this, options);
    if (typeof userShow === 'function') userShow.call(this);
  };

  pageInstance.onHide = function () {
    visible = false;
    if (typeof userHide === 'function') userHide.call(this);
    if (typeof origHide === 'function') origHide.call(this);
  };

  pageInstance.onUnload = function () {
    visible = false;
    if (typeof userUnload === 'function') userUnload.call(this);
    if (typeof origUnload === 'function') origUnload.call(this);
  };

  return {
    isVisible: () => visible
  };
}

module.exports = {
  bindPartnerPageVisibility
};
