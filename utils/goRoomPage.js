/** 跳转房间大厅页 addPlayer（清空页面栈，避免从深层流程 navigateBack 乱跳转） */
const { setSpyLobbyStay, clearSpyFollowLock } = require('./spyFollow');
const { clearPendingNavigation } = require('./pageNavigate');
const { clearLocalBrainstormProgress } = require('./roomBrainstormProgress');

function goRoomPage(roomId) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  // 先锁大厅 + 清掉在途跟随导航，避免游戏页轮询竞态把人拉回
  if (id) setSpyLobbyStay(id);
  clearSpyFollowLock();
  clearPendingNavigation();
  const url = id
    ? `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(id)}&stayLobby=1`
    : '/pages/main-pages/addPlayer/index?stayLobby=1';
  wx.reLaunch({ url });
}

/**
 * 合伙人整局结束后回房间。
 * 仅房主可 updateRoomState 清会话；非房主直接进大厅，避免权限失败。
 */
async function endPartnerSessionAndGoRoom(roomId, options) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  if (!id) {
    goRoomPage('');
    return;
  }
  clearLocalBrainstormProgress(id);
  const isHost = !!(options && options.isHost);
  if (isHost) {
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId: id,
          currentPage: 'addPlayer',
          partnerGamePhase: 'play',
          partnerMasterMode: false,
          resetClosingVotes: true,
          clearBrainstormProgress: true,
          brainstormSessionEnded: true
        }
      });
    } catch (e) {
      console.warn('endPartnerSessionAndGoRoom updateRoomState', e);
    }
  }
  goRoomPage(id);
}

module.exports = {
  goRoomPage,
  endPartnerSessionAndGoRoom
};
