const { buildGamepageUrl } = require('../../../../utils/modeRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const { safeNavigateBack, clearPendingNavigation } = require('../../../../utils/pageNavigate');
const {
  PHASE_DISCUSSION,
  PHASE_PLAY,
  phaseFromStatementResult,
  STATEMENT_ALL_PASS
} = require('../../../../utils/partnerGamePhase');
const { getNextPlayerTurn } = require('../../../../utils/partnerPlayerTurn');

Page({
  data: {
    roomId: '',
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    currentRound: 1,
    members: [],
    isHost: false,
    isWaiting: false,
    isSubmitting: false,
    passCount: null,
    memberCount: 0
  },

  onLoad(options) {
    this._statementSubmitLock = false;
    this._statementTurnCommitted = false;
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10)
      : 1;
    const currentPlayerName = (options && options.currentPlayerName)
      ? decodeURIComponent(options.currentPlayerName)
      : `玩家${currentPlayerIndex}`;
    const currentRound = options && options.currentRound != null
      ? parseInt(options.currentRound, 10) || 1
      : 1;
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
      currentRound,
      // 先按 URL 提示展示；随后以云端 isHost 为准纠正
      isWaiting: !!waitingHint,
      isHost: !waitingHint
    });

    this._bootstrapRole(waitingHint);
  },

  onShow() {
    if (this._statementSubmitLock || this._statementTurnCommitted) return;
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
        // 不覆盖 URL 传入的 currentPlayerIndex/currentPlayerName：
        // 这两个值由房主的 gamepage 在跳转前确定，是本轮出牌玩家的准确值；
        // 服务端可能因其他端轮询已推进到下一玩家，覆盖会导致表态/纪要归档玩家错位。
        this._applyStatementProgress(result.roomState || {}, result);
        const livePage = String(
          (result.roomState && result.roomState.currentPage) || ''
        ).toLowerCase();
        if (livePage === 'gamepage' || livePage === 'closingstatement' || livePage === 'closingend') {
          this._statementTurnCommitted = true;
          this._goGamepageFromState(result.roomState || {});
          return;
        }
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

    // 表态页不再回写 currentPage=statement：开始表态时已经写过。
    // 迟到的回写会把已经进入 gamepage 的房间再拉回 statement，造成闪回和二次点击。
    if (this._statementSubmitLock || this._statementTurnCommitted) return;
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
          const livePage = String(
            (result.roomState && result.roomState.currentPage) || ''
          ).toLowerCase();
          if (livePage === 'gamepage' || livePage === 'closingstatement' || livePage === 'closingend') {
            this._statementTurnCommitted = true;
            this._stopHostProgressPolling();
            this._goGamepageFromState(result.roomState || {});
            return;
          }
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
        if (extra.skipArchive === true) {
          data.skipArchive = true;
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
    const patch = { passCount, memberCount };
    if (state && state.currentRound != null) {
      patch.currentRound = Number(state.currentRound) || 1;
    }
    this.setData(patch);
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
    const stateRound = state.currentRound != null
      ? Number(state.currentRound)
      : (this.data.currentRound || 1);
    this._stopStatePolling();
    this._navigateToGamepage(buildGamepageUrl(roomId, idx, 'partner', {
      phase,
      currentRound: stateRound,
      closingStep: state.partnerClosingStep || undefined,
      fromStatement: true
    }));
    return true;
  },

  _navigateToGamepage(url) {
    if (!url) return;
    clearPendingNavigation();
    wx.redirectTo({
      url,
      fail: () => {
        wx.reLaunch({
          url,
          fail: (err) => console.warn('statement leave to gamepage', err, url)
        });
      }
    });
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
    if (this.data.isSubmitting || this._statementSubmitLock || this._statementTurnCommitted) return;
    this._statementSubmitLock = true;
    // 提交期间停止轮询，避免轮询跳转与主动跳转并发，造成需要重复点击/重复推进轮次
    this._stopStatePolling();
    this._stopHostProgressPolling();

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

      let ok = false;
      if (result === STATEMENT_ALL_PASS) {
        // 只走一次换人归档：不要 ADVANCE_TURN + updateRoomState 双写。
        // 后者在命令已推进座位后会把「下一位玩家」再归档成一张空纪要。
        ok = await this._updateRoomState('gamepage', targetIndex, targetName, {
          partnerGamePhase: PHASE_PLAY,
          partnerMasterMode: false,
          incrementRound: true,
          partnerRoundStartedAt: Date.now(),
          syncPartnerTurnTimer: true
        });
      } else {
        // 有疑问：只切换 phase 到 discussion，currentPlayerIndex 不变，不归档
        ok = await this._updateRoomState('gamepage', currentPlayerIndex, currentPlayerName, {
          partnerGamePhase,
          partnerMasterMode: false,
          partnerRoundStartedAt: Date.now(),
          syncPartnerTurnTimer: true,
          skipArchive: true
        });
      }

      if (!ok) {
        this._statementSubmitLock = false;
        this.setData({ isSubmitting: false });
        if (this.data.isWaiting) {
          this._startStatePolling();
        } else if (this.data.isHost) {
          this._startHostProgressPolling();
        }
        wx.showToast({ title: '状态同步失败', icon: 'none' });
        return;
      }

      // 本轮表态已提交：页面即使还在，也禁止再次点击推进轮次
      this._statementTurnCommitted = true;
      this._stopStatePolling();
      this._stopHostProgressPolling();

      const destCurrentRound = result === STATEMENT_ALL_PASS
        ? (Number(this.data.currentRound) || 1) + 1
        : (Number(this.data.currentRound) || 1);
      const destUrl = buildGamepageUrl(roomId, targetIndex, 'partner', {
        phase: partnerGamePhase === PHASE_DISCUSSION ? PHASE_DISCUSSION : undefined,
        currentRound: destCurrentRound,
        fromStatement: true
      });
      this._navigateToGamepage(destUrl);
    } catch (err) {
      console.warn('handleStatementResult', err);
      this._statementTurnCommitted = false;
      this._statementSubmitLock = false;
      this.setData({ isSubmitting: false });
      if (this.data.isWaiting) {
        this._startStatePolling();
      } else if (this.data.isHost) {
        this._startHostProgressPolling();
      }
      wx.showToast({ title: '表态失败', icon: 'none' });
    }
  }
});
