const { navigateByRoomState, openSubAwait } = require('../../../utils/subAwaitRoutes');
const {
  bindPageToRoomSession,
  unbindPageFromRoomSession
} = require('../../../modules/room-session/index');
const { safeNavigateBack } = require('../../../utils/pageNavigate');

Page({
  data: {
    activeTouches: [],
    playerCount: 0,
    minPlayers: 0,
    countdown: 1,
    isSelecting: false,
    selectedTouchId: null,
    roomId: '',
    members: [],
    selectedModeId: '',
    isHost: false,
    isWaiting: false // 普通玩家等待房主在主屏抽取首位玩家
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);
    const forceHost = options && (options.isHost === '1' || options.isHost === true);
    const modeId = (options && options.modeId) || '';
    if (modeId === 'partner') {
      getApp().globalData.gameMode = 'partner';
    }
    this.setData({
      roomId,
      isWaiting: !!isWaiting,
      selectedModeId: modeId || this.data.selectedModeId
    });
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }
    getApp().globalData.roomId = roomId;

    if (isWaiting && !forceHost) {
      this.setData({ isHost: false, isWaiting: true });
      this._startStatePolling();
      return;
    }

    this._bootstrapAsHostOrWait(roomId, { forceHost: !!forceHost });
  },

  async _bootstrapAsHostOrWait(roomId, options = {}) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        return;
      }

      const isHost = result.isHost === true;
      if (!isHost) {
        this.setData({ isHost: false, isWaiting: true });
        // 非房主进入抽首位页时，统一进副屏等待
        openSubAwait(roomId, 'player');
        return;
      }

      const selectedModeId = result.selectedModeId || '';
      if (selectedModeId === 'partner') {
        getApp().globalData.gameMode = 'partner';
      }
      const update = {
        isHost: true,
        isWaiting: false,
        selectedModeId
      };
      if (result.members && result.members.length) {
        update.members = result.members;
        update.minPlayers = result.members.length;
      }
      this.setData(update);
      this._updateRoomState('selectPlayer');
    } catch (e) {
      console.warn('selectPlayer bootstrap', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onShow() {
    if (this.data.isWaiting && !this.data.isHost) {
      this._startStatePolling();
    }
  },

  onHide() {
    this._stopStatePolling();
  },

  onUnload() {
    this._stopStatePolling();
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this._clearLongPressTimer();
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return false;
    try {
      const data = { roomId, currentPage, skipArchive: true };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      const res = await wx.cloud.callFunction({
        name: 'updateRoomState',
        data
      });
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('updateRoomState', e);
      return false;
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || getApp().globalData.roomId || '',
      intervalMs: 2000,
      followNavigation: false,
      onSnapshot(snapshot) {
        if (!snapshot || !snapshot.ok || !snapshot.raw || !snapshot.raw.roomState) return;
        const roomId = this.data.roomId || getApp().globalData.roomId || '';
        const page = (snapshot.raw.roomState.currentPage || '').toLowerCase();
        navigateByRoomState(page, snapshot.raw.roomState, roomId);
      }
    }).catch((e) => console.warn('selectPlayer roomSession', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
  },

  async loadMembers(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        const selectedModeId = result.selectedModeId || '';
        if (selectedModeId === 'partner') {
          getApp().globalData.gameMode = 'partner';
        }
        const update = { selectedModeId };
        if (result.members && result.members.length) {
          update.members = result.members;
          update.minPlayers = result.members.length;
        }
        this.setData(update);
      }
    } catch (e) {
      console.warn('loadMembers', e);
    }
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

  // 触摸移动（选中后不处理）
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

  // 触摸结束（选中后不处理，水波纹不会因手指离开而停止）
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
    const minPlayers = this.data.minPlayers || 0;
    this.setData({
      playerCount: count
    });

    if (minPlayers > 0 && count >= minPlayers && !this.data.isSelecting) {
      this._startLongPressTimer();
    } else {
      this._clearLongPressTimer();
    }
  },

  /** 长按 0.05 秒后开始倒计时+随机选择（总等待约 0.5s） */
  _startLongPressTimer() {
    if (this._longPressTimer) return;
    this._longPressTimer = setTimeout(() => {
      this._longPressTimer = null;
      if (this.data.activeTouches.length >= this.data.minPlayers && !this.data.isSelecting) {
        this.startSelection();
      }
    }, 50);
  },

  _clearLongPressTimer() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  },

  // 开始选择玩家
  startSelection() {
    if (this.data.isSelecting) return;
    
    this.setData({
      isSelecting: true
    });
    
    // 启动倒计时（0.5s）
    this.startCountdown();
    
    // 0.5 秒后随机选择
    this.selectionTimer = setTimeout(() => {
      this.selectRandomPlayer();
    }, 500);
  },

  // 启动倒计时（0.5s：显示 1 然后 0）
  startCountdown() {
    let countdown = 1;
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

  // 随机选择玩家：被选中的位置播放水波纹；结束后显示几号玩家被选中 + 确认按钮
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

    const SELECTION_ANIMATION_DURATION = 250;
    if (selectedPosition) {
      this.animationDoneTimer = setTimeout(() => {
        this.setData({ selectionAnimationDone: true });
      }, SELECTION_ANIMATION_DURATION);
    }
  },

  _isPartnerMode() {
    const app = getApp();
    const gd = app.globalData || {};
    return gd.gameMode === 'partner'
      || this.data.selectedModeId === 'partner'
      || (gd.selectedMode && gd.selectedMode.id === 'partner');
  },

  /** 跳过：partner 模式直接进入「选择首位出牌玩家」页；其他模式随机后进入 gamepage */
  handleSkip() {
    if (this.data.selectedPlayerIndex) return;
    const { members, roomId } = this.data;
    const resolvedRoomId = roomId || getApp().globalData.roomId || '';

    if (this._isPartnerMode()) {
      getApp().globalData.selectedPlayer = {};
      this._updateRoomState('confirmFirstPlayer');
      wx.redirectTo({
        url: `/pages/main-pages/partnerMode/confirmFirstPlayer/index?roomId=${encodeURIComponent(resolvedRoomId)}`
      });
      return;
    }

    let currentPlayerIndex = 1;
    if (members && members.length > 0) {
      const mIndex = Math.floor(Math.random() * members.length);
      currentPlayerIndex = members[mIndex].playerIndex;
    }
    getApp().globalData.selectedPlayer = { currentPlayerIndex };
    this.setData({
      selectedPlayerIndex: currentPlayerIndex,
      selectedPosition: null,
      selectionAnimationDone: true,
      isSelecting: false
    });
    this.navigateToGamepage(resolvedRoomId, currentPlayerIndex);
  },

  confirmSelection() {
    const { selectedPlayerIndex, roomId } = this.data;
    if (selectedPlayerIndex == null) return;
    if (this._isPartnerMode()) {
      this.navigateToConfirmFirstPlayer(roomId, selectedPlayerIndex);
    } else {
      this.navigateToGamepage(roomId, selectedPlayerIndex);
    }
  },

  reselectSelection() {
    this._clearLongPressTimer();
    if (this.animationDoneTimer) {
      clearTimeout(this.animationDoneTimer);
      this.animationDoneTimer = null;
    }
    this.setData({
      activeTouches: [],
      playerCount: 0,
      countdown: 0,
      selectedTouchId: null,
      selectedPlayerIndex: null,
      selectedPosition: null,
      selectionAnimationDone: false,
      isSelecting: false
    });
  },

  async navigateToConfirmFirstPlayer(roomId, currentPlayerIndex) {
    if (!roomId) {
      roomId = getApp().globalData.roomId || '';
    }
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }
    if (this._navPending) return;
    this._navPending = true;
    const members = this.data.members || [];
    const current = members.find((m) => m.playerIndex === currentPlayerIndex);
    const currentPlayerName = current
      ? (current.nickName || `玩家${currentPlayerIndex}`)
      : `玩家${currentPlayerIndex}`;
    getApp().globalData.selectedPlayer = {
      currentPlayerIndex,
      currentPlayerName
    };
    try {
      const ok = await this._updateRoomState('confirmFirstPlayer', currentPlayerIndex, currentPlayerName);
      if (!ok) {
        wx.showToast({ title: '同步房间失败，请重试', icon: 'none' });
        return;
      }
      wx.redirectTo({
        url: `/pages/main-pages/partnerMode/confirmFirstPlayer/index?roomId=${encodeURIComponent(roomId)}`
      });
    } finally {
      this._navPending = false;
    }
  },

  async navigateToGamepage(roomId, currentPlayerIndex) {
    if (!roomId) {
      roomId = getApp().globalData.roomId || '';
    }
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }
    if (this._navPending) return;
    this._navPending = true;
    const members = this.data.members || [];
    const current = members.find(m => m.playerIndex === currentPlayerIndex);
    const currentPlayerName = current ? (current.nickName || `玩家${currentPlayerIndex}`) : `玩家${currentPlayerIndex}`;
    try {
      const ok = await this._updateRoomState('gamepage', currentPlayerIndex, currentPlayerName);
      if (!ok) {
        wx.showToast({ title: '同步房间失败，请重试', icon: 'none' });
        return;
      }
      wx.redirectTo({
        url: `/pages/main-pages/halliGalli/gamepage/index?roomId=${encodeURIComponent(roomId)}&currentPlayerIndex=${currentPlayerIndex}`
      });
    } finally {
      this._navPending = false;
    }
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
    const roomId = this.data.roomId || '';
    const modeId = this.data.selectedModeId || 'partner';
    let fallbackUrl = '/pages/main-pages/brainstormMode/index';
    if (modeId === 'partner') {
      fallbackUrl = roomId
        ? `/pages/main-pages/selectProblem/index?roomId=${encodeURIComponent(roomId)}`
        : '/pages/main-pages/selectProblem/index';
    } else if (modeId === 'halliGalli') {
      fallbackUrl = roomId
        ? `/pages/main-pages/modeIndex/index?roomId=${encodeURIComponent(roomId)}&modeId=halliGalli`
        : '/pages/main-pages/modeIndex/index?modeId=halliGalli';
    } else if (roomId) {
      fallbackUrl = `/pages/main-pages/brainstormMode/index?roomId=${encodeURIComponent(roomId)}`;
    }
    safeNavigateBack({
      expectedPrev: [
        'pages/main-pages/selectProblem/index',
        'pages/main-pages/modeIndex/index',
        'pages/main-pages/selectMode/index'
      ],
      fallbackUrl
    });
  }
});

