const { buildGamepageUrl, buildClosingStatementUrl } = require('../../../../utils/modeRoutes');
const { navigateByRoomState, safeOpenUrl } = require('../../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');

function isValidClosingVote(vote) {
  return vote === 'pass' || vote === 'question';
}

Page({
  data: {
    roomId: '',
    hasVoted: false,
    isSubmitting: false,
    voteResult: ''
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    getApp().globalData.roomId = roomId;
    this.setData({ roomId, hasVoted: false, voteResult: '', isSubmitting: false });
    this._startStatePolling();
    this._refreshVoteStatus();
  },

  onShow() {
    this.setData({ hasVoted: false, voteResult: '', isSubmitting: false });
    if (this.data.roomId) {
      this._startStatePolling();
      this._refreshVoteStatus();
    }
  },

  onHide() {
    this._stopStatePolling();
  },

  onUnload() {
    this._stopStatePolling();
  },

  async _refreshVoteStatus() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.members) return;

      const me = (result.members || []).find((m) => m.isMe);
      if (!me) return;

      const page = (result.roomState.currentPage || '').toLowerCase();
      if (page !== 'closingstatement') {
        return;
      }

      const votes = (result.roomState && result.roomState.closingVotes) || {};
      const myVote = votes[String(me.playerIndex)];
      if (isValidClosingVote(myVote)) {
        this.setData({ hasVoted: true, voteResult: myVote });
      } else {
        this.setData({ hasVoted: false, voteResult: '' });
      }
    } catch (e) {
      console.warn('closingStatement _refreshVoteStatus', e);
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        followSubScreenRoomPoll(result, roomId, {
          beforeNavigate: (pollResult, page) => page === 'closingstatement'
        });
      } catch (e) {
        console.warn('closingStatement state poll', e);
      }
    };
    poll();
    this._statePollTimer = setInterval(poll, 1500);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  async handleVote(e) {
    if (this.data.hasVoted || this.data.isSubmitting) return;
    const vote = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.vote;
    if (!vote) return;

    const roomId = this.data.roomId;
    if (!roomId) return;

    this.setData({ isSubmitting: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitClosingVote',
        data: { roomId, vote }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
        this.setData({ isSubmitting: false });
        return;
      }

      this.setData({
        hasVoted: true,
        voteResult: vote,
        isSubmitting: false
      });
    } catch (err) {
      console.warn('handleVote', err);
      wx.showToast({ title: '提交失败', icon: 'none' });
      this.setData({ isSubmitting: false });
    }
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        const roomId = this.data.roomId || '';
        if (roomId) {
          wx.redirectTo({
            url: buildGamepageUrl(roomId, 1, 'partner')
          });
        }
      }
    });
  }
});
