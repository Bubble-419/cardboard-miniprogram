const {
  callCloudFunction,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  buildSpyPageUrl,
  openUrl,
  roleLabel
} = require('../../../../utils/spyMode');
const { followSpyRoomState } = require('../../../../utils/spyFollow');

Page({
  data: {
    roomId: '',
    isHost: false,
    navbarPaddingTop: 44,
    avatarList: [],
    round: 1,
    hasElimination: false,
    eliminatedName: '',
    eliminatedRole: '',
    eliminatedRoleLabel: '',
    maxVotes: 0,
    tied: false,
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
      const last = spyGame.lastResult || {};
      const eliminatedIndex = last.eliminatedIndex;
      this.setData({
        isHost,
        avatarList: buildAvatarList(result.members || []),
        round: spyGame.round || 1,
        hasElimination: eliminatedIndex != null,
        eliminatedName: last.eliminatedName || '',
        eliminatedRole: last.eliminatedRole || '',
        eliminatedRoleLabel: roleLabel(last.eliminatedRole),
        maxVotes: last.maxVotes || 0,
        tied: !!last.tied,
        alivePlayers: (spyGame.players || []).filter((p) => p.alive !== false)
      });

      if (!isHost) {
        followSpyRoomState(result, roomId, { stayOnPage: 'spyresult' });
      }
    } catch (e) {
      console.warn('spy result refresh', e);
    } finally {
      this._refreshing = false;
    }
  },

  async onNext() {
    if (!this.data.isHost || this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('enterNextRoundPage', { roomId: this.data.roomId });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '操作失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      openUrl(buildSpyPageUrl('nextRound', this.data.roomId), { immediate: true, noReLaunch: true });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
