/** 跳转房间大厅页 addPlayer（清空页面栈，避免从深层流程 navigateBack 乱跳转） */
function goRoomPage(roomId) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  const url = id
    ? `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(id)}`
    : '/pages/main-pages/addPlayer/index';
  wx.reLaunch({ url });
}

module.exports = {
  goRoomPage
};
