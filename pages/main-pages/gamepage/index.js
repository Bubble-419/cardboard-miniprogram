Page({
    data: {
    navbarPaddingTop: 0,
    contentOffsetTop: 44,
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
    // 打分功能下线后，房主可直接开始表态
    canStartVote: true,
    isSubmittingScore: false,
    imageError: false,
    isHost: false,
    // 规则图：jpg 兼容性好，体验版可正常显示
    bgImageSrc: '/assets/icons/bg.jpg'
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

    // 真机 iOS 顶部留白与模拟器不一致，微信可能已预留安全区，用较小值
    let navbarPaddingTop = 0;
    try {
      const sys = wx.getSystemInfoSync();
      const h = sys.statusBarHeight || 0;
      if (sys.platform === 'ios') {
        // 真机 env(safe-area) 易偏大，用 statusBarHeight 并再减 36 控制留白
        navbarPaddingTop = Math.max(6, h - 36);
      } else {
        navbarPaddingTop = h;
      }
    } catch (e) {
      console.warn('getSystemInfo for navbar', e);
    }

    // 固定 60px，实测合适且不遮挡；iOS/Android 保持一致
    const contentOffsetTop = 60;
    this.setData({
      roomId,
      currentPlayerIndex,
      scoredCount: 0,
      myScore: null,
      navbarPaddingTop,
      contentOffsetTop
    });

    // 打分功能临时下线：保留原调用，后续恢复时可直接启用
    // this._startScorePolling();
    // this._loadAndRefresh(roomId, currentPlayerIndex);
    this.loadRoomData(roomId);
  },

  onUnload() {
    // 打分功能临时下线：保留原调用
    // this._stopScorePolling();
    this._stopStatePolling();
  },

  onShow() {
    // 打分功能临时下线：保留原逻辑，后续恢复时可直接启用
    // const { roomId, currentPlayerIndex } = this.data;
    // if (roomId && currentPlayerIndex != null) {
    //   this.refreshScoreCount(roomId, currentPlayerIndex);
    // }
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
    // 打分功能临时下线：保留原调用
    // await this.refreshScoreCount(roomId, currentPlayerIndex);
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
      const { assignAvatarImages } = require('../../../utils/avatars');
      const enriched = assignAvatarImages(members);
      const totalRequired = Math.max(0, members.length - 1);
      const avatarList = enriched.map(m => ({
        id: m.playerIndex,
        avatar: m.avatarImage || m.avatarUrl || '',
        nickName: m.nickName,
        isMe: m.isMe
      }));

      const current = members.find(m => m.playerIndex === this.data.currentPlayerIndex);
      const currentPlayerName = current ? (current.nickName || `玩家${this.data.currentPlayerIndex}`) : `玩家${this.data.currentPlayerIndex}`;
      const me = members.find(m => m.isMe);
      const myPlayerIndex = me ? me.playerIndex : null;
      const isMyScoringTurn = myPlayerIndex != null && this.data.currentPlayerIndex === myPlayerIndex;
      const isHost = result.isHost === true;

      this.setData({
        members,
        avatarList,
        totalRequired,
        currentPlayerName,
        myPlayerIndex,
        isMyScoringTurn,
        isHost
      });

      this.updateCanStartVote();
      this._updateRoomState('gamepage', this.data.currentPlayerIndex, currentPlayerName);

      if (!result.isHost) {
        this._startStatePolling();
      } else {
        this._stopStatePolling();
      }
    } catch (e) {
      console.error('loadRoomData', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  /** 非房主：轮询房间状态，房主点击「开始表态」等时跟随跳转 */
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
        const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
        const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
        if (page === 'statement') {
          wx.redirectTo({
            url: `/pages/main-pages/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isWaiting=1`
          });
        } else if (page === 'discussion') {
          wx.redirectTo({
            url: `/pages/main-pages/discussion/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}`
          });
        } else if (page === 'creativeinput') {
          wx.redirectTo({ url: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}` });
        } else if (page === 'creativesummary') {
          wx.redirectTo({ url: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}` });
        // 排行榜流程临时下线，本次不使用
        // } else if (page === 'leaderboard') {
        //   wx.redirectTo({ url: `/pages/leaderboard/index?roomId=${roomIdEnc}&isSubScreen=1` });
        }
      } catch (e) {
        console.warn('gamepage state poll', e);
      }
    };
    this._statePollTimer = setInterval(poll, 1500);
    poll();
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
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
    // 打分功能临时下线：保留原逻辑，先固定为可开始表态
    // const { scoredCount, totalRequired, members } = this.data;
    // const requiredScores = members.length ? Math.max(0, members.length - 1) : totalRequired;
    // const canStartVote = requiredScores === 0 || scoredCount >= requiredScores;
    this.setData({ canStartVote: true });
  },

  onImageError() {
    this.setData({ imageError: true });
  },

  /** 规则图加载失败时尝试相对路径 */
  onBgImageError() {
    if (this.data.bgImageSrc.startsWith('/')) {
      this.setData({ bgImageSrc: '../../../assets/icons/bg.jpg' });
    }
  },

  async onScoreTap(e) {
    // 打分功能临时下线：保留原实现，后续可恢复
    // const score = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.score;
    // if (score == null) return;
    // if (this.data.isSubmittingScore) return;
    // if (this.data.isMyScoringTurn) return;
    // const { roomId, currentPlayerIndex } = this.data;
    // if (!roomId) return;
    // const numericScore = parseInt(score, 10);
    // this.setData({
    //   myScore: numericScore,
    //   isSubmittingScore: true
    // });
    // try {
    //   const res = await wx.cloud.callFunction({
    //     name: 'submitGameScore',
    //     data: {
    //       roomId,
    //       currentPlayerIndex,
    //       score: numericScore
    //     }
    //   });
    //   const result = (res && res.result) || {};
    //   if (result.ok === true) {
    //     if (result.scoredCount != null) {
    //       this.setData({
    //         scoredCount: result.scoredCount
    //       });
    //     }
    //     this.updateCanStartVote();
    //   } else {
    //     this.setData({
    //       myScore: null
    //     });
    //     wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
    //   }
    // } catch (e) {
    //   console.error('submitGameScore', e);
    //   this.setData({
    //     myScore: null
    //   });
    //   wx.showToast({ title: '提交失败', icon: 'none' });
    // } finally {
    //   this.setData({
    //     isSubmittingScore: false
    //   });
    // }
    return;
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
      success: async (res) => {
        if (!res.confirm) return;
        const roomId = this.data.roomId || getApp().globalData.roomId || '';
        // 排行榜流程临时下线，改为结束后填写创意
        const url = roomId
          ? `/pages/main-pages/creativeInput/index?roomId=${encodeURIComponent(roomId)}`
          : '/pages/auth/index';
        try {
          await this._updateRoomState('creativeInput');
        } catch (e) {
          console.warn('updateRoomState creativeInput', e);
        }
        wx.redirectTo({ url });
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
