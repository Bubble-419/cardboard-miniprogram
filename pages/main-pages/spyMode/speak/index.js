const {
  callCloudFunction,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  buildSpyPageUrl,
  openUrl,
  SPEAK_ROUND_MS,
  startSpyCountdownTicker
} = require('../../../../utils/spyMode');
const { followSpyRoomState } = require('../../../../utils/spyFollow');

Page({
  data: {
    roomId: '',
    isHost: false,
    navbarPaddingTop: 44,
    avatarList: [],
    countdownText: '5:00',
    civilianWord: '',
    civilianBlurb: '',
    spyWord: '',
    spyBlurb: '',
    spyPlayers: [],
    myCard: null,
    cardRevealed: false,
    voteOpening: false,
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
    this.stopPolling();
    this.stopTicker();
  },

  onUnload() {
    this._pageAlive = false;
    this.stopPolling();
    this.stopTicker();
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

  stopTicker() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  },

  ensureTicker(startedAt, durationMs) {
    this._speakStartedAt = startedAt;
    this._speakDuration = durationMs || SPEAK_ROUND_MS;
    if (this._tickTimer) return;
    this._tickTimer = startSpyCountdownTicker(
      this,
      () => this._speakStartedAt,
      this._speakDuration
    );
  },

  onToggleCard() {
    if (this.data.isHost) return;
    if (!this.data.myCard) {
      wx.showToast({ title: '卡片加载中', icon: 'none' });
      return;
    }
    this.setData({ cardRevealed: !this.data.cardRevealed });
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
      const spyGame = result.roomState && result.roomState.spyGame;
      const members = result.members || [];
      this.setData({
        isHost,
        avatarList: buildAvatarList(members)
      });
      if (prevHost !== isHost) this.startPolling();

      if (!spyGame) {
        if (!isHost) followSpyRoomState(result, roomId, { stayOnPage: 'spyspeak' });
        return;
      }

      if (isHost) {
        const overview = await callSpyAction('hostOverview', { roomId });
        if (overview.ok && this._pageAlive) {
          const overviewPlayers = overview.players || [];
          this.setData({
            civilianWord: overview.civilianWord || '',
            civilianBlurb: overview.civilianBlurb || '',
            spyWord: overview.spyWord || '',
            spyBlurb: overview.spyBlurb || '',
            spyPlayers: overviewPlayers
              .filter((p) => p.role === 'spy')
              .map((p) => ({
                playerIndex: p.playerIndex,
                name: p.name,
                word: p.word
              }))
          });
        }
      }

      this.setData({
        civilianWord: spyGame.civilianWord || this.data.civilianWord,
        civilianBlurb: spyGame.civilianBlurb || this.data.civilianBlurb,
        spyWord: spyGame.spyWord || this.data.spyWord,
        spyBlurb: spyGame.spyBlurb || this.data.spyBlurb
      });

      this.ensureTicker(spyGame.speakRoundStartedAt, spyGame.speakRoundMs || SPEAK_ROUND_MS);

      if (!isHost) {
        if (!this.data.myCard) {
          const cardRes = await callSpyAction('getMyCard', { roomId });
          if (cardRes.ok && this._pageAlive) {
            this.setData({ myCard: cardRes.card });
          }
        }
        const page = (result.roomState.currentPage || '').toLowerCase();
        if (page === 'spyvote' || (spyGame.phase === 'vote')) {
          this.setData({ voteOpening: true });
        }
        followSpyRoomState(result, roomId, { stayOnPage: 'spyspeak' });
      }
    } catch (e) {
      console.warn('spy speak refresh', e);
    } finally {
      this._refreshing = false;
    }
  },

  async onStartVote() {
    if (!this.data.isHost || this.data.acting) return;
    this.setData({ acting: true });
    wx.showLoading({ title: '开启投票…' });
    try {
      const result = await callSpyAction('startVote', { roomId: this.data.roomId });
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '开启失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      openUrl(buildSpyPageUrl('vote', this.data.roomId), { immediate: true, noReLaunch: true });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.errMsg) || '开启失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
