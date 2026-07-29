const {
  callCloudFunction,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  buildSpyPageUrl,
  openUrl,
  roleLabel,
  winnerLabel,
  withSpyRefreshGuard
} = require('../../../../utils/spyMode');
const { followSpyRoomState } = require('../../../../utils/spyFollow');

Page({
  data: {
    roomId: '',
    navbarPaddingTop: 44,
    avatarList: [],
    winnerSide: '',
    winnerText: '',
    civilianWord: '',
    spyWord: '',
    revealPlayers: [],
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
    this.stopPolling();
    this._pollTimer = setInterval(() => {
      if (this._pageAlive === false) return;
      this.refresh();
    }, 1500);
  },

  stopPolling() {
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

        followSpyRoomState(result, roomId, {
          stayOnPage: 'spysettle',
          allowHost: true
        });

        const spyGame = (result.roomState && result.roomState.spyGame) || {};
        const winnerSide = spyGame.winnerSide || '';
        let revealPlayers = [];
        if (Array.isArray(spyGame.reveal) && spyGame.reveal.length) {
          revealPlayers = spyGame.reveal.map((p) => ({
            ...p,
            roleLabel: roleLabel(p.role)
          }));
        } else if (Array.isArray(spyGame.lastResult && spyGame.lastResult.reveal)) {
          revealPlayers = spyGame.lastResult.reveal.map((p) => ({
            ...p,
            roleLabel: roleLabel(p.role)
          }));
        }

        this.setData({
          avatarList: buildAvatarList(result.members || []),
          winnerSide,
          winnerText: winnerLabel(winnerSide) || '本局结束',
          civilianWord: spyGame.civilianWord || '',
          spyWord: spyGame.spyWord || '',
          revealPlayers
        });
      } catch (e) {
        console.warn('spy settle refresh', e);
      }
    });
  },

  async onRestart() {
    if (this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('restart', { roomId: this.data.roomId });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      const navigated = openUrl(buildSpyPageUrl('intro', this.data.roomId), {
        immediate: true,
        noReLaunch: true
      });
      if (!navigated && this._pageAlive) {
        this.setData({ acting: false });
      }
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
