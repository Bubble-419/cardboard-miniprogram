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
    canStartVote: false,
    isSubmittingScore: false,
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
      currentPlayerIndex,
      scoredCount: 0,
      myScore: null
    });

    this._startScorePolling();
    this._loadAndRefresh(roomId, currentPlayerIndex);
  },

  onUnload() {
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

      this.updateCanStartVote();
      this._updateRoomState('gamepage', this.data.currentPlayerIndex, currentPlayerName);
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
          this.updateCanStartVote();
        }
      }
    } catch (e) {
      console.warn('refreshScoreCount', e);
    }
  },

  updateCanStartVote() {
    const { scoredCount, totalRequired, members } = this.data;
    const requiredScores = members.length ? Math.max(0, members.length - 1) : totalRequired;
    const canStartVote = requiredScores === 0 || scoredCount >= requiredScores;
    this.setData({ canStartVote });
  },

  onImageError() {
    this.setData({ imageError: true });
  },

  async onScoreTap(e) {
    const score = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.score;
    if (score == null) return;
    if (this.data.isSubmittingScore) return;

    const { roomId, currentPlayerIndex } = this.data;
    if (!roomId) return;

    const numericScore = parseInt(score, 10);
    // 乐观更新：本地先高亮选中的分数，提升点击响应速度
    this.setData({
      myScore: numericScore,
      isSubmittingScore: true
    });

    try {
      const res = await wx.cloud.callFunction({
        name: 'submitGameScore',
        data: {
          roomId,
          currentPlayerIndex,
          score: numericScore
        }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        if (result.scoredCount != null) {
          this.setData({
            scoredCount: result.scoredCount
          });
        }
        this.updateCanStartVote();
      } else {
        // 提交失败还原本地状态
        this.setData({
          myScore: null
        });
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
      }
    } catch (e) {
      console.error('submitGameScore', e);
      this.setData({
        myScore: null
      });
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      this.setData({
        isSubmittingScore: false
      });
    }
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName) {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    try {
      const data = { roomId, currentPage };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data
      });
    } catch (e) {
      console.warn('updateRoomState', e);
    }
  },

  handleStartVote() {
    if (!this.data.canStartVote) return;
    const roomId = this.data.roomId || '';
    const currentPlayerIndex = this.data.currentPlayerIndex;
    const currentPlayerName = this.data.currentPlayerName || `玩家${currentPlayerIndex}`;
    this._updateRoomState('statement', currentPlayerIndex, currentPlayerName);
    wx.redirectTo({
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
          const roomId = this.data.roomId || getApp().globalData.roomId || '';
          this._updateRoomState('leaderboard');
          wx.redirectTo({
            url: roomId
              ? `/pages/leaderboard/index?roomId=${encodeURIComponent(roomId)}`
              : '/pages/auth/index'
          });
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
