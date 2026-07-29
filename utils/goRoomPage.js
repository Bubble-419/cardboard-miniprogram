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
  wx.reLaunch({ url });
}

module.exports = {
  goRoomPage
};
