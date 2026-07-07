/** 跳转房间大厅页 addPlayer */
function goRoomPage(roomId) {
  const id = roomId || (getApp().globalData && getApp().globalData.roomId) || '';
  if (!id) {
    wx.reLaunch({ url: '/pages/main-pages/addPlayer/index' });
    return;
  }
  wx.navigateTo({
    url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(id)}`
  });
}

module.exports = {
  goRoomPage
};
