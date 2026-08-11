/**
 * 房间解散 / 不在房间：只清理房间级数据并回首页（幂等）
 *
 * 与「用户登录态」严格分离：
 * - 只清房间 ID、进度、重连、局内选择等
 * - 绝不 clearStorage / 登出 / 清除 wxUserProfile 等授权与登录凭证
 * - 授权流程进行中时延后跳转与提示，结束后再执行
 *
 * 房间解散信号来源：轮询 getAddPlayerData 的 ROOM_DISSOLVED（等同 room_dissolved）
 */
const { clearLocalBrainstormProgress } = require('./roomBrainstormProgress');
const { clearPartnerSpecialMoveUsedFlag } = require('./partnerSpecialMove');
const { getCurrentRoute } = require('./pageNavigate');
const {
  isUserAuthInProgress,
  runAfterUserAuth
} = require('./userAuthSession');
const { PROFILE_STORAGE_KEY } = require('./wxUserAvatar');
const { upsertHistoryWorkshop } = require('./historyWorkshops');

const HOME_URL = '/pages/main-pages/aaa/index';
const HOME_ROUTE = 'pages/main-pages/aaa/index';
const JOINED_ROOM_KEY = 'joinedRoomId';
const PENDING_TOAST_KEY = 'pendingRoomGoneToast';

/** 受保护：清理房间时禁止删除的本地键（登录/授权） */
const PROTECTED_STORAGE_KEYS = [
  PROFILE_STORAGE_KEY
];

/** 允许清理的房间级 storage 键（精确删除，不用 clearStorage） */
const ROOM_STORAGE_KEYS = [
  JOINED_ROOM_KEY,
  PENDING_TOAST_KEY
];

/** globalData 中仅房间相关字段 */
const ROOM_GLOBAL_KEYS = [
  'roomId',
  'selectedProblem',
  'selectedMode',
  'selectedPlayer',
  'selectedBG',
  'gameMode',
  'spyStayOnLobbyRoomId'
];

let _exiting = false;
let _lastExitAt = 0;
let _deferredExit = null;

function isRoomDissolvedResult(result) {
  if (!result) return false;
  if (result.roomDissolved === true) return true;
  if (result.event === 'room_dissolved') return true;
  const code = result.errCode || '';
  return code === 'ROOM_DISSOLVED' || code === 'ROOM_NOT_FOUND';
}

function isRemovedFromRoomResult(result) {
  if (!result) return false;
  return result.errCode === 'NOT_IN_ROOM';
}

function resolveToastTitle(result, options = {}) {
  if (options.title) return options.title;
  if (isRoomDissolvedResult(result) || options.forceDissolved === true) {
    return '房间已解散';
  }
  return '您已不在该房间';
}

function removeStorageKeySafe(key) {
  if (PROTECTED_STORAGE_KEYS.indexOf(key) !== -1) {
    console.warn('[roomDissolved] refused to clear protected key', key);
    return;
  }
  try {
    wx.removeStorageSync(key);
  } catch (e) {
    console.warn('removeStorage failed', key, e);
  }
}

/**
 * 仅清除房间级本地数据。禁止 clearStorage / 登出 / 动用户画像。
 */
function clearRoomLocalState(roomId) {
  const id = roomId
    || (getApp().globalData && getApp().globalData.roomId)
    || '';

  // 房间结束/退出：刷新一次首页历史工作坊记录的时间，方便回看
  if (id) {
    try {
      const app = getApp();
      const workshopName = (app && app.globalData && app.globalData.workshopName) || '';
      upsertHistoryWorkshop({ roomId: id, name: workshopName });
    } catch (e) {
      // ignore
    }
  }

  ROOM_STORAGE_KEYS.forEach((key) => {
    if (key === PENDING_TOAST_KEY) return; // toast 标记由消费逻辑处理
    removeStorageKeySafe(key);
  });

  try {
    const app = getApp();
    if (app && app.globalData) {
      ROOM_GLOBAL_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(app.globalData, key)) {
          app.globalData[key] = null;
        }
      });
      // 显式保留：userRole / cloud / cloudReady / workshopName 等非房间字段
    }
  } catch (e) {
    // ignore
  }

  // 停止 App 级轮询，避免解散后继续打 getAddPlayerData
  try {
    const { disposeRoomSession } = require('../modules/room-session/index');
    disposeRoomSession();
  } catch (e) {
    // ignore
  }

  if (id) {
    clearLocalBrainstormProgress(id);
    clearPartnerSpecialMoveUsedFlag(id);
  }

  try {
    const { clearSpyLobbyStay, clearSpyFollowLock } = require('./spyFollow');
    clearSpyLobbyStay();
    clearSpyFollowLock();
  } catch (e) {
    // ignore
  }

  try {
    const { clearPendingNavigation } = require('./pageNavigate');
    clearPendingNavigation();
  } catch (e) {
    // ignore
  }
}

