Page({
  data: {
    roomId: ''
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (roomId) {
      getApp().globalData.roomId = roomId;
    }
    this.setData({ roomId });
  },

  handleGoBack() {
    wx.navigateBack();
  }
});
