Page({
  data: {
    countdown: 5
  },

  onLoad() {
    // 启动倒计时
    this.startCountdown();
    
    // 启动定时器，检查游戏状态变化
    this.startStateCheck();
  },

  onShow() {
    // 页面显示时也检查状态
    this.checkGameState();
  },

  onUnload() {
    // 清除倒计时
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }
    // 清除状态检查定时器
    if (this.stateCheckTimer) {
      clearInterval(this.stateCheckTimer);
    }
  },

  startCountdown() {
    this.countdownTimer = setInterval(() => {
      if (this.data.countdown > 0) {
        this.setData({
          countdown: this.data.countdown - 1
        });
      } else {
        // 倒计时结束后重新开始
        this.setData({
          countdown: 5
        });
      }
    }, 1000);
  },

  // 检查游戏状态
  checkGameState() {
    const db = wx.cloud.database();
    
    // 从云数据库查询当前游戏状态
    db.collection('gameState')
      .orderBy('updateTime', 'desc')
      .limit(1)
      .get({
        success: (res) => {
          if (res.data && res.data.length > 0) {
            const currentState = res.data[0].currentPage;
            
            // 如果状态变为其他页面，根据需求跳转
            // 这里可以根据实际需求添加更多状态判断
            // 例如：如果状态变为游戏开始，可以跳转到游戏页面
          }
        },
        fail: (err) => {
          console.error('检查游戏状态失败:', err);
        }
      });
  },

  // 启动状态检查定时器
  startStateCheck() {
    // 清除之前的定时器（如果存在）
    if (this.stateCheckTimer) {
      clearInterval(this.stateCheckTimer);
    }
    // 每500毫秒检查一次游戏状态
    this.stateCheckTimer = setInterval(() => {
      this.checkGameState();
    }, 500);
  }
})

