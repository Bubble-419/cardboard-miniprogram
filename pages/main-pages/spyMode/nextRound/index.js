const {
  callCloudFunction,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  buildSpyPageUrl,
  openUrl
} = require('../../../../utils/spyMode');
const { followSpyRoomState } = require('../../../../utils/spyFollow');

Page({
  data: {
    roomId: '',
    isHost: false,
    navbarPaddingTop: 44,
    avatarList: [],
    alivePlayers: [],
    acting: false
  },

  onLoad(options) {
    this._pageAlive = true;
    let navbarPaddingTop = 44;
    try {
      navbarPaddingTop = (wx.getSystemInfoSync().statusBarHeight || 0) + 16;
    } catch (e) {
      // ignore
    }
    this.setData({
      roomId: (options && options.roomId) || getApp().globalData.roomId || '',
      navbarPaddingTop
    });
  },

  onShow() {
    this._pageAlive = true;
    this.refresh();
    this._pollTimer = setInterval(() => this.refresh(), this.data.isHost ? 2000 : 800);
  },

  onHide() {
    if (this._pollTimer) clearInterval(this._pollTimer);
  },

  onUnload() {
    this._pageAlive = false;
    if (this._pollTimer) clearInterval(this._pollTimer);
  },

  async refresh() {
    const roomId = this.data.roomId;
    if (!roomId || this._refreshing) return;
    this._refreshing = true;
    try {
      const res = await callCloudFunction('getAddPlayerData', { roomId });
      const result = (res && res.result) || {};
      if (!this._pageAlive || result.ok !== true) return;
      const isHost = result.isHost === true;
      const spyGame = (result.roomState && result.roomState.spyGame) || {};
      this.setData({
        isHost,
        avatarList: buildAvatarList(result.members || []),
        alivePlayers: (spyGame.players || []).filter((p) => p.alive !== false)
      });
      if (!isHost) {
        followSpyRoomState(result, roomId, { stayOnPage: 'spynextround' });
      }
    } catch (e) {
      console.warn('spy nextRound refresh', e);
    } finally {
      this._refreshing = false;
    }
  },

  async onStartNext() {
    if (!this.data.isHost || this.data.acting) return;
    this.setData({ acting: true });
    wx.showLoading({ title: '进入发言…' });
    try {
      const result = await callSpyAction('nextRound', { roomId: this.data.roomId });
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      openUrl(buildSpyPageUrl('speak', this.data.roomId), { immediate: true, noReLaunch: true });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.errMsg) || '失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
