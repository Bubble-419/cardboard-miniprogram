Page({
  data: {
    countdown: 5
  },

  onLoad(options) {
    const roomId = options.roomId || getApp().globalData.roomId || '';
    if (roomId) getApp().globalData.roomId = roomId;
    this.setData({ roomId });
    this.startCountdown();
    this.startStateCheck();
  },

  onShow() {
    this.checkRoomState();
  },

  onUnload() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.stateCheckTimer) clearInterval(this.stateCheckTimer);
  },

  startCountdown() {
    this.countdownTimer = setInterval(() => {
      const count = this.data.countdown > 0 ? this.data.countdown - 1 : 5;
      this.setData({ countdown: count || 5 });
    }, 1000);
  },

  checkRoomState() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    wx.cloud.callFunction({
      name: 'getAddPlayerData',
      data: { roomId }
    }).then((res) => {
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.roomState) return;
      const page = (result.roomState.currentPage || '').toLowerCase();
      const roomIdEnc = encodeURIComponent(roomId);
      if (page === 'selectmode') {
        wx.redirectTo({ url: `/pages/sub-pages/awaitMode/index?roomId=${roomIdEnc}` });
      } else if (page === 'selectplayer') {
        wx.redirectTo({ url: `/pages/sub-pages/awaitPlayer/index?roomId=${roomIdEnc}` });
      } else if (page === 'gamepage') {
        const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
        wx.redirectTo({ url: `/pages/main-pages/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}` });
      } else if (page === 'statement') {
        const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
        const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
        wx.redirectTo({ url: `/pages/main-pages/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isSubScreen=1` });
      } else if (page === 'leaderboard') {
        wx.redirectTo({ url: `/pages/leaderboard/index?roomId=${roomIdEnc}&isSubScreen=1` });
      }
    }).catch((e) => console.warn('checkRoomState', e));
  },

  startStateCheck() {
    if (this.stateCheckTimer) clearInterval(this.stateCheckTimer);
    this.checkRoomState();
    this.stateCheckTimer = setInterval(() => this.checkRoomState(), 1500);
  }
});
