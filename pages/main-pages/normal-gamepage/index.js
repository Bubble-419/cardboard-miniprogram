Page({
  data: {
    roomId: '',
    members: [],
    avatarList: [],
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    myPlayerIndex: null,
    isMyScoringTurn: false,
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

    this._startStatePolling();
    this._startScorePolling();
    this._loadAndRefresh(roomId, currentPlayerIndex);
  },

  onUnload() {
    this._stopStatePolling();
    this._stopScorePolling();
  },

  onShow() {
    const { roomId, currentPlayerIndex } = this.data;
    if (roomId && currentPlayerIndex != null) {
      this.refreshScoreCount(roomId, currentPlayerIndex);
    }
  },

  _startScorePolling() {
    this._stopScorePolling();
    const poll = () => {
      const { roomId, currentPlayerIndex } = this.data;
      if (roomId && currentPlayerIndex != null) {
        this.refreshScoreCount(roomId, currentPlayerIndex);
      }
    };
    this._scorePollTimer = setInterval(poll, 1500);
  },

  _stopScorePolling() {
    if (this._scorePollTimer) {
      clearInterval(this._scorePollTimer);
      this._scorePollTimer = null;
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
          wx.redirectTo({ url: `/pages/leaderboard/index?roomId=${roomIdEnc}&isSubScreen=1` });
        }
      } catch (e) {
        console.warn('state poll', e);
      }
    };
    this._statePollTimer = setInterval(poll, 1000);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  async _loadAndRefresh(roomId, currentPlayerIndex) {
    await this.loadRoomData(roomId);
    await this.refreshScoreCount(roomId, currentPlayerIndex);
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
      const totalRequired = Math.max(0, members.length - 1);
      const avatarList = members.map(m => ({
        id: m.playerIndex,
        avatar: m.avatarUrl || ''
      }));

      const current = members.find(m => m.playerIndex === this.data.currentPlayerIndex);
      const currentPlayerName = current ? (current.nickName || `玩家${this.data.currentPlayerIndex}`) : `玩家${this.data.currentPlayerIndex}`;
      const me = members.find(m => m.isMe);
      const myPlayerIndex = me ? me.playerIndex : null;
      const isMyScoringTurn = myPlayerIndex != null && this.data.currentPlayerIndex === myPlayerIndex;

      this.setData({
        members,
        avatarList,
        totalRequired,
        currentPlayerName,
        myPlayerIndex,
        isMyScoringTurn
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
      if (result.ok === true) {
        const updates = {};
        if (result.scoredCount != null) updates.scoredCount = result.scoredCount;
        if (result.totalRequired != null) updates.totalRequired = result.totalRequired;
        if (Object.keys(updates).length) {
          this.setData(updates);
        }
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
    if (this.data.isMyScoringTurn) return;

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
