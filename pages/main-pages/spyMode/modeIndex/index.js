const {
  callCloudFunction,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  filterPlayerMembers,
  parseIsHostOption,
  buildSpyPageUrl,
  getDefaultSpyCount,
  MIN_PLAYERS,
  openUrl
} = require('../../../../utils/spyMode');
const { followSpyRoomState } = require('../../../../utils/spyFollow');

Page({
  data: {
    roomId: '',
    isHost: false,
    navbarPaddingTop: 44,
    avatarList: [],
    playerAvatarList: [],
    playerCount: 0,
    minPlayers: MIN_PLAYERS,
    spyCountHint: '',
    canStart: false,
    hostStatusText: '等待主持人开始分配…',
    starting: false
  },

  onLoad(options) {
    this._pageAlive = true;
    let navbarPaddingTop = 44;
    try {
      const sys = wx.getSystemInfoSync();
      navbarPaddingTop = (sys.statusBarHeight || 0) + 16;
    } catch (e) {
      // ignore
    }

    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isHost = parseIsHostOption(options);
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    getApp().globalData.roomId = roomId;
    getApp().globalData.gameMode = 'spy';
    this.setData({ roomId, isHost, navbarPaddingTop, minPlayers: MIN_PLAYERS });
  },

  onReady() {
    this._readyOnce = true;
    this.refreshRoom();
  },

  onShow() {
    this._pageAlive = true;
    if (!this._readyOnce) return;
    this.refreshRoom();
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this._pageAlive = false;
    this.stopPolling();
  },

  async refreshRoom() {
    const roomId = this.data.roomId;
    if (!roomId || this._refreshing) return;
    this._refreshing = true;
    try {
      const res = await callCloudFunction('getAddPlayerData', { roomId });
      const result = (res && res.result) || {};
      if (!this._pageAlive || result.ok !== true) return;

      const isHost = result.isHost === true;
      const members = result.members || [];
      const players = filterPlayerMembers(members, { excludeHostSelf: isHost });
      const playerCount = players.length;
      const spyCount = getDefaultSpyCount(playerCount);

      this.setData({
        isHost,
        avatarList: buildAvatarList(members),
        playerAvatarList: buildAvatarList(players),
        playerCount,
        canStart: isHost && playerCount >= MIN_PLAYERS,
        spyCountHint: playerCount >= MIN_PLAYERS
          ? `当前 ${playerCount} 名参与者，本局将自动分配 ${spyCount} 名卧底`
          : `当前 ${playerCount} 名参与者，人数不足`,
        hostStatusText: '等待主持人开始分配…'
      });

      if (!isHost) {
        followSpyRoomState(result, roomId, { stayOnPage: 'spymodeindex' });
      }
    } catch (e) {
      console.warn('spy modeIndex refresh', e);
    } finally {
      this._refreshing = false;
    }
  },

  startPolling() {
    this.stopPolling();
    const interval = this.data.isHost ? 2000 : 800;
    this._pollTimer = setInterval(() => {
      this.refreshRoom();
    }, interval);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  async onStartAssign() {
    if (!this.data.isHost || !this.data.canStart || this.data.starting) return;
    this.setData({ starting: true });
    wx.showLoading({ title: '分配中…' });
    try {
      const result = await callSpyAction('startAssign', { roomId: this.data.roomId });
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '分配失败', icon: 'none' });
        this.setData({ starting: false });
        return;
      }
      openUrl(buildSpyPageUrl('assign', this.data.roomId), { immediate: true, noReLaunch: true });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.errMsg) || '分配失败', icon: 'none' });
    } finally {
      if (this._pageAlive) this.setData({ starting: false });
    }
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({
          url: `/pages/main-pages/brainstormMode/index?roomId=${encodeURIComponent(this.data.roomId)}&isHost=${this.data.isHost ? 1 : 0}`
        });
      }
    });
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
