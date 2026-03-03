Page({
  data: {
    roomId: '',
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    memberCount: 0
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10) : 1;
    const currentPlayerName = (options && options.currentPlayerName) || `玩家${currentPlayerIndex}`;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({
      roomId,
      currentPlayerIndex,
      currentPlayerName
    });

    this.loadMemberCount(roomId);
  },

  async loadMemberCount(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.members && result.members.length) {
        this.setData({ memberCount: result.members.length });
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

    const { roomId, currentPlayerIndex, memberCount } = this.data;
    if (!roomId) return;

    const count = memberCount || 1;
    const nextIndex = (currentPlayerIndex % count) + 1;

    wx.navigateTo({
      url: `/pages/main-pages/gamepage/index?roomId=${roomId}&currentPlayerIndex=${nextIndex}`
    });
  }
});
