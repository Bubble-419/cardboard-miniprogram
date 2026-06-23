/**
 * 谁是卧底模式 - 模式首页（占位）
 * 路径：pages/main-pages/spyMode/modeIndex/
 * TODO: 实现谁是卧底模式的完整游戏流程
 * 入口参数：roomId, modeId
 */
Page({
  data: {
    roomId: '',
    modeId: 'spy',
    pageTitle: '谁是卧底模式'
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const modeId = (options && options.modeId) || 'spy';
    this.setData({ roomId, modeId });
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
