/**
 * 德国心脏病模式 - 模式首页（占位）
 * 路径：pages/main-pages/halliGalli/modeIndex/
 * TODO: 实现德国心脏病模式的完整游戏流程
 * 入口参数：roomId, modeId
 */
Page({
  data: {
    roomId: '',
    modeId: 'halliGalli',
    pageTitle: '德国心脏病模式'
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const modeId = (options && options.modeId) || 'halliGalli';
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
