const {
  fetchRoomDataOrExit,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  buildSpyPageUrl,
  openUrl,
  roleLabel,
  withSpyRefreshGuard
} = require('../../../utils/spyMode');
const { followSpyRoomState } = require('../../../utils/spyFollow');

Page({
  data: {
    roomId: '',
    avatarList: [],
    round: 1,
    hasElimination: false,
    eliminatedName: '',
    eliminatedRole: '',
    eliminatedRoleLabel: '',
    maxVotes: 0,
    tied: false,
    tallyList: [],
    alivePlayers: [],
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
    }, 1000);
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
        const result = await fetchRoomDataOrExit(roomId);
        if (!this._pageAlive || !result || result.ok !== true) return;

        followSpyRoomState(result, roomId, {
          stayOnPage: 'spyresult',
          allowHost: true
        });

        const spyGame = (result.roomState && result.roomState.spyGame) || {};
        const last = spyGame.lastResult || {};
        const eliminatedIndex = last.eliminatedIndex;
        const players = spyGame.players || [];
        const tallies = last.tallies || {};
        const tallyList = Object.keys(tallies)
          .map((key) => {
            const idx = Number(key);
            const p = players.find((x) => Number(x.playerIndex) === idx);
            return {
              playerIndex: idx,
              name: (p && p.name) || `玩家${idx}`,
              votes: Number(tallies[key]) || 0
            };
          })
          .sort((a, b) => b.votes - a.votes);

        this.setData({
          avatarList: buildAvatarList(result.members || []),
          round: spyGame.round || 1,
          hasElimination: eliminatedIndex != null,
          eliminatedName: last.eliminatedName || '',
          eliminatedRole: last.eliminatedRole || '',
          eliminatedRoleLabel: roleLabel(last.eliminatedRole),
          maxVotes: last.maxVotes || 0,
          tied: !!last.tied,
          tallyList,
          alivePlayers: players.filter((p) => p.alive !== false)
        });
      } catch (e) {
        console.warn('spy result refresh', e);
      }
    });
  },

  async onContinue() {
    if (this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('nextRound', { roomId: this.data.roomId });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '操作失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      const navigated = openUrl(buildSpyPageUrl('speak', this.data.roomId), {
        immediate: true,
        noReLaunch: true
      });
      if (!navigated && this._pageAlive) {
        this.setData({ acting: false });
      }
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    this._pageAlive = false;
    if (typeof this.stopPolling === 'function') this.stopPolling();
    goRoomPage(this.data.roomId);
  }
});
