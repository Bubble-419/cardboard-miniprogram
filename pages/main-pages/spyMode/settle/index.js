const {
  callCloudFunction,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  buildSpyPageUrl,
  openUrl,
  roleLabel,
  winnerLabel
} = require('../../../../utils/spyMode');
const { followSpyRoomState } = require('../../../../utils/spyFollow');

Page({
  data: {
    roomId: '',
    isHost: false,
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
      } else if (isHost) {
        const overview = await callSpyAction('hostOverview', { roomId });
        if (overview.ok) {
          revealPlayers = (overview.players || []).map((p) => ({
            ...p,
            roleLabel: roleLabel(p.role)
          }));
        }
      }

      this.setData({
        isHost,
        avatarList: buildAvatarList(result.members || []),
        winnerSide,
        winnerText: winnerLabel(winnerSide) || '本局结束',
        civilianWord: spyGame.civilianWord || '',
        spyWord: spyGame.spyWord || '',
        revealPlayers
      });

      if (!isHost) {
        followSpyRoomState(result, roomId, { stayOnPage: 'spysettle' });
      }
    } catch (e) {
      console.warn('spy settle refresh', e);
    } finally {
      this._refreshing = false;
    }
  },

  async onRestart() {
    if (!this.data.isHost || this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('restart', { roomId: this.data.roomId });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      openUrl(buildSpyPageUrl('intro', this.data.roomId), { immediate: true, noReLaunch: true });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
