Page({
  data: {
    activeTouches: [], // 当前活动的触摸点 [{id, x, y, timestamp}]
    playerCount: 0, // 当前参与玩家数
    minPlayers: 4, // 最少需要玩家数
    countdown: 5, // 倒计时
    isSelecting: false // 是否正在选择
  },

  onLoad() {
    // 页面加载
  },

  onUnload() {
    // 清除定时器
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }
    if (this.selectionTimer) {
      clearTimeout(this.selectionTimer);
    }
  },

  // 触摸开始
  onTouchStart(e) {
    const touches = e.touches;
    const now = Date.now();
    
    // 获取系统信息，用于坐标转换
    const systemInfo = wx.getSystemInfoSync();
    
    // 为每个新的触摸点创建波纹
    touches.forEach(touch => {
      const touchId = touch.identifier;
      // 使用 clientX/clientY 相对于视口的坐标
      const newTouch = {
        id: touchId,
        x: touch.clientX,
        y: touch.clientY,
        timestamp: now,
        visible: true
      };
      
      // 检查是否已存在该触摸点
      const existingIndex = this.data.activeTouches.findIndex(t => t.id === touchId);
      if (existingIndex === -1) {
        this.data.activeTouches.push(newTouch);
      } else {
        // 更新现有触摸点位置
        this.data.activeTouches[existingIndex] = newTouch;
      }
    });
    
    this.updatePlayerCount();
    this.setData({
      activeTouches: [...this.data.activeTouches]
    });
  },

  // 触摸移动
  onTouchMove(e) {
    const touches = e.touches;
    
    // 更新触摸点位置
    touches.forEach(touch => {
      const touchId = touch.identifier;
      const index = this.data.activeTouches.findIndex(t => t.id === touchId);
      if (index !== -1) {
        this.data.activeTouches[index].x = touch.clientX;
        this.data.activeTouches[index].y = touch.clientY;
      }
    });
    
    this.setData({
      activeTouches: [...this.data.activeTouches]
    });
  },

  // 触摸结束
  onTouchEnd(e) {
    const changedTouches = e.changedTouches;
    
    // 移除结束的触摸点
    changedTouches.forEach(touch => {
      const touchId = touch.identifier;
      const index = this.data.activeTouches.findIndex(t => t.id === touchId);
      if (index !== -1) {
        this.data.activeTouches.splice(index, 1);
      }
    });
    
    this.updatePlayerCount();
    this.setData({
      activeTouches: [...this.data.activeTouches]
    });
  },

  // 触摸取消
  onTouchCancel(e) {
    this.onTouchEnd(e);
  },

  // 更新玩家数量
  updatePlayerCount() {
    const count = this.data.activeTouches.length;
    this.setData({
      playerCount: count
    });
    
    // 如果达到最少玩家数，可以开始选择
    if (count >= this.data.minPlayers && !this.data.isSelecting) {
      this.startSelection();
    }
  },

  // 开始选择玩家
  startSelection() {
    if (this.data.isSelecting) return;
    
    this.setData({
      isSelecting: true
    });
    
    // 启动倒计时
    this.startCountdown();
    
    // 3秒后随机选择
    this.selectionTimer = setTimeout(() => {
      this.selectRandomPlayer();
    }, 3000);
  },

  // 启动倒计时
  startCountdown() {
    let countdown = 3;
    this.setData({
      countdown: countdown
    });
    
    this.countdownTimer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        this.setData({
          countdown: countdown
        });
      } else {
        clearInterval(this.countdownTimer);
        this.setData({
          countdown: 0
        });
      }
    }, 1000);
  },

  // 随机选择玩家
  selectRandomPlayer() {
    if (this.data.activeTouches.length === 0) {
      wx.showToast({
        title: '没有检测到玩家',
        icon: 'none'
      });
      this.setData({
        isSelecting: false
      });
      return;
    }
    
    // 随机选择一个触摸点
    const randomIndex = Math.floor(Math.random() * this.data.activeTouches.length);
    const selectedTouch = this.data.activeTouches[randomIndex];
    
    // 保存选中的玩家信息
    getApp().globalData.selectedPlayer = {
      touchId: selectedTouch.id,
      position: {
        x: selectedTouch.x,
        y: selectedTouch.y
      }
    };
    
    wx.showToast({
      title: '已选择首位出牌玩家',
      icon: 'success',
      duration: 2000
    });
    
    // 延迟跳转
    setTimeout(() => {
      // TODO: 跳转到游戏主界面
      wx.showToast({
        title: '游戏开始',
        icon: 'success'
      });
    }, 2000);
  },

  // 跳过选择
  skipSelection() {
    wx.showModal({
      title: '确认跳过',
      content: '确定要跳过玩家选择吗？',
      success: (res) => {
        if (res.confirm) {
          // 随机选择一个玩家
          if (this.data.activeTouches.length > 0) {
            const randomIndex = Math.floor(Math.random() * this.data.activeTouches.length);
            const selectedTouch = this.data.activeTouches[randomIndex];
            
            getApp().globalData.selectedPlayer = {
              touchId: selectedTouch.id,
              position: {
                x: selectedTouch.x,
                y: selectedTouch.y
              }
            };
          }
          
          // TODO: 跳转到游戏主界面
          wx.showToast({
            title: '已跳过选择',
            icon: 'success'
          });
        }
      }
    });
  },

  // 添加玩家
  addPlayer() {
    wx.showToast({
      title: '添加玩家功能',
      icon: 'none'
    });
  },

  // 返回
  goBack() {
    wx.navigateBack();
  }
})

