Page({
  data: {
    roomId: '',
    members: [],
    avatarList: [],
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    myScore: null,
    scoredCount: 0,
    totalRequired: 0,
    canStartVote: false,
    imageError: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10) : 1;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({
      roomId,
      currentPlayerIndex
    });

    this.loadRoomData(roomId);
    this.refreshScoreCount(roomId, currentPlayerIndex);
  },

  onShow() {
    const { roomId, currentPlayerIndex } = this.data;
    if (roomId && currentPlayerIndex != null) {
      this.refreshScoreCount(roomId, currentPlayerIndex);
    }
  },

  async loadRoomData(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.members || !result.members.length) {
        wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        return;
      }

      const members = result.members;
      const totalRequired = members.length;
      const avatarList = members.map(m => ({
        id: m.playerIndex,
        avatar: m.avatarUrl || ''
      }));

      const current = members.find(m => m.playerIndex === this.data.currentPlayerIndex);
      const currentPlayerName = current ? (current.nickName || `玩家${this.data.currentPlayerIndex}`) : `玩家${this.data.currentPlayerIndex}`;

      this.setData({
        members,
        avatarList,
        totalRequired,
        currentPlayerName
      });

      this.updateCanStartVote();
    } catch (e) {
      console.error('loadRoomData', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async refreshScoreCount(roomId, currentPlayerIndex) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getGameScoreStatus',
        data: { roomId, currentPlayerIndex }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.scoredCount != null) {
        this.setData({
          scoredCount: result.scoredCount
        });
        this.updateCanStartVote();
      }
    } catch (e) {
      console.warn('refreshScoreCount', e);
    }
  },

  updateCanStartVote() {
    const { scoredCount, totalRequired, members } = this.data;
    const requiredScores = Math.max(0, (members.length || totalRequired) - 1);
    const canStartVote = requiredScores === 0 || scoredCount >= requiredScores;
    this.setData({ canStartVote });
  },

  onImageError() {
    this.setData({ imageError: true });
  },

  async onScoreTap(e) {
    const score = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.score;
    if (score == null) return;

    const { roomId, currentPlayerIndex } = this.data;
    if (!roomId) return;

    try {
      const res = await wx.cloud.callFunction({
        name: 'submitGameScore',
        data: {
          roomId,
          currentPlayerIndex,
          score: parseInt(score, 10)
        }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        this.setData({
          myScore: parseInt(score, 10),
          scoredCount: result.scoredCount != null ? result.scoredCount : this.data.scoredCount + 1
        });
        this.updateCanStartVote();
      } else {
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
      }
    } catch (e) {
      console.error('submitGameScore', e);
      wx.showToast({ title: '提交失败', icon: 'none' });
    }
  },

  handleStartVote() {
    if (!this.data.canStartVote) return;
    const roomId = this.data.roomId || '';
    const currentPlayerIndex = this.data.currentPlayerIndex;
    const currentPlayerName = this.data.currentPlayerName || `玩家${currentPlayerIndex}`;
    wx.navigateTo({
      url: `/pages/main-pages/statement/index?roomId=${encodeURIComponent(roomId)}&currentPlayerIndex=${currentPlayerIndex}&currentPlayerName=${encodeURIComponent(currentPlayerName)}`
    });
  },

  handleEndGame() {
    wx.showModal({
      title: '结束游戏',
      content: '是否结束全局游戏？',
      confirmText: '结束',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.showToast({ title: '已结束游戏', icon: 'none' });
          wx.reLaunch({ url: '/pages/auth/index' });
        }
      }
    });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/main-pages/addPlayer/index' });
      }
    });
  }
});
