const { navigateByRoomState } = require('./subAwaitRoutes');
const { getCurrentRoute, openUrl } = require('./pageNavigate');
const { clearLocalBrainstormProgress } = require('./roomBrainstormProgress');
const { clearPartnerSpecialMoveUsedFlag } = require('./partnerSpecialMove');
const {
  isRoomDissolvedResult,
  isRemovedFromRoomResult,
  handleRoomGoneFromResult
} = require('./roomDissolved');
const { handleRoomLastEvent } = require('./roomMembersSync');

const ADD_PLAYER_ROUTE = 'pages/main-pages/addPlayer/index';

function isSubScreenRemovedFromRoom(result) {
  if (!result || result.ok !== true) return false;
  if (result.isHost === true) return false;
  const members = result.members || [];
  return !members.some((m) => m && m.isMe);
}

function shouldSubScreenLeaveRoom(result) {
  if (isRoomDissolvedResult(result)) return true;
  if (isRemovedFromRoomResult(result)) return true;
  return isSubScreenRemovedFromRoom(result);
}

function redirectSubScreenHomeDissolved(result, roomId) {
  // 成员被踢但房间仍在：handleRoomGoneFromResult 走「不在房间」文案
  if (isRoomDissolvedResult(result) || isRemovedFromRoomResult(result)) {
    return handleRoomGoneFromResult(result, roomId);
  }
  // 轮询到不在成员列表（被踢/成员表已空）
  return handleRoomGoneFromResult(
    { ok: false, errCode: 'NOT_IN_ROOM', errMsg: '您已不在该房间' },
    roomId
  );
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
    return redirectSubScreenHomeDissolved(result, id);
  }

  if (!result || result.ok !== true || !result.roomState) return false;

  // 成员变更 / 只剩 1 人回退房间：房主与成员均处理（幂等）
  if (handleRoomLastEvent(result, id, options)) {
    return true;
  }

  const page = (result.roomState.currentPage || 'addplayer').toLowerCase();

  if (typeof options.beforeNavigate === 'function') {
    const handled = options.beforeNavigate(result, page);
    if (handled === true) return true;
  }

  // 已退出游戏模式：房主与成员均从游戏页回到房间等待态
  if (result.hasSelectedMode !== true) {
    const current = getCurrentRoute();
    // 房主停在脑暴模式页：非房主统一进空状态，等待确认游戏模式
    if (page === 'brainstormmode') {
      if (result.isHost === true) return false;
      return navigateByRoomState(page, result.roomState, id, { isHost: false });
    }
    // 正在「选择脑暴模式」页时不要强行拉回大厅（房主主动进入）
    if (current === 'pages/main-pages/brainstormMode/index') {
      return false;
    }
    if (current !== ADD_PLAYER_ROUTE) {
      return redirectSubScreenToAddPlayer(id);
    }
    return false;
  }

  // 房主不做副屏页面跳转，但仍允许 beforeNavigate 更新页内状态（如倒计时）
  if (result.isHost === true) {
    return false;
  }

  // 主动回大厅期间：不跟随游戏页
  try {
    const { isSpyLobbyStayActive } = require('./spyFollow');
    if (isSpyLobbyStayActive(id) && getCurrentRoute() === ADD_PLAYER_ROUTE) {
      return false;
    }
  } catch (e) {
    // ignore
  }

  return navigateByRoomState(page, result.roomState, id, { isHost: false });
}

module.exports = {
  isRoomDissolvedResult,
  isSubScreenRemovedFromRoom,
  shouldSubScreenLeaveRoom,
  redirectSubScreenHomeDissolved,
  redirectSubScreenToAddPlayer,
  followSubScreenRoomPoll
};
