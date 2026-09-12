/** 跳转房间大厅页 addPlayer（清空页面栈，避免从深层流程 navigateBack 乱跳转） */
const { setSpyLobbyStay, clearSpyFollowLock } = require('./spyFollow');
const { clearPendingNavigation } = require('./pageNavigate');

function goRoomPage(roomId) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  // 先锁大厅 + 清掉在途跟随导航，避免游戏页轮询竞态把人拉回
  if (id) setSpyLobbyStay(id);
  clearSpyFollowLock();
  clearPendingNavigation();
  const url = id
    ? `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(id)}&stayLobby=1`
    : '/pages/main-pages/addPlayer/index?stayLobby=1';
  return new Promise((resolve) => {
    wx.reLaunch({
      url,
      success: (result) => resolve({ ok: true, result }),
      fail: (error) => resolve({ ok: false, error })
    });
  });
}

/**
 * 合伙人整局结束后回房间。
 * 已完成场次由房主提交 RETURN_TO_LOBBY；非房主只进行本地导航。
 */
async function endPartnerSessionAndGoRoom(roomId, options) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  if (!id) {
    return goRoomPage('');
  }
  const isHost = !!(options && options.isHost);
  if (isHost) {
    try {
      const { getActiveRoomSession, dispatchRoomCommand } = require('../modules/room-session/index');
      const view = getActiveRoomSession() && getActiveRoomSession().getView();
      const session = view && view.session;
      if (session && session.status === 'COMPLETED') {
        await dispatchRoomCommand('RETURN_TO_LOBBY', {}, { sessionId: session.sessionId });
      }
    } catch (e) {
      console.warn('endPartnerSessionAndGoRoom', e);
    }
  }
  return goRoomPage(id);
}

module.exports = {
  goRoomPage,
  endPartnerSessionAndGoRoom
};
