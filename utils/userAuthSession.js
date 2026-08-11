/**
 * 用户授权流程闸门：授权进行中时挂起房间跳转/提示，结束后再执行。
 * 与房间状态解耦，不会因解散房间而取消登录态。
 *
 * 使用引用计数：允许多次 begin 嵌套；仅全部 end 后才释放队列。
 */

let _authDepth = 0;
let _pendingAfterAuth = [];

function isUserAuthInProgress() {
  return _authDepth > 0;
}

function beginUserAuthFlow() {
  _authDepth += 1;
}

function endUserAuthFlow() {
  if (_authDepth > 0) _authDepth -= 1;
  if (_authDepth > 0) return;
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

/** 强制结束（取消选图面板无回调时的兜底） */
function forceEndUserAuthFlow() {
  _authDepth = 0;
  endUserAuthFlow();
}

/**
 * 若当前有授权流程，则排队到结束后再执行；否则立即执行。
 * @returns {boolean} true 表示已立即执行；false 表示已排队
 */
function runAfterUserAuth(fn) {
  if (typeof fn !== 'function') return true;
  if (_authDepth <= 0) {
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
  forceEndUserAuthFlow,
  runAfterUserAuth
};
