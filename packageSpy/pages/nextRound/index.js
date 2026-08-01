const {
  fetchRoomDataOrExit,
  callSpyAction,
  goRoomPage,
  buildSpyPageUrl,
  openUrl,
  withSpyRefreshGuard
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
    this._pollTimer = setInterval(() => this.refresh(), 1000);
  },

  onHide() {
    this._pageAlive = false;
    if (this._pollTimer) clearInterval(this._pollTimer);
  },

  onUnload() {
    this._pageAlive = false;
    if (this._pollTimer) clearInterval(this._pollTimer);
  },

  async refresh() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    await withSpyRefreshGuard(this, async () => {
      try {
        const result = await fetchRoomDataOrExit(roomId);
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
    if (typeof this.stopPolling === 'function') this.stopPolling();
    goRoomPage(this.data.roomId);
  }
});
