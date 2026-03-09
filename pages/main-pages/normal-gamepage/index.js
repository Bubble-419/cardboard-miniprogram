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
    this._startStatePolling();
  },

  onUnload() {
    this._stopStatePolling();
  },

  onShow() {
    const { roomId, currentPlayerIndex } = this.data;
    if (roomId && currentPlayerIndex != null) {
      this.refreshScoreCount(roomId, currentPlayerIndex);
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        if (result.ok !== true || !result.roomState) return;
        const page = (result.roomState.currentPage || '').toLowerCase();
        const roomIdEnc = encodeURIComponent(roomId);
        if (page === 'statement') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          wx.redirectTo({
            url: `/pages/main-pages/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isWaiting=1`
          });
        } else if (page === 'leaderboard') {
          wx.redirectTo({ url: `/pages/Leaderboard/index?roomId=${roomIdEnc}` });
        }
      } catch (e) {
        console.warn('state poll', e);
      }
    };
    this._statePollTimer = setInterval(poll, 2000);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
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
        this.setData({ scoredCount: result.scoredCount });
      }
    } catch (e) {
      console.warn('refreshScoreCount', e);
    }
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
      } else {
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
      }
    } catch (e) {
      console.error('submitGameScore', e);
      wx.showToast({ title: '提交失败', icon: 'none' });
    }
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/main-pages/addPlayer/index' });
      }
    });
  }
});
