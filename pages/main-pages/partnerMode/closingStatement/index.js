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
    this._enteredAt = Date.now();
    const isInitiator = options && (options.isInitiator === '1' || options.isInitiator === 'true');
    this.setData({
      roomId,
      hasVoted: !!isInitiator,
      isInitiator: !!isInitiator,
      voteResult: isInitiator ? 'pass' : '',
      isSubmitting: false,
      closingVoteSessionId: 0,
      closingVoteSeq: 0
    });
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
  },

  /**
   * 未表态时绝不离页（避免进页瞬间读到旧 gamepage/closingend 被踢走）
   * 发起人默认已通过；其余玩家须本人已表态或接口确认已结算
   */
  _canLeaveClosingStatement() {
    return this.data.hasVoted === true
      || this.data.isInitiator === true
      || this._settlementNavigating === true;
  },

  _isConfirmedSettlement(page, state) {
    const p = String(page || '').toLowerCase();
    if (p === 'closingend') return true;
    if (p !== 'gamepage') return false;
    if (this._settlementNavigating) return true;
    const roomState = state || {};
    if (roomState.partnerGamePhase === PHASE_CLOSING) return true;
    if (Array.isArray(roomState.closingQuestionPlayers)
      && roomState.closingQuestionPlayers.length > 0) {
      return true;
    }
    if (this._sawLiveClosingSession) return true;
    const startedAt = Number(roomState.partnerRoundStartedAt) || 0;
    const enteredAt = this._enteredAt || 0;
    // 结算会刷新回合锚点；给 10s 时钟偏差，避免云端 now 略早于本地进页时间
    return enteredAt > 0 && startedAt >= enteredAt - 10000;
  },

  _leaveToSettledPage(page, state) {
    const roomId = this.data.roomId;
    const p = String(page || '').toLowerCase();
    if (!roomId || !p || p === 'closingstatement') return false;
    this._stopStatePolling();
    this._settlementNavigating = true;
    const navOpts = { immediate: true, preferReLaunch: true };
    if (p === 'closingend') {
      return openUrl(buildClosingEndUrl(roomId), navOpts);
    }
    if (p === 'gamepage') {
      const roomState = state || {};
      const phase = roomState.partnerGamePhase === PHASE_CLOSING ? 'closing' : undefined;
      const idx = roomState.currentPlayerIndex != null ? roomState.currentPlayerIndex : 1;
      return openUrl(buildGamepageUrl(roomId, idx, 'partner', {
        phase,
        closingStep: roomState.partnerClosingStep || undefined
      }), navOpts);
    }
    return false;
  },

  _navigateAfterVoteSettlement(result) {
    if (!result) return false;
    if (!this._canLeaveClosingStatement()) return false;
    const page = String(result.currentPage || '').toLowerCase();
    if (!this._isConfirmedSettlement(page, result)) return false;
    return this._leaveToSettledPage(page, result);
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
    const hasVoted = this.data.hasVoted
      || serverIsInitiator
      || (sessionId > 0 && isValidClosingVote(myVote));
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
      if (!this._isConfirmedSettlement(page, result.roomState)) {
        return;
      }

      this._navigateAfterVoteSettlement({
        currentPage: page,
        partnerGamePhase: result.roomState.partnerGamePhase,
        partnerClosingStep: result.roomState.partnerClosingStep,
        currentPlayerIndex: result.roomState.currentPlayerIndex,
        closingQuestionPlayers: result.roomState.closingQuestionPlayers,
        partnerRoundStartedAt: result.roomState.partnerRoundStartedAt
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
            if (!this._isConfirmedSettlement(page, pollResult.roomState)) {
              return true;
            }

            if (page === 'closingend' || page === 'gamepage') {
              this._leaveToSettledPage(page, pollResult.roomState);
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
        wx.showToast({
          title: result.errMsg || result.errCode || '提交失败',
          icon: 'none',
          duration: 2500
        });
        this.setData({ isSubmitting: false });
        this._refreshVoteStatus();
        return;
      }

      if (result.closingVoteSessionId) {
        this._expectedSessionId = Number(result.closingVoteSessionId) || this._expectedSessionId;
      }
      this._sawLiveClosingSession = true;
      this.data.hasVoted = true;

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
      if (result.settled === true || (settledPage && settledPage !== 'closingstatement')) {
        this._leaveToSettledPage(settledPage || 'gamepage', result);
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
    openUrl(roomId ? buildGamepageUrl(roomId, 1, 'partner') : '/pages/main-pages/addPlayer/index', {
      immediate: true,
      preferReLaunch: true
    });
  }
});
