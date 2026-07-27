const {
  callCloudFunction,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  buildSpyPageUrl,
  roleLabel,
  openUrl
} = require('../../../../utils/spyMode');
const { followSpyRoomState } = require('../../../../utils/spyFollow');

Page({
  data: {
    roomId: '',
    isHost: false,
    navbarPaddingTop: 44,
    avatarList: [],
    civilianWord: '',
    spyWord: '',
    overviewPlayers: [],
    myCard: null,
    revealed: false,
    memorized: false,
    starting: false
  },

  onLoad(options) {
    this._pageAlive = true;
    let navbarPaddingTop = 44;
    try {
      navbarPaddingTop = (wx.getSystemInfoSync().statusBarHeight || 0) + 16;
    } catch (e) {
      // ignore
    }
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    this.setData({ roomId, navbarPaddingTop });
  },

  onShow() {
    this._pageAlive = true;
    this.refresh();
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this._pageAlive = false;
    this.stopPolling();
  },

  startPolling() {
    this.stopPolling();
    this._pollTimer = setInterval(() => this.refresh(), this.data.isHost ? 2000 : 800);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
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
      const prevHost = this.data.isHost;
      this.setData({
        isHost,
        avatarList: buildAvatarList(result.members || [])
      });
      if (prevHost !== isHost) {
        this.startPolling();
      }

      if (isHost) {
        const overview = await callSpyAction('hostOverview', { roomId });
        if (overview.ok === true && this._pageAlive) {
          this.setData({
            civilianWord: overview.civilianWord || '',
            spyWord: overview.spyWord || '',
            overviewPlayers: (overview.players || []).map((p) => ({
              ...p,
              roleLabel: roleLabel(p.role)
            }))
          });
        }
      } else {
        if (!this.data.myCard) {
          const cardRes = await callSpyAction('getMyCard', { roomId });
          if (cardRes.ok === true && this._pageAlive) {
            this.setData({ myCard: cardRes.card });
          }
        }
        followSpyRoomState(result, roomId, { stayOnPage: 'spyassign' });
      }
    } catch (e) {
      console.warn('spy assign refresh', e);
    } finally {
      this._refreshing = false;
    }
  },

  onRevealCard() {
    if (this.data.isHost) return;
    this.setData({ revealed: true });
  },

  onMemorized() {
    if (!this.data.revealed) {
      wx.showToast({ title: '请先翻开卡片', icon: 'none' });
      return;
    }
    this.setData({ memorized: true });
  },

  async onStartSpeak() {
    if (!this.data.isHost || this.data.starting) return;
    this.setData({ starting: true });
    wx.showLoading({ title: '开始…' });
    try {
      const result = await callSpyAction('startSpeak', { roomId: this.data.roomId });
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '开始失败', icon: 'none' });
        this.setData({ starting: false });
        return;
      }
      openUrl(buildSpyPageUrl('speak', this.data.roomId), { immediate: true, noReLaunch: true });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.errMsg) || '开始失败', icon: 'none' });
      this.setData({ starting: false });
    }
  },

  handleGoBack() {
    openUrl(buildSpyPageUrl('intro', this.data.roomId), { immediate: true });
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
