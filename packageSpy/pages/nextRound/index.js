const {
  fetchRoomDataOrExit,
  callSpyAction,
  goRoomPage,
  buildSpyPageUrl,
  openUrl,
  withSpyRefreshGuard,
  startSpyRoomPoll,
  stopSpyRoomPoll,
  bumpSpyRoomSession
} = require('../../../utils/spyMode');
const { followSpyRoomState } = require('../../../utils/spyFollow');

/** 旧下一轮准备页：任意玩家可继续，或自动跟随 */
Page({
  data: {
    roomId: '',
    acting: false
  },

  onLoad(options) {
    this._pageAlive = true;
    this.setData({
      roomId: (options && options.roomId) || getApp().globalData.roomId || ''
    });
  },

  onShow() {
    this._pageAlive = true;
    this.refresh();
    this.startPolling();
  },

  onHide() {
    this._pageAlive = false;
    this.stopPolling();
  },

  onUnload() {
    this._pageAlive = false;
    this.stopPolling();
  },

  startPolling() {
    startSpyRoomPoll(this, {
      intervalMs: 1000,
      onPollResult: (result) => this.refresh(result)
    });
  },

  stopPolling() {
    stopSpyRoomPoll(this);
  },

  async refresh(prefetchedResult) {
    const roomId = this.data.roomId;
    if (!roomId) return;
    await withSpyRefreshGuard(this, async () => {
      try {
        const result = (prefetchedResult && prefetchedResult.ok === true)
          ? prefetchedResult
          : await fetchRoomDataOrExit(roomId);
        if (!this._pageAlive || !result || result.ok !== true) return;
        followSpyRoomState(result, roomId, { allowHost: true });
      } catch (e) {
        console.warn('spy nextRound refresh', e);
      }
    });
  },

  async onStartNext() {
    if (this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('nextRound', { roomId: this.data.roomId });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      bumpSpyRoomSession();
      openUrl(buildSpyPageUrl('speak', this.data.roomId), {
        immediate: true,
        noReLaunch: true
      });
    } catch (e) {
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    this._pageAlive = false;
    this.stopPolling();
    goRoomPage(this.data.roomId);
  }
});
