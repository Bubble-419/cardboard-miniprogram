Page({
  data: {
    roomId: '',
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    avatarList: [],
    members: [],
    isHost: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10) : 1;
    const currentPlayerName = (options && options.currentPlayerName)
      ? decodeURIComponent(options.currentPlayerName) : `玩家${currentPlayerIndex}`;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({ roomId, currentPlayerIndex, currentPlayerName });
    this.loadRoomData(roomId);
  },

  async loadRoomData(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.members || !result.members.length) return;

      const members = result.members;
      const avatarList = members.map(m => ({
        id: m.playerIndex,
        avatar: m.avatarUrl || ''
      }));
      const isHost = result.isHost === true;

      this.setData({ members, avatarList, isHost });
    } catch (e) {
      console.warn('loadRoomData', e);
    }
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/main-pages/addPlayer/index' });
      }
    });
  },

  /** 房主点击「继续游戏」：进入下一玩家出牌（与表态页「全部通过」一致） */
  async handleContinue() {
    if (!this.data.isHost) return;
    const { roomId, members, currentPlayerIndex } = this.data;
    if (!roomId || !members || !members.length) return;

    const count = members.length;
    const nextIndex = (currentPlayerIndex % count) + 1;
    const nextMember = members.find(m => m.playerIndex === nextIndex);
    const nextPlayerName = nextMember ? (nextMember.nickName || `玩家${nextIndex}`) : `玩家${nextIndex}`;
    const isCyclingBack = nextIndex === 1;

    try {
      await this._updateRoomState('gamepage', nextIndex, nextPlayerName, isCyclingBack);
    } catch (e) {
      console.warn('updateRoomState', e);
    }
    wx.redirectTo({
      url: `/pages/main-pages/gamepage/index?roomId=${encodeURIComponent(roomId)}&currentPlayerIndex=${nextIndex}`
    });
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName, incrementRound) {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    const data = { roomId, currentPage };
    if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
    if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
    if (incrementRound === true) data.incrementRound = true;
    await wx.cloud.callFunction({
      name: 'updateRoomState',
      data
    });
  }
});
