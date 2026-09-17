const { buildGamepageUrl, buildLeaderboardUrl } = require('../../../../utils/modeRoutes');
const { openUrl } = require('../../../../utils/pageNavigate');
const {
  bindPageToRoomSession,
  unbindPageFromRoomSession,
  dispatchRoomCommand,
  followRoomRouteAfterCommand,
  getRoomPageSnapshot
} = require('../../../../modules/room-session/index');
const { runPageInteraction, withPageInteractionLock } = require('../../../../utils/pageInteractionLock');

Page(withPageInteractionLock({
  data: {
    roomId: '',
    sessionId: '',
    hasVoted: false,
    isInitiator: false,
    isSubmitting: false,
    voteResult: '',
    closingVoteSessionId: '',
    closingVoteSeq: 0
  },

  onLoad(options) {
    const roomId = options && options.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    getApp().globalData.roomId = roomId;
    this.setData({ roomId });
    this._refreshVoteStatus();
    this._startStatePolling();
  },

  onShow() {
    if (this.data.roomId) this._startStatePolling();
  },

  onHide() { this._stopStatePolling(); },
  onUnload() { this._stopStatePolling(); },

  _applyVoteStatus(snapshot) {
    if (!snapshot || snapshot.ok !== true || !snapshot.roomState) return;
    const state = snapshot.roomState;
    const actor = snapshot.view && snapshot.view.actor || {};
    const isInitiator = Number(state.closingVoteInitiatorIndex) === Number(actor.seatNo);
    const myVote = actor.voteStatus && actor.voteStatus.submitted ? actor.voteStatus.vote : '';
    const sessionId = state.sessionId || '';
    const closingVoteSessionId = state.closingVoteSessionId || '';
    this.setData({
      sessionId,
      closingVoteSessionId,
      closingVoteSeq: snapshot.revision || 0,
      isInitiator,
      hasVoted: isInitiator || !!myVote,
      voteResult: isInitiator ? 'pass' : myVote,
      isSubmitting: false
    }, () => {
      this._renderedClosingContext = Object.freeze({ sessionId, closingVoteSessionId });
    });
  },

  async _refreshVoteStatus() {
    if (!this.data.roomId) return;
    try {
      const snapshot = await getRoomPageSnapshot(this.data.roomId, { refresh: true });
      this._applyVoteStatus(snapshot);
    } catch (e) {
      console.warn('closingStatement refresh', e);
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    if (!this.data.roomId) return;
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId,
      followNavigation: true,
      onSnapshot(snapshot) {
        this._applyVoteStatus(snapshot);
      }
    }).catch((e) => console.warn('closingStatement roomSession', e));
  },

  _stopStatePolling() { unbindPageFromRoomSession(this); },

  handleVote(e) {
    return runPageInteraction(this, () => this._submitVote(e), { loadingText: '正在提交表态…' });
  },

  async _submitVote(e) {
    if (this.data.hasVoted || this.data.isInitiator || this.data.isSubmitting) return;
    const vote = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.vote;
    if (!['pass', 'question'].includes(vote)) return;
    this.setData({ isSubmitting: true });
    try {
      const context = this._renderedClosingContext || {};
      const result = await dispatchRoomCommand('SUBMIT_PARTNER_CLOSING_VOTE', { vote }, {
        sessionId: context.sessionId || this.data.sessionId || '',
        closingVoteSessionId: context.closingVoteSessionId || this.data.closingVoteSessionId || ''
      });
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '提交失败', icon: 'none' });
        return;
      }
      const snapshot = await getRoomPageSnapshot(this.data.roomId, { refresh: false });
      if (snapshot && snapshot.view && snapshot.view.route
        && snapshot.view.route.name === 'closingStatement') {
        this._applyVoteStatus(snapshot);
      }
      await followRoomRouteAfterCommand(result, this.data.roomId);
    } catch (e) {
      console.warn('SUBMIT_PARTNER_CLOSING_VOTE', e);
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  handleGoBack() {
    return runPageInteraction(this, async () => {
      if (!this.data.hasVoted && !this.data.isInitiator) {
        wx.showToast({ title: '请先完成收尾表态', icon: 'none' });
        return;
      }
      openUrl(buildGamepageUrl(this.data.roomId, 1, 'partner'), {
        immediate: true, preferReLaunch: true
      });
    }, { loadingText: '正在返回…' });
  }
}, ['handleVote', 'handleGoBack']));
