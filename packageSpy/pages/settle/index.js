const {
  fetchRoomDataOrExit,
  callSpyAction,
  captureSpyCommandContext,
  goRoomPage,
  buildAvatarList,
  roleLabel,
  winnerLabel,
  withSpyRefreshGuard,
  startSpyRoomPoll,
  stopSpyRoomPoll,
  bumpSpyRoomSession
} = require('../../../utils/spyMode');
const {
  runPageInteraction,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');

Page(withPageInteractionLock({
  data: {
    roomId: '',
    avatarList: [],
    winnerSide: '',
    winnerText: '',
    civilianWord: '',
    spyWord: '',
    revealPlayers: [],
    isHost: false,
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
    startSpyRoomPoll(this, {
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

        const spyGame = (result.roomState && result.roomState.spyGame) || {};
        const nextCommandContext = spyGame.phase === 'settle'
          ? captureSpyCommandContext(result)
          : null;
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
          isHost: result.isHost === true,
          winnerSide,
          winnerText: winnerLabel(winnerSide) || '本局结束',
          civilianWord: spyGame.civilianWord || '',
          spyWord: spyGame.spyWord || '',
          revealPlayers
        }, () => {
          if (nextCommandContext) this._spyCommandContext = nextCommandContext;
        });
      } catch (e) {
        console.warn('spy settle refresh', e);
      }
    });
  },

  onRestart() {
    return runPageInteraction(this, () => this._restart(), {
      loadingText: '正在准备新一局…'
    });
  },

  async _restart() {
    if (this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('restart', {
        roomId: this.data.roomId,
        context: this._spyCommandContext
      });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      bumpSpyRoomSession();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  onFinishSession() {
    return runPageInteraction(this, () => this._finishSession(), {
      loadingText: '正在结束本次游戏…'
    });
  },

  async _finishSession() {
    if (this.data.acting || !this.data.isHost) return;
    this.setData({ acting: true });
    try {
      const completed = await callSpyAction('complete', {
        roomId: this.data.roomId,
        context: this._spyCommandContext
      });
      if (!completed || completed.ok !== true) {
        wx.showToast({ title: completed && completed.errMsg || '结束失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      const returned = await callSpyAction('returnToLobby', {
        roomId: this.data.roomId,
        context: this._spyCommandContext
      });
      if (!returned || returned.ok !== true) {
        wx.showToast({ title: returned && returned.errMsg || '返回房间失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      this._pageAlive = false;
      this.stopPolling();
      await goRoomPage(this.data.roomId);
    } catch (e) {
      wx.showToast({ title: e && (e.errMsg || e.message) || '结束失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    return runPageInteraction(this, async () => {
      this._pageAlive = false;
      if (typeof this.stopPolling === 'function') this.stopPolling();
      await goRoomPage(this.data.roomId);
    }, { loadingText: '正在返回房间…' });
  }
}, ['onRestart', 'onFinishSession', 'handleGoRoom']));
