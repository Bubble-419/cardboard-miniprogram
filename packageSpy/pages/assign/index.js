const {
  fetchRoomDataOrExit,
  goRoomPage,
  buildSpyPageUrl,
  openUrl,
  withSpyRefreshGuard,
  startSpyRoomPoll,
  stopSpyRoomPoll
} = require('../../../utils/spyMode');
const { followSpyRoomState } = require('../../../utils/spyFollow');

/** 旧分配页：兼容跳转，自动跟随到发言页 */
Page({
  data: {
    roomId: '',
    navbarPaddingTop: 44
  },

  onLoad(options) {
    this._pageAlive = true;
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    this.setData({ roomId });
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
      intervalMs: 800,
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
        const followed = followSpyRoomState(result, roomId, { allowHost: true });
        if (!followed) {
          openUrl(buildSpyPageUrl('speak', roomId), { immediate: true, noReLaunch: true });
        }
      } catch (e) {
        console.warn('spy assign redirect', e);
      }
    });
  },

  handleGoRoom() {
    this._pageAlive = false;
    this.stopPolling();
    goRoomPage(this.data.roomId);
  }
});
