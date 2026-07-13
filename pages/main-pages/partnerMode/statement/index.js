const { buildGamepageUrl } = require('../../../../utils/modeRoutes');
const { safeOpenUrl } = require('../../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const {
  PHASE_PLAY,
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
    isWaiting: false,
    isSubmitting: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10)
      : 1;
    const currentPlayerName = (options && options.currentPlayerName)
      ? decodeURIComponent(options.currentPlayerName)
      : `玩家${currentPlayerIndex}`;
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);
    const isSubScreen = options && (options.isSubScreen === '1' || options.isSubScreen === true);

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
      isWaiting: !!(isWaiting || isSubScreen)
    });

    if (isWaiting || isSubScreen) {
      this._startStatePolling();
      return;
    }

    this._updateRoomState('statement', currentPlayerIndex, currentPlayerName);
    this._loadMembers(roomId);
  },

  onShow() {
    if (this.data.isWaiting && this.data.roomId) {
      this._startStatePolling();
    }
  },

  onHide() {
    this._stopStatePolling();
  },

  onUnload() {
    this._stopStatePolling();
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
            if (page === 'statement') return true;
            if (page === 'gamepage') {
              const state = pollResult.roomState || {};
              const idx = state.currentPlayerIndex != null ? state.currentPlayerIndex : 1;
              const phase = state.partnerGamePhase === PHASE_DISCUSSION ? PHASE_DISCUSSION : undefined;
              safeOpenUrl(buildGamepageUrl(roomId, idx, 'partner', { phase }));
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
    this._statePollTimer = setInterval(poll, 2000);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        const roomId = this.data.roomId || '';
        if (roomId) {
          wx.redirectTo({
            url: buildGamepageUrl(roomId, this.data.currentPlayerIndex, 'partner')
          });
        }
      }
    });
  },

  async handleStatementResult(e) {
    if (this.data.isSubmitting) return;
    const result = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.result;
    if (!result) return;

    const { roomId, currentPlayerIndex, currentPlayerName } = this.data;
    if (!roomId) return;

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

    this.setData({ isSubmitting: true });

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
    } catch (e) {
      console.warn('finalizePartnerTurnRecord', e);
      wx.showToast({ title: '表态记录保存失败', icon: 'none' });
    }

    const ok = await this._updateRoomState('gamepage', targetIndex, targetName, {
      partnerGamePhase,
      partnerMasterMode: false,
      incrementRound
    });

    this.setData({ isSubmitting: false });

    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }

    safeOpenUrl(buildGamepageUrl(roomId, targetIndex, 'partner', {
      phase: partnerGamePhase === PHASE_DISCUSSION ? PHASE_DISCUSSION : undefined
    }));
  }
});
