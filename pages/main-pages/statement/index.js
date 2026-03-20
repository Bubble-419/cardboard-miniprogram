Page({
  data: {
    roomId: '',
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    memberCount: 0,
    members: [],
    isWaiting: false, // 普通玩家等待：请用实体表态卡进行表态
    selectedPassCount: null
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10) : 1;
    const currentPlayerName = (options && options.currentPlayerName) ?
      decodeURIComponent(options.currentPlayerName) : `玩家${currentPlayerIndex}`;
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({
      roomId,
      currentPlayerIndex,
      currentPlayerName,
      isWaiting: !!isWaiting
    });

    if (isWaiting) {
      this._startStatePolling();
      return;
    }

    this.loadMemberCount(roomId);
    this._updateRoomState('statement', currentPlayerIndex, currentPlayerName);
  },

  onUnload() {
    this._stopStatePolling();
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName, incrementRound) {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    try {
      const data = { roomId, currentPage };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      if (incrementRound === true) data.incrementRound = true;
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data
      });
    } catch (e) {
      console.warn('updateRoomState', e);
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
        if (page === 'gamepage') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          wx.redirectTo({
            url: `/pages/main-pages/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`
          });
        } else if (page === 'playsuccess') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          wx.redirectTo({
            url: `/pages/main-pages/playSuccess/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isWaiting=1`
          });
        } else if (page === 'playfail') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          wx.redirectTo({
            url: `/pages/main-pages/playFail/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isWaiting=1`
          });
        } else if (page === 'discussion') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
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

  async loadMemberCount(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.members && result.members.length) {
        this.setData({ memberCount: result.members.length, members: result.members });
      }
    } catch (e) {
      console.warn('loadMemberCount', e);
    }
  },

  handleGoBack() {
    wx.navigateBack();
  },

  onStatementTap(e) {
    const passCountRaw = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.passcount;
    if (passCountRaw == null) return;
    const passCount = parseInt(passCountRaw, 10);
    if (!Number.isFinite(passCount)) return;
    this.setData({ selectedPassCount: passCount });
  },

  handleConfirm() {
    const passCount = this.data.selectedPassCount;
    if (passCount == null) {
      wx.showToast({ title: '请选择通过人数', icon: 'none' });
      return;
    }

    const { roomId, currentPlayerIndex, currentPlayerName, memberCount, members } = this.data;
    if (!roomId) return;

    const roomIdEnc = encodeURIComponent(roomId);
    const nameEnc = encodeURIComponent(currentPlayerName || `玩家${currentPlayerIndex}`);
    const total = memberCount || (members && members.length) || 0;
    const halfFloor = Math.floor(total / 2);

    // 通过人数大于半数：出牌成功空状态页；否则：出牌失败空状态页
    if (passCount > halfFloor) {
      this._updateRoomState('playSuccess', currentPlayerIndex, currentPlayerName);
      wx.redirectTo({
        url: `/pages/main-pages/playSuccess/index?roomId=${roomIdEnc}&currentPlayerIndex=${currentPlayerIndex}&currentPlayerName=${nameEnc}&passCount=${passCount}&memberCount=${total}`
      });
      return;
    }

    this._updateRoomState('playFail', currentPlayerIndex, currentPlayerName);
    wx.redirectTo({
      url: `/pages/main-pages/playFail/index?roomId=${roomIdEnc}&currentPlayerIndex=${currentPlayerIndex}&currentPlayerName=${nameEnc}&passCount=${passCount}&memberCount=${total}`
    });
  }
});
