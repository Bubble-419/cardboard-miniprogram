Page({
  data: {
    roomId: '',
    isHost: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isHost = options && (options.isHost === '1' || options.isHost === true);
    this.setData({ roomId, isHost: !!isHost });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({
          url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(this.data.roomId)}`
        });
      }
    });
  }
});
