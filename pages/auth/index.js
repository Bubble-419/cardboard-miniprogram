Page({
  data: {},

  onLoad() {
    // 页面加载
  },

  /**
   * 已设定情境：选择线下大屏上已展示的情境，直接进入游戏
   */
  selectPresetScenario() {
    const roomId = getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息，请先创建房间', icon: 'none' });
      return;
    }
    wx.redirectTo({
      url: `/pages/main-pages/gamepage/index?roomId=${encodeURIComponent(roomId)}`
    });
  },

  /**
   * 自定义情境：自行选择情境卡（场景、用户、平台、功能）
   */
  selectCustomScenario() {
    wx.redirectTo({
      url: '/pages/main-pages/selectBG/index'
    });
  },

  // 跳转到灵感空间
  goToInspiration() {
    wx.navigateTo({
      url: '/pages/inspiration/index'
    });
  }
});