function _scheduleHomeReLaunch(title) {
  try {
    wx.setStorageSync(PENDING_TOAST_KEY, title);
  } catch (e) {
    // ignore
  }

  wx.showToast({
    title,
    icon: 'none',
    duration: 2000
  });

  setTimeout(() => {
    wx.reLaunch({
      url: HOME_URL,
      complete: () => {
        _exiting = false;
      }
    });
  }, 200);
}

function _runExitRoomGone(result, options = {}) {
  const now = Date.now();
  if (_exiting || now - _lastExitAt < 2500) {
    return true;
  }

  const onHome = getCurrentRoute() === HOME_ROUTE;
  const roomId = options.roomId
    || (result && result.roomId)
    || (getApp().globalData && getApp().globalData.roomId)
    || '';

  // 已在首页：只清房间数据 + 可选 toast，不 reLaunch、不碰登录态
  if (onHome) {
    _lastExitAt = now;
    clearRoomLocalState(roomId);
    if (options.allowToastOnHome === true) {
      const title = resolveToastTitle(result, options);
      try {
        wx.setStorageSync(PENDING_TOAST_KEY, title);
      } catch (e) {
        // ignore
      }
      consumePendingRoomGoneToast();
    }
    return true;
  }

  _exiting = true;
  _lastExitAt = now;
  clearRoomLocalState(roomId);
  _scheduleHomeReLaunch(resolveToastTitle(result, options));
  return true;
}

/**
 * 幂等退出已解散/不存在房间。
 * 授权进行中：先清房间数据并挂起跳转，授权结束后再 toast + reLaunch。
 * @returns {boolean} 是否已处理（含排队/进行中的重复调用）
 */
function exitRoomGone(result, options = {}) {
  const now = Date.now();
  if (_exiting || now - _lastExitAt < 2500) {
    return true;
  }

  // 授权中：保留登录/授权，延后跳转与提示
  if (isUserAuthInProgress()) {
    const roomId = options.roomId
      || (result && result.roomId)
      || (getApp().globalData && getApp().globalData.roomId)
      || '';
    clearRoomLocalState(roomId);
    _deferredExit = { result, options: { ...options, roomId } };
    runAfterUserAuth(() => {
      const pending = _deferredExit;
      _deferredExit = null;
      if (!pending) return;
      _runExitRoomGone(pending.result, pending.options);
    });
    return true;
  }

  return _runExitRoomGone(result, options);
}

/** 轮询/接口结果：解散或不在房间时统一处理 */
function handleRoomGoneFromResult(result, roomId, options = {}) {
  if (!result) return false;
  if (isRoomDissolvedResult(result)) {
    return exitRoomGone(result, { roomId, forceDissolved: true, ...options });
  }
  if (isRemovedFromRoomResult(result)) {
    return exitRoomGone(result, { roomId, ...options });
  }
  return false;
}

/** 首页 onShow：消费待显示的解散/踢出提示（幂等） */
function consumePendingRoomGoneToast() {
  let title = '';
  try {
    title = wx.getStorageSync(PENDING_TOAST_KEY) || '';
    if (title) wx.removeStorageSync(PENDING_TOAST_KEY);
  } catch (e) {
    return false;
  }
  if (!title) return false;
  wx.showToast({
    title: String(title),
    icon: 'none',
    duration: 2000
  });
  return true;
}

function resetRoomGoneGuardForTest() {
  _exiting = false;
  _lastExitAt = 0;
  _deferredExit = null;
}

module.exports = {
  HOME_URL,
  HOME_ROUTE,
  PROTECTED_STORAGE_KEYS,
  ROOM_STORAGE_KEYS,
  isRoomDissolvedResult,
  isRemovedFromRoomResult,
  clearRoomLocalState,
  exitRoomGone,
  handleRoomGoneFromResult,
  consumePendingRoomGoneToast,
  resetRoomGoneGuardForTest
};
