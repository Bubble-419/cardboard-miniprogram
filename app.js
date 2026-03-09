App({
  onLaunch() {
    // 小程序启动
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
          env: 'cardboard-miniprogram-6a13aab073', // 替换为您的环境 ID
          traceUser: true,
      });
    }
  },
  globalData: {
    userRole: null,
    roomId: null,
    selectedProblem: null,
    selectedMode: null,
    selectedPlayer: null,
    selectedBG: null,
    workshopName: "工作坊名称"
  }
})

