Page({
  data: {
    userRole: null // 'god' 或 'player'
  },

  onLoad() {
    // 页面加载
  },

  // 选择上帝用户
  selectGod() {
    this.setData({
      userRole: 'god'
    });
    
    // 保存用户身份到全局
    getApp().globalData.userRole = 'god';
    
    // 跳转到主屏页面
    wx.redirectTo({
      url: '/pages/main-pages/selectProblem/index'
    });
  },

  // 选择玩家用户
  selectPlayer() {
    this.setData({
      userRole: 'player'
    });
    
    // 保存用户身份到全局
    getApp().globalData.userRole = 'player';
    
    // 跳转到副屏页面（提交问题页面）
    wx.redirectTo({
      url: '/pages/sub-pages/submitProblem/index'
    });
  }
})

