const { buildGamepageUrl, buildClosingEndUrl } = require('../../../../utils/modeRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const { openUrl } = require('../../../../utils/pageNavigate');
const { PHASE_CLOSING } = require('../../../../utils/partnerGamePhase');

function isValidClosingVote(vote) {
  return vote === 'pass' || vote === 'question';
}

Page({
  data: {
    roomId: '',
    hasVoted: false,
    isInitiator: false,
    isSubmitting: false,
    voteResult: '',
    closingVoteSessionId: 0,
    closingVoteSeq: 0
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    getApp().globalData.roomId = roomId;
    const expectedSessionId = options && options.closingVoteSessionId != null
      ? Number(options.closingVoteSessionId)
      : 0;
    this._expectedSessionId = Number.isFinite(expectedSessionId) && expectedSessionId > 0
      ? expectedSessionId
      : 0;
    this._settlementNavigating = false;
    this._sawLiveClosingSession = false;
    const isInitiator = options && (options.isInitiator === '1' || options.isInitiator === 'true');
    this.setData({
      roomId,
      hasVoted: false,
      isInitiator: !!isInitiator,
      voteResult: isInitiator ? 'pass' : '',
      isSubmitting: false,
      closingVoteSessionId: 0,
      closingVoteSeq: 0
    });
    this._enableLeaveGuard();
    this._startStatePolling();
    this._refreshVoteStatus();
  },

  onShow() {
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
    this._disableLeaveGuard();
  },

  _enableLeaveGuard() {
    if (typeof wx.enableAlertBeforeUnload !== 'function') return;
    try {
      wx.enableAlertBeforeUnload({
        message: '收尾表态进行中，离开后可能丢失进度'
      });
    } catch (e) {
      // ignore
    }
  },

  _disableLeaveGuard() {
    if (typeof wx.disableAlertBeforeUnload !== 'function') return;
    try {
      wx.disableAlertBeforeUnload();
    } catch (e) {
      // ignore
    }
  },

  /**
   * 未表态时绝不离页（避免进页瞬间读到旧 gamepage/closingend 被踢走）
   * 仅本人已表态，或提交接口确认本会话已结算时，才跟随跳转
   */
  _canLeaveClosingStatement() {
    return this.data.hasVoted === true || this._settlementNavigating === true;
  },

  _navigateAfterVoteSettlement(result) {
    const roomId = this.data.roomId;
    if (!roomId || !result) return false;
    if (!this._canLeaveClosingStatement()) return false;
    if (!this._sawLiveClosingSession && !this._settlementNavigating) return false;

    const page = String(result.currentPage || '').toLowerCase();
    if (!page || page === 'closingstatement') return false;

    this._stopStatePolling();
    this._disableLeaveGuard();
    this._settlementNavigating = true;
    const navOpts = { immediate: true, preferReLaunch: true };
    if (page === 'closingend') {
      return openUrl(buildClosingEndUrl(roomId), navOpts);
    }
    if (page === 'gamepage') {
      const phase = result.partnerGamePhase === PHASE_CLOSING ? 'closing' : undefined;
      const idx = result.currentPlayerIndex != null ? result.currentPlayerIndex : 1;
      return openUrl(buildGamepageUrl(roomId, idx, 'partner', {
        phase,
        closingStep: result.partnerClosingStep || undefined
      }), navOpts);
    }
    return false;
  },

  _applyVoteStatus(result) {
    const me = (result.members || []).find((m) => m.isMe);
    if (!me) return;

    const page = ((result.roomState && result.roomState.currentPage) || '').toLowerCase();
    if (page !== 'closingstatement') {
      return;
    }

    const sessionId = result.roomState.closingVoteSessionId != null
      ? Number(result.roomState.closingVoteSessionId)
      : 0;
    const seq = result.roomState.closingVoteSeq != null
      ? Number(result.roomState.closingVoteSeq)
      : 0;

    if (
      this._expectedSessionId > 0
      && sessionId > 0
      && sessionId !== this._expectedSessionId
    ) {
      this._sawLiveClosingSession = true;
      this.setData({
        closingVoteSessionId: sessionId,
        closingVoteSeq: seq
      });
      return;
    }

    if (sessionId > 0) {
      this._expectedSessionId = sessionId;
      this._sawLiveClosingSession = true;
    }

    const votes = (result.roomState && result.roomState.closingVotes) || {};
    const myVote = votes[String(me.playerIndex)];
    const initiatorIdx = result.roomState && result.roomState.closingVoteInitiatorIndex != null
      ? Number(result.roomState.closingVoteInitiatorIndex)
      : null;
    const serverIsInitiator = initiatorIdx != null && initiatorIdx === Number(me.playerIndex);
    const isInitiator = serverIsInitiator || (initiatorIdx == null && this.data.isInitiator);
    const hasVoted = serverIsInitiator || (sessionId > 0 && isValidClosingVote(myVote));
    this.setData({
      closingVoteSessionId: sessionId || 0,
      closingVoteSeq: seq || 0,
      hasVoted,
      isInitiator,
      voteResult: isInitiator
        ? (isValidClosingVote(myVote) ? myVote : 'pass')
        : (isValidClosingVote(myVote) ? myVote : '')
    });
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

      const page = ((result.roomState && result.roomState.currentPage) || '').toLowerCase();
      if (page === 'closingstatement') {
        this._applyVoteStatus(result);
        return;
      }

      // 未表态时忽略旧页残留，留在表态页等待/重试
      if (!this._canLeaveClosingStatement()) {
        return;
      }
      if (!this._sawLiveClosingSession && !this._settlementNavigating) {
        return;
      }

      this._navigateAfterVoteSettlement({
        currentPage: page,
        partnerGamePhase: result.roomState.partnerGamePhase,
        partnerClosingStep: result.roomState.partnerClosingStep,
        currentPlayerIndex: result.roomState.currentPlayerIndex
      });
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
          beforeNavigate: (pollResult, page) => {
            if (page === 'closingstatement') {
              this._applyVoteStatus(pollResult);
              return true;
            }

            // 未表态：吞掉一切离页跟随，防止读到滞后 gamepage/closingend
            if (!this._canLeaveClosingStatement()) {
              return true;
            }
            // 尚未见到本轮表态会话：忽略进页前的旧 gamepage 快照
            if (!this._sawLiveClosingSession && !this._settlementNavigating) {
              return true;
            }

            if (page === 'closingend') {
              this._disableLeaveGuard();
              openUrl(buildClosingEndUrl(roomId), { immediate: true, preferReLaunch: true });
              return true;
            }
            if (page === 'gamepage') {
              const state = pollResult.roomState || {};
              const idx = state.currentPlayerIndex != null ? state.currentPlayerIndex : 1;
              const phase = state.partnerGamePhase === PHASE_CLOSING ? 'closing' : undefined;
              this._disableLeaveGuard();
              openUrl(buildGamepageUrl(roomId, idx, 'partner', {
                phase,
                closingStep: state.partnerClosingStep || undefined
              }), { immediate: true, preferReLaunch: true });
              return true;
            }
            if (pollResult.roomState && pollResult.roomState.brainstormSessionEnded === true) {
              return false;
            }
            // 表态期间忽略情境/大厅等回跳，避免页面栈退回「重新选择情境」
            return true;
          }
        });
      } catch (e) {
        console.warn('closingStatement state poll', e);
      }
    };
    poll();
    this._statePollTimer = setInterval(poll, 1000);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  async handleVote(e) {
    if (this.data.hasVoted || this.data.isInitiator || this.data.isSubmitting) return;
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
        if (result.errCode === 'INITIATOR_EXEMPT') {
          this.setData({
            hasVoted: true,
            isInitiator: true,
            voteResult: 'pass',
            isSubmitting: false
          });
          return;
        }
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
        this.setData({ isSubmitting: false });
        this._refreshVoteStatus();
        return;
      }

      if (result.closingVoteSessionId) {
        this._expectedSessionId = Number(result.closingVoteSessionId) || this._expectedSessionId;
      }
      this._sawLiveClosingSession = true;

      this.setData({
        hasVoted: true,
        voteResult: vote,
        isSubmitting: false,
        closingVoteSessionId: result.closingVoteSessionId || this.data.closingVoteSessionId,
        closingVoteSeq: result.closingVoteSeq != null
          ? result.closingVoteSeq
          : this.data.closingVoteSeq
      });

      const settledPage = String(result.currentPage || '').toLowerCase();
      if (settledPage && settledPage !== 'closingstatement') {
        this._settlementNavigating = true;
        this._disableLeaveGuard();
        this._navigateAfterVoteSettlement(result);
      }
    } catch (err) {
      console.warn('handleVote', err);
      wx.showToast({ title: '提交失败', icon: 'none' });
      this.setData({ isSubmitting: false });
    }
  },

  handleGoBack() {
    if (!this._canLeaveClosingStatement()) {
      wx.showToast({ title: '请先完成收尾表态', icon: 'none' });
      return;
    }
    const roomId = this.data.roomId || '';
    this._disableLeaveGuard();
    openUrl(roomId ? buildGamepageUrl(roomId, 1, 'partner') : '/pages/main-pages/addPlayer/index', {
      immediate: true,
      preferReLaunch: true
    });
  }
});
