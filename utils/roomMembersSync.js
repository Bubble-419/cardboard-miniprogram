/**
 * 房间成员变更 / 回退等待房间：统一消费 getAddPlayerData 的 lastEvent
 *
 * - room_members_updated：各页用服务端 members / roomState 刷新 UI（本模块仅标记）
 * - game_returned_to_room：有效人数 ≤1，回房间页 + toast（幂等；授权中挂起）
 */
const { clearLocalBrainstormProgress } = require('./roomBrainstormProgress');
const { clearPartnerSpecialMoveUsedFlag } = require('./partnerSpecialMove');
const { getCurrentRoute, clearPendingNavigation } = require('./pageNavigate');
const {
  isUserAuthInProgress,
  runAfterUserAuth
} = require('./userAuthSession');
const { setSpyLobbyStay, clearSpyFollowLock } = require('./spyFollow');

const ADD_PLAYER_ROUTE = 'pages/main-pages/addPlayer/index';
const GAME_RETURNED_TYPE = 'game_returned_to_room';
const MEMBERS_UPDATED_TYPE = 'room_members_updated';
const TOAST_TITLE = '其他玩家已退出，已返回房间';
const PENDING_TOAST_KEY = 'pendingGameReturnedToast';

let _returning = false;
let _lastHandledEventAt = 0;
let _deferredReturn = null;

function getLastEvent(result) {
  if (!result) return null;
  if (result.lastEvent && typeof result.lastEvent === 'object') {
    return result.lastEvent;
  }
  if (result.event === GAME_RETURNED_TYPE || result.event === MEMBERS_UPDATED_TYPE) {
    return { type: result.event, at: result.eventAt || 0 };
  }
  return null;
}

function isRoomMembersUpdatedEvent(result) {
  const ev = getLastEvent(result);
  return !!(ev && ev.type === MEMBERS_UPDATED_TYPE);
}

function isGameReturnedToRoomEvent(result) {
  const ev = getLastEvent(result);
  return !!(ev && ev.type === GAME_RETURNED_TYPE);
}

function clearSessionProgressKeepAuth(roomId) {
  const id = roomId
    || (getApp().globalData && getApp().globalData.roomId)
    || '';
  if (id) {
    clearLocalBrainstormProgress(id);
    clearPartnerSpecialMoveUsedFlag(id);
  }
  try {
    clearSpyFollowLock();
    clearPendingNavigation();
  } catch (e) {
    // ignore
  }
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.selectedMode = null;
      app.globalData.selectedProblem = null;
      app.globalData.selectedBG = null;
      app.globalData.gameMode = null;
      app.globalData.selectedPlayer = null;
    }
  } catch (e) {
    // ignore
  }
}

function _showReturnedToast() {
  try {
    wx.setStorageSync(PENDING_TOAST_KEY, TOAST_TITLE);
  } catch (e) {
    // ignore
  }
  wx.showToast({
    title: TOAST_TITLE,
    icon: 'none',
    duration: 2000
  });
}

function _reLaunchAddPlayer(roomId) {
  const id = roomId || '';
  if (id) setSpyLobbyStay(id);
  clearSpyFollowLock();
  clearPendingNavigation();
  const url = id
    ? `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(id)}&stayLobby=1&gameReturned=1`
    : '/pages/main-pages/addPlayer/index?stayLobby=1&gameReturned=1';
  wx.reLaunch({
    url,
    complete: () => {
      _returning = false;
    }
  });
}

function _runGameReturnedToRoom(result, options = {}) {
  const now = Date.now();
  const ev = getLastEvent(result) || {};
  const eventAt = Number(ev.at) || 0;

  if (_returning) return true;
  if (eventAt && eventAt === _lastHandledEventAt) return false;
  if (!eventAt && now - _lastHandledEventAt < 2500) return true;

  _lastHandledEventAt = eventAt || now;
  const roomId = options.roomId
    || (result && result.roomId)
    || (getApp().globalData && getApp().globalData.roomId)
    || '';

  clearSessionProgressKeepAuth(roomId);

  const onLobby = getCurrentRoute() === ADD_PLAYER_ROUTE;
  if (onLobby) {
    _showReturnedToast();
    if (typeof options.onAlreadyInLobby === 'function') {
      try {
        options.onAlreadyInLobby(result);
      } catch (e) {
        // ignore
      }
    }
    // 已在大厅：不拦截后续 setData / 成员刷新
    return false;
  }

  _returning = true;
  _showReturnedToast();
  setTimeout(() => {
    _reLaunchAddPlayer(roomId);
  }, 180);
  return true;
}

/**
 * 有效人数只剩 1 人：回房间等待页（幂等；授权进行中挂起）
 */
function handleGameReturnedToRoom(result, options = {}) {
  if (!isGameReturnedToRoomEvent(result)) return false;

  const ev = getLastEvent(result) || {};
  const eventAt = Number(ev.at) || 0;
  // 已处理过同一事件：勿拦截后续轮询刷新
  if (eventAt && eventAt === _lastHandledEventAt) return false;
  if (_returning) return true;

  if (isUserAuthInProgress()) {
    const roomId = options.roomId
      || (result && result.roomId)
      || (getApp().globalData && getApp().globalData.roomId)
      || '';
    clearSessionProgressKeepAuth(roomId);
    _deferredReturn = { result, options: { ...options, roomId } };
    runAfterUserAuth(() => {
      const pending = _deferredReturn;
      _deferredReturn = null;
      if (!pending) return;
      _runGameReturnedToRoom(pending.result, pending.options);
    });
    return true;
  }

  return _runGameReturnedToRoom(result, options);
}

/**
 * 轮询/快照统一入口：先处理回退房间，再标记成员变更
 * @returns {boolean} true 表示已处理「回退房间」导航，调用方应停止局内 UI 更新
 */
function handleRoomLastEvent(result, roomId, options = {}) {
  if (!result || result.ok !== true) return false;

  if (handleGameReturnedToRoom(result, { roomId, ...options })) {
    return true;
  }

  if (isRoomMembersUpdatedEvent(result) && typeof options.onMembersUpdated === 'function') {
    try {
      options.onMembersUpdated(result);
    } catch (e) {
      // ignore
    }
  }

  return false;
}

/** addPlayer onShow：消费待显示 toast */
function consumePendingGameReturnedToast() {
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

function resetGameReturnedGuardForTest() {
  _returning = false;
  _lastHandledEventAt = 0;
  _deferredReturn = null;
}

module.exports = {
  GAME_RETURNED_TYPE,
  MEMBERS_UPDATED_TYPE,
  TOAST_TITLE,
  getLastEvent,
  isRoomMembersUpdatedEvent,
  isGameReturnedToRoomEvent,
  handleGameReturnedToRoom,
  handleRoomLastEvent,
  consumePendingGameReturnedToast,
  clearSessionProgressKeepAuth,
  resetGameReturnedGuardForTest
};
