Page({
  data: {
    activeTouches: [], // 当前活动的触摸点 [{id, x, y, timestamp}]
    playerCount: 0, // 当前参与玩家数
    minPlayers: 4, // 最少需要玩家数
    countdown: 5, // 倒计时
    isSelecting: false, // 是否正在选择
    selectedTouchId: null, // 被选中玩家的触摸点 id，用于显示光效
    roomId: '',
    members: [] // 房间成员，用于跳过时随机选取
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    this.setData({ roomId });
    if (roomId) this.loadMembers(roomId);
  },

  async loadMembers(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.members && result.members.length) {
        this.setData({
          members: result.members,
          minPlayers: result.members.length
        });
      }
    } catch (e) {
      console.warn('loadMembers', e);
    }
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
    
    // 1 秒后随机选择
    this.selectionTimer = setTimeout(() => {
      this.selectRandomPlayer();
    }, 1000);
  },

  // 启动倒计时
  startCountdown() {
    let countdown = 2;
    this.setData({
      countdown: countdown
    });
    
    this.countdownTimer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        this.setData({ countdown });
      } else {
        clearInterval(this.countdownTimer);
        this.setData({ countdown: 0 });
      }
    }, 500);
  },

  // 随机选择玩家
  selectRandomPlayer() {
    const { activeTouches, members, roomId } = this.data;
    let currentPlayerIndex = 1;

    if (activeTouches.length > 0) {
      // 随机选择一个触摸点，在波纹下显示光效
      const randomIndex = Math.floor(Math.random() * activeTouches.length);
      const selectedTouch = activeTouches[randomIndex];
      // 触摸序号对应成员序号，有成员时取对应 playerIndex
      if (members.length > 0) {
        const mIndex = randomIndex % members.length;
        currentPlayerIndex = members[mIndex].playerIndex;
      } else {
        currentPlayerIndex = randomIndex + 1;
      }

      getApp().globalData.selectedPlayer = {
        touchId: selectedTouch.id,
        position: { x: selectedTouch.x, y: selectedTouch.y },
        currentPlayerIndex
      };

      this.setData({ selectedTouchId: selectedTouch.id });
      wx.showToast({ title: '已选择首位出牌玩家', icon: 'success', duration: 2000 });
    } else {
      // 无触摸时从成员中随机选
      if (members.length > 0) {
        const mIndex = Math.floor(Math.random() * members.length);
        currentPlayerIndex = members[mIndex].playerIndex;
      }
      getApp().globalData.selectedPlayer = { currentPlayerIndex };
      wx.showToast({ title: '已随机选择玩家', icon: 'success', duration: 1000 });
    }

    // 光效展示约 1.5 秒后自动跳转
    const delay = activeTouches.length > 0 ? 1500 : 800;
    setTimeout(() => this.navigateToGamepage(roomId, currentPlayerIndex), delay);
  },

  // 跳过选择：直接系统随机选定一个玩家并跳转
  skipSelection() {
    const { activeTouches, members, roomId } = this.data;
    let currentPlayerIndex = 1;

    if (activeTouches.length > 0) {
      const randomIndex = Math.floor(Math.random() * activeTouches.length);
      const selectedTouch = activeTouches[randomIndex];
      if (members.length > 0) {
        currentPlayerIndex = members[randomIndex % members.length].playerIndex;
      } else {
        currentPlayerIndex = randomIndex + 1;
      }
      getApp().globalData.selectedPlayer = {
        touchId: selectedTouch.id,
        position: { x: selectedTouch.x, y: selectedTouch.y },
        currentPlayerIndex
      };
      this.setData({ selectedTouchId: selectedTouch.id });
      wx.showToast({ title: '已随机选定玩家', icon: 'success', duration: 1200 });
      setTimeout(() => this.navigateToGamepage(roomId, currentPlayerIndex), 1200);
    } else {
      if (members.length > 0) {
        const mIndex = Math.floor(Math.random() * members.length);
        currentPlayerIndex = members[mIndex].playerIndex;
      }
      getApp().globalData.selectedPlayer = { currentPlayerIndex };
      wx.showToast({ title: '已随机选定玩家', icon: 'success' });
      setTimeout(() => this.navigateToGamepage(roomId, currentPlayerIndex), 800);
    }
  },

  navigateToGamepage(roomId, currentPlayerIndex) {
    if (!roomId) {
      roomId = getApp().globalData.roomId || '';
    }
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }
    wx.redirectTo({
      url: `/pages/main-pages/gamepage/index?roomId=${encodeURIComponent(roomId)}&currentPlayerIndex=${currentPlayerIndex}`
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

