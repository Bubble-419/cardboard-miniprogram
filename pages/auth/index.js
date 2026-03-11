Page({
  data: {
    isHost: true,
    isWaiting: false // 普通玩家等待房主选择情境
  },

  onLoad(options) {
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);
    this.setData({ isWaiting: !!isWaiting });
    if (isWaiting) {
      this.setData({ isHost: false });
      this._startStatePolling();
      return;
    }
    this._fetchHostStatus();
  },

  onUnload() {
    this._stopStatePolling();
  },

  async _fetchHostStatus() {
    const roomId = getApp().globalData.roomId || '';
    if (!roomId) {
      this.setData({ isHost: true });
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        const isHost = result.isHost === true;
        this.setData({ isHost });
        if (isHost) {
          this._updateRoomState('auth');
        } else {
          this._startStatePolling();
        }
      } else {
        this.setData({ isHost: true });
      }
    } catch (e) {
      this.setData({ isHost: true });
    }
  },

  async _updateRoomState(currentPage) {
    const roomId = getApp().globalData.roomId || '';
    if (!roomId) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: { roomId, currentPage }
      });
    } catch (e) {
      console.warn('updateRoomState', e);
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = getApp().globalData.roomId || '';
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
        if (page === 'auth' || page === 'selectbg' || page === 'selectproblem') {
          wx.redirectTo({ url: `/pages/sub-pages/awaitBG/index?roomId=${roomIdEnc}` });
        } else if (page === 'selectmode') {
          wx.redirectTo({ url: `/pages/sub-pages/awaitMode/index?roomId=${roomIdEnc}` });
        } else if (page === 'selectplayer') {
          wx.redirectTo({ url: `/pages/sub-pages/awaitPlayer/index?roomId=${roomIdEnc}` });
        } else if (page === 'gamepage') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          wx.redirectTo({ url: `/pages/main-pages/normal-gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}` });
        } else if (page === 'statement') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          wx.redirectTo({ url: `/pages/main-pages/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isSubScreen=1` });
        } else if (page === 'leaderboard') {
          wx.redirectTo({ url: `/pages/leaderboard/index?roomId=${roomIdEnc}&isSubScreen=1` });
        }
      } catch (e) {
        console.warn('state poll', e);
      }
    };
    poll();
    this._statePollTimer = setInterval(poll, 1500);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  /**
   * 已设定情境：选择线下大屏上已展示的情境，直接进入游戏
   */
  selectPresetScenario() {
    if (!this.data.isHost) return;
    const roomId = getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息，请先创建房间', icon: 'none' });
      return;
    }
    this._updateRoomState('selectPlayer');
    wx.redirectTo({
      url: `/pages/main-pages/selectPlayer/index?roomId=${encodeURIComponent(roomId)}`
    });
  },

  /**
   * 自定义情境：自行选择情境卡（场景、用户、平台、功能）
   */
  selectCustomScenario() {
    if (!this.data.isHost) return;
    this._updateRoomState('selectBG');
    wx.redirectTo({
      url: '/pages/main-pages/selectBG/index'
    });
  },

  // 跳转到灵感空间
  goToInspiration() {
    wx.navigateTo({
      url: '/pages/inspiration/index'
    });
  }
});
