const {
  callCloudFunction,
  goRoomPage,
  buildSpyPageUrl,
  openUrl,
  withSpyRefreshGuard
} = require('../../../../utils/spyMode');
const { followSpyRoomState } = require('../../../../utils/spyFollow');

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
    this._pollTimer = setInterval(() => this.refresh(), 800);
  },

  onHide() {
    this._pageAlive = false;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  onUnload() {
    this._pageAlive = false;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  async refresh() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    await withSpyRefreshGuard(this, async () => {
      try {
        const res = await callCloudFunction('getAddPlayerData', { roomId });
        const result = (res && res.result) || {};
        if (!this._pageAlive || result.ok !== true) return;
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
    goRoomPage(this.data.roomId);
  }
});
