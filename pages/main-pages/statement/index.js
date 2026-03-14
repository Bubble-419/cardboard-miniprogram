Page({
  data: {
    roomId: '',
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    memberCount: 0,
    members: [],
    isWaiting: false // 普通玩家等待：请用实体表态卡进行表态
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
        } else if (page === 'discussion') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          wx.redirectTo({
            url: `/pages/main-pages/discussion/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}`
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
    const type = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type;
    if (!type) return;

    const { roomId, currentPlayerIndex, currentPlayerName, memberCount, members } = this.data;
    if (!roomId) return;

    const roomIdEnc = encodeURIComponent(roomId);
    const nameEnc = encodeURIComponent(currentPlayerName || `玩家${currentPlayerIndex}`);

    if (type === 'partial_pass' || type === 'all_question') {
      this._updateRoomState('discussion', currentPlayerIndex, currentPlayerName);
      wx.redirectTo({
        url: `/pages/main-pages/discussion/index?roomId=${roomIdEnc}&currentPlayerIndex=${currentPlayerIndex}&currentPlayerName=${nameEnc}`
      });
      return;
    }

    const count = memberCount || 1;
    const nextIndex = (currentPlayerIndex % count) + 1;
    const nextMember = (members || []).find(m => m.playerIndex === nextIndex);
    const nextPlayerName = nextMember ? (nextMember.nickName || `玩家${nextIndex}`) : `玩家${nextIndex}`;
    const isCyclingBack = nextIndex === 1;

    this._updateRoomState('gamepage', nextIndex, nextPlayerName, isCyclingBack);
    wx.redirectTo({
      url: `/pages/main-pages/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${nextIndex}`
    });
  }
});
