/**
 * 合伙人模式 - 模式首页（占位）
 * 路径：pages/main-pages/partnerMode/modeIndex/
 * TODO: 实现合伙人模式的完整游戏流程
 * 入口参数：roomId, modeId
 */
Page({
  data: {
    roomId: '',
    modeId: 'partner',
    pageTitle: '合伙人模式'
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const modeId = (options && options.modeId) || 'partner';
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
