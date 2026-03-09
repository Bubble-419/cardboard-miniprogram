Page({
  data: {
    activeTouches: [],
    playerCount: 0,
    minPlayers: 4,
    countdown: 5,
    isSelecting: false,
    selectedTouchId: null,
    selectedPlayerIndex: null,
    selectedPosition: null, // 选中时的坐标，用于水波纹动画
    selectionAnimationDone: false, // 1.5s 动画结束后为 true，此时显示「几号玩家被选中」和确认按钮
    roomId: '',
    members: []
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
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    if (this.animationDoneTimer) clearTimeout(this.animationDoneTimer);
  },

  // 触摸开始
  onTouchStart(e) {
    if (this.data.selectedPlayerIndex) return;
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
    if (this.data.selectedPlayerIndex) return;
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
    if (this.data.selectedPlayerIndex) return;
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

  // 随机选择玩家：被选中的位置播放 1.5s 水波纹动画，结束后显示几号玩家被选中 + 确认按钮
  selectRandomPlayer() {
    const { activeTouches, members } = this.data;
    let currentPlayerIndex = 1;
    let selectedPosition = null;

    if (activeTouches.length > 0) {
      const randomIndex = Math.floor(Math.random() * activeTouches.length);
      const selectedTouch = activeTouches[randomIndex];
      selectedPosition = { x: selectedTouch.x, y: selectedTouch.y };
      if (members.length > 0) {
        const mIndex = randomIndex % members.length;
        currentPlayerIndex = members[mIndex].playerIndex;
      } else {
        currentPlayerIndex = randomIndex + 1;
      }
      getApp().globalData.selectedPlayer = {
        touchId: selectedTouch.id,
        position: selectedPosition,
        currentPlayerIndex
      };
      this.setData({
        selectedTouchId: selectedTouch.id,
        selectedPlayerIndex: currentPlayerIndex,
        selectedPosition,
        selectionAnimationDone: false
      });
    } else {
      if (members.length > 0) {
        const mIndex = Math.floor(Math.random() * members.length);
        currentPlayerIndex = members[mIndex].playerIndex;
      }
      getApp().globalData.selectedPlayer = { currentPlayerIndex };
      this.setData({
        selectedTouchId: null,
        selectedPlayerIndex: currentPlayerIndex,
        selectedPosition: null,
        selectionAnimationDone: true
      });
    }

    const SELECTION_ANIMATION_DURATION = 1500;
    if (selectedPosition) {
      this.animationDoneTimer = setTimeout(() => {
        this.setData({ selectionAnimationDone: true });
      }, SELECTION_ANIMATION_DURATION);
    }
  },

  confirmSelection() {
    const { selectedPlayerIndex, roomId } = this.data;
    if (selectedPlayerIndex == null) return;
    this.navigateToGamepage(roomId, selectedPlayerIndex);
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

