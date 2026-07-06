const { navigateByRoomState } = require('./subAwaitRoutes');
const { getCurrentRoute, openUrl } = require('./pageNavigate');
const { clearLocalBrainstormProgress } = require('./roomBrainstormProgress');
const { clearPartnerSpecialMoveUsedFlag } = require('./partnerSpecialMove');

const HOME_ROUTE = 'pages/main-pages/aaa/index';
const ADD_PLAYER_ROUTE = 'pages/main-pages/addPlayer/index';

let _dissolvedRedirecting = false;

function isRoomDissolvedResult(result) {
  if (!result) return false;
  if (result.roomDissolved === true) return true;
  const code = result.errCode || '';
  return code === 'ROOM_DISSOLVED' || code === 'ROOM_NOT_FOUND';
}

function isSubScreenRemovedFromRoom(result) {
  if (!result || result.ok !== true) return false;
  if (result.isHost === true) return false;
  const members = result.members || [];
  return !members.some((m) => m && m.isMe);
}

function shouldSubScreenLeaveRoom(result) {
  if (isRoomDissolvedResult(result)) return true;
  if (result && result.errCode === 'NOT_IN_ROOM') return true;
  return isSubScreenRemovedFromRoom(result);
}

function redirectSubScreenHomeDissolved(result) {
  if (_dissolvedRedirecting) return true;
  if (getCurrentRoute() === HOME_ROUTE) return true;
  _dissolvedRedirecting = true;
  try {
    wx.removeStorageSync('joinedRoomId');
  } catch (e) {
    console.warn('removeStorage joinedRoomId failed', e);
  }
  const app = getApp();
  if (app && app.globalData) app.globalData.roomId = null;
  const msg = isRoomDissolvedResult(result) ? '原房间已解散' : '您已不在该房间';
  wx.showToast({ title: msg, icon: 'none' });
  setTimeout(() => {
    wx.reLaunch({ url: `/${HOME_ROUTE}` });
    _dissolvedRedirecting = false;
  }, 1200);
  return true;
}

function redirectSubScreenToAddPlayer(roomId) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  if (!id) return false;
  if (getCurrentRoute() === ADD_PLAYER_ROUTE) return false;
  clearLocalBrainstormProgress(id);
  clearPartnerSpecialMoveUsedFlag(id);
  return openUrl(`/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(id)}`);
}

/**
 * 副屏轮询统一入口：处理房间解散、退出脑暴回大厅、跟随主屏跳转
 * @param {object} result getAddPlayerData 返回值
 * @param {string} roomId
 * @param {object} [options]
 * @param {(result: object) => boolean|void} [options.beforeNavigate] 返回 true 表示已处理
 */
function followSubScreenRoomPoll(result, roomId, options = {}) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';

  if (shouldSubScreenLeaveRoom(result)) {
    return redirectSubScreenHomeDissolved(result);
  }

  if (!result || result.ok !== true || !result.roomState) return false;

  const page = (result.roomState.currentPage || 'addplayer').toLowerCase();

  if (page === 'addplayer' && result.hasSelectedMode !== true) {
    if (getCurrentRoute() !== ADD_PLAYER_ROUTE) {
      return redirectSubScreenToAddPlayer(id);
    }
    return false;
  }

  if (typeof options.beforeNavigate === 'function') {
    const handled = options.beforeNavigate(result, page);
    if (handled === true) return true;
  }

  return navigateByRoomState(page, result.roomState, id);
}

module.exports = {
  isRoomDissolvedResult,
  isSubScreenRemovedFromRoom,
  shouldSubScreenLeaveRoom,
  redirectSubScreenHomeDissolved,
  redirectSubScreenToAddPlayer,
  followSubScreenRoomPoll
};
