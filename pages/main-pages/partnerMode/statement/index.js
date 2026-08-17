const { buildGamepageUrl } = require('../../../../utils/modeRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const { openUrl, safeNavigateBack } = require('../../../../utils/pageNavigate');
const {
  PHASE_DISCUSSION,
  phaseFromStatementResult,
  STATEMENT_ALL_PASS
} = require('../../../../utils/partnerGamePhase');
const { getNextPlayerTurn } = require('../../../../utils/partnerPlayerTurn');

Page({
  data: {
    roomId: '',
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    members: [],
    isHost: false,
    isWaiting: false,
    isSubmitting: false,
    passCount: null,
    memberCount: 0
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10)
      : 1;
    const currentPlayerName = (options && options.currentPlayerName)
      ? decodeURIComponent(options.currentPlayerName)
      : `玩家${currentPlayerIndex}`;
    const waitingHint = options && (
      options.isWaiting === '1'
      || options.isWaiting === true
      || options.isSubScreen === '1'
      || options.isSubScreen === true
    );

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    getApp().globalData.roomId = roomId;

    this.setData({
      roomId,
      currentPlayerIndex,
      currentPlayerName,
      // 先按 URL 提示展示；随后以云端 isHost 为准纠正
      isWaiting: !!waitingHint,
      isHost: !waitingHint
    });

    this._bootstrapRole(waitingHint);
  },

  onShow() {
    if (this.data.isWaiting && this.data.roomId) {
      this._startStatePolling();
    } else if (this.data.isHost && this.data.roomId) {
      this._startHostProgressPolling();
    }
  },

  onHide() {
    this._stopStatePolling();
    this._stopHostProgressPolling();
  },

  onUnload() {
    this._stopStatePolling();
    this._stopHostProgressPolling();
    this._statementSubmitLock = false;
  },

  /**
   * 以云端身份为准：仅主屏可选择表态；副屏强制等待页并轮询跟随
   */
  async _bootstrapRole(waitingHint) {
    const roomId = this.data.roomId;
    let isHost = !waitingHint;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        isHost = result.isHost === true;
        if (result.members && result.members.length) {
          this.setData({ members: result.members });
        }
        const state = result.roomState || {};
        if (state.currentPlayerIndex != null) {
          this.setData({
            currentPlayerIndex: state.currentPlayerIndex,
            currentPlayerName: state.currentPlayerName || this.data.currentPlayerName
          });
        }
        this._applyStatementProgress(state, result);
      }
    } catch (e) {
      console.warn('statement _bootstrapRole', e);
    }

    const isWaiting = !isHost;
    this.setData({ isHost, isWaiting });

    if (isWaiting) {
      this._startStatePolling();
      return;
    }

    // 主屏：写入 statement 态并展示选择 UI
    await this._updateRoomState(
      'statement',
      this.data.currentPlayerIndex,
      this.data.currentPlayerName
    );
    if (!this.data.members.length) {
      this._loadMembers(roomId);
    }
    this._startHostProgressPolling();
  },

  /**
   * 房主端轻量轮询：持续刷新「已表态：X/Y」，不触发页面跳转
   */
  _startHostProgressPolling() {
    this._stopHostProgressPolling();
    const poll = async () => {
      const roomId = this.data.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        if (result.ok === true) {
          this._applyStatementProgress(result.roomState || {}, result);
        }
      } catch (e) {
        console.warn('statement host progress poll', e);
      }
    };
    poll();
    this._hostProgressPollTimer = setInterval(poll, 1500);
  },

  _stopHostProgressPolling() {
    if (this._hostProgressPollTimer) {
      clearInterval(this._hostProgressPollTimer);
      this._hostProgressPollTimer = null;
    }
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName, extra) {
    const roomId = this.data.roomId || '';
    if (!roomId) return false;
    try {
      const data = { roomId, currentPage };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      if (extra && typeof extra === 'object') {
        if (extra.partnerGamePhase != null) data.partnerGamePhase = extra.partnerGamePhase;
        if (extra.incrementRound === true) data.incrementRound = true;
        if (extra.partnerMasterMode != null) data.partnerMasterMode = extra.partnerMasterMode;
        if (extra.partnerRoundStartedAt != null) {
          data.partnerRoundStartedAt = extra.partnerRoundStartedAt;
        }
        if (extra.syncPartnerTurnTimer != null) {
          data.syncPartnerTurnTimer = extra.syncPartnerTurnTimer === true;
        }
      }
      const res = await wx.cloud.callFunction({
        name: 'updateRoomState',
        data
      });
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('updateRoomState', e);
      return false;
    }
  },

  /**
   * 房主端「已表态：X/Y」：X 取云端 passCount，Y 取 memberCount
   */
  _applyStatementProgress(state, result) {
    const memberCount = (state && state.memberCount != null)
      ? state.memberCount
      : (result && result.memberCount != null ? result.memberCount : this.data.memberCount);
    const passCount = (state && state.passCount != null) ? state.passCount : this.data.passCount;
    this.setData({ passCount, memberCount });
  },

  async _loadMembers(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.members && result.members.length) {
        this.setData({ members: result.members });
        return result.members;
      }
    } catch (e) {
      console.warn('statement _loadMembers', e);
    }
    return this.data.members || [];
  },

  _goGamepageFromState(state) {
    const roomId = this.data.roomId;
    if (!roomId || !state) return false;
    const idx = state.currentPlayerIndex != null ? state.currentPlayerIndex : 1;
    const phase = state.partnerGamePhase === PHASE_DISCUSSION
      ? PHASE_DISCUSSION
      : (state.partnerGamePhase === 'closing' ? 'closing' : undefined);
    this._stopStatePolling();
    return openUrl(buildGamepageUrl(roomId, idx, 'partner', {
      phase,
      closingStep: state.partnerClosingStep || undefined
    }), { immediate: true });
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

        // 副屏等待中若身份被纠正为主屏，不在此页开放选择（避免误操作）
        if (result.ok === true && result.isHost === true && this.data.isWaiting) {
          // 保持等待并由主屏设备上的主屏页操作；此处仅跟随房间态
        }

        if (result.ok === true) {
          this._applyStatementProgress(result.roomState || {}, result);
        }

        followSubScreenRoomPoll(result, roomId, {
          beforeNavigate: (pollResult, page) => {
            if (page === 'statement') {
              return true;
            }
            // 主屏表态完成 → 全员进入新轮次 gamepage
            if (page === 'gamepage') {
              this._goGamepageFromState(pollResult.roomState || {});
              return true;
            }
            return false;
          }
        });
      } catch (e) {
        console.warn('statement state poll', e);
      }
    };
    poll();
    this._statePollTimer = setInterval(poll, 800);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  handleGoBack() {
    const roomId = this.data.roomId || '';
    const fallbackUrl = roomId
      ? buildGamepageUrl(roomId, this.data.currentPlayerIndex, 'partner')
      : '';
    safeNavigateBack({
      expectedPrev: 'pages/main-pages/partnerMode/gamepage/index',
      fallbackUrl
    });
  },

  async handleStatementResult(e) {
    // 仅主屏可选择表态结果
    if (this.data.isWaiting || this.data.isHost !== true) {
      wx.showToast({ title: '请等待主屏表态', icon: 'none' });
      return;
    }
    // 同步锁必须在任何 await 之前，防止连点双次 incrementRound
    if (this.data.isSubmitting || this._statementSubmitLock) return;
    this._statementSubmitLock = true;

    const result = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.result;
    if (!result) {
      this._statementSubmitLock = false;
      return;
    }

    const { roomId, currentPlayerIndex, currentPlayerName } = this.data;
    if (!roomId) {
      this._statementSubmitLock = false;
      return;
    }

    this.setData({ isSubmitting: true });

    try {
      const partnerGamePhase = phaseFromStatementResult(result);
      let members = this.data.members || [];
      if (!members.length) {
        members = await this._loadMembers(roomId);
      }

      let targetIndex = currentPlayerIndex;
      let targetName = currentPlayerName;
      let incrementRound = false;

      if (result === STATEMENT_ALL_PASS) {
        const next = getNextPlayerTurn(members, currentPlayerIndex);
        targetIndex = next.nextIndex;
        targetName = next.nextName;
        incrementRound = next.incrementRound;
      }

      try {
        const finalizeRes = await wx.cloud.callFunction({
          name: 'finalizePartnerTurnRecord',
          data: {
            roomId,
            playerIndex: currentPlayerIndex,
            playerName: currentPlayerName,
            statementResult: result
          }
        });
        const finalizeResult = (finalizeRes && finalizeRes.result) || {};
        if (finalizeResult.ok !== true) {
          console.warn('finalizePartnerTurnRecord failed', finalizeResult);
          wx.showToast({
            title: finalizeResult.errMsg || '表态记录保存失败',
            icon: 'none'
          });
        }
      } catch (err) {
        console.warn('finalizePartnerTurnRecord', err);
        wx.showToast({ title: '表态记录保存失败', icon: 'none' });
      }

      const ok = await this._updateRoomState('gamepage', targetIndex, targetName, {
        partnerGamePhase,
        partnerMasterMode: false,
        incrementRound,
        partnerRoundStartedAt: Date.now(),
        syncPartnerTurnTimer: true
      });

      if (!ok) {
        this._statementSubmitLock = false;
        this.setData({ isSubmitting: false });
        wx.showToast({ title: '状态同步失败', icon: 'none' });
        return;
      }

      // 成功后保持 isSubmitting，避免导航完成前再次提交导致跳轮
      const opened = openUrl(buildGamepageUrl(roomId, targetIndex, 'partner', {
        phase: partnerGamePhase === PHASE_DISCUSSION ? PHASE_DISCUSSION : undefined
      }), { immediate: true });
      if (!opened) {
        wx.redirectTo({
          url: buildGamepageUrl(roomId, targetIndex, 'partner', {
            phase: partnerGamePhase === PHASE_DISCUSSION ? PHASE_DISCUSSION : undefined
          }),
          complete: () => {
            this._statementSubmitLock = false;
          }
        });
      }
    } catch (err) {
      console.warn('handleStatementResult', err);
      this._statementSubmitLock = false;
      this.setData({ isSubmitting: false });
      wx.showToast({ title: '表态失败', icon: 'none' });
    }
  }
});
