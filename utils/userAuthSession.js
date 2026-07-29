/**
 * 用户授权流程闸门：授权进行中时挂起房间跳转/提示，结束后再执行。
 * 与房间状态解耦，不会因解散房间而取消登录态。
 */

let _authInProgress = false;
let _pendingAfterAuth = [];

function isUserAuthInProgress() {
  return _authInProgress === true;
}

function beginUserAuthFlow() {
  _authInProgress = true;
}

function endUserAuthFlow() {
  _authInProgress = false;
  const queue = _pendingAfterAuth.slice();
  _pendingAfterAuth = [];
  queue.forEach((fn) => {
    try {
      if (typeof fn === 'function') fn();
    } catch (e) {
      console.warn('runAfterUserAuth failed', e);
    }
  });
}

/**
 * 若当前有授权流程，则排队到结束后再执行；否则立即执行。
 * @returns {boolean} true 表示已立即执行；false 表示已排队
 */
function runAfterUserAuth(fn) {
  if (typeof fn !== 'function') return true;
  if (!_authInProgress) {
    fn();
    return true;
  }
  _pendingAfterAuth.push(fn);
  return false;
}

module.exports = {
  isUserAuthInProgress,
  beginUserAuthFlow,
  endUserAuthFlow,
  runAfterUserAuth
};
