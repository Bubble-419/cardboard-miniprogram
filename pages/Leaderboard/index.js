const { followSubScreenRoomPoll } = require('../../utils/subScreenRoomPoll');
const { goRoomPage } = require('../../utils/goRoomPage');
const { clearLocalBrainstormProgress } = require('../../utils/roomBrainstormProgress');
const { clearPartnerSpecialMoveUsedFlag } = require('../../utils/partnerSpecialMove');
const { safeOpenUrl } = require('../../utils/pageNavigate');
const { buildGamepageUrl } = require('../../utils/modeRoutes');

Page({
  data: {
    roomId: '',
    isSubScreen: false,
    isHost: false,
    leaderboard: [],
    loading: true,
    error: '',
    from: '',
    actioning: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isSubScreen = (options && options.isSubScreen) === '1' || (options && options.isSubScreen) === 'true';
    const from = (options && options.from) || '';
    if (!roomId) {
      this.setData({
        loading: false,
        error: '缺少房间参数'
      });
      return;
    }
    this.setData({ roomId, isSubScreen, from });
    this.loadLeaderboard(roomId);
    if (from === 'closingEnd') {
      this._hostStatusPromise = this._loadHostStatus(roomId);
    }
    if (isSubScreen) {
      this._startStatePolling();
    }
  },

  onUnload() {
    this._stopStatePolling();
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
        followSubScreenRoomPoll(result, roomId);
      } catch (e) {
        console.warn('leaderboard state poll', e);
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

  async loadLeaderboard(roomId) {
    this.setData({ loading: true, error: '' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getLeaderboard',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.leaderboard) {
        const leaderboard = result.leaderboard.map((item, index) => ({
          ...item,
          rank: index + 1
        }));
        this.setData({
          leaderboard,
          loading: false
        });
      } else {
        this.setData({
          loading: false,
          error: result.errMsg || '加载失败'
        });
      }
    } catch (e) {
      console.error('loadLeaderboard', e);
      this.setData({
        loading: false,
        error: e.errMsg || '加载失败'
      });
    }
  },

  async _loadHostStatus(roomId) {
    if (!roomId) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        this.setData({ isHost: result.isHost === true });
      }
    } catch (e) {
      console.warn('leaderboard _loadHostStatus', e);
    }
  },

  handleBack() {
    if (this.data.from === 'closingEnd') {
      // 返回房间时清除当前模式，允许重新选择其他模式
      this.handleReturnRoom();
      return;
    }
    this._exitHalliModeToRoom();
  },

  async handleNewGame() {
    if (this.data.from === 'closingEnd') {
      await this.handleAnotherRound();
      return;
    }
    await this._exitHalliModeToRoom();
  },

  /** 保留当前模式、情境和设计问题，清空本局记录后直接再开一轮 */
  async handleAnotherRound() {
    if (this.data.actioning) return;
    const roomId = this.data.roomId || '';
    if (!roomId) return;

    this.setData({ actioning: true });
    wx.showLoading({ title: '准备新一轮…', mask: true });
    try {
      const checkRes = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const check = (checkRes && checkRes.result) || {};
      if (check.ok !== true) {
        wx.showToast({ title: check.errMsg || '状态获取失败', icon: 'none' });
        return;
      }
      if (check.isHost !== true) {
        wx.showToast({ title: '请等待房主开始新一轮', icon: 'none' });
        return;
      }
      if (check.hasSelectedMode !== true) {
        wx.showToast({ title: '当前模式已清除，请返回房间重新选择', icon: 'none' });
        return;
      }

      const members = (check.members || []).slice().sort((a, b) => {
        return (a.playerIndex || 0) - (b.playerIndex || 0);
      });
      const first = members[0];
      const idx = first && first.playerIndex != null ? first.playerIndex : 1;
      const name = first
        ? (first.nickName || first.playerName || `玩家${idx}`)
        : `玩家${idx}`;
      const modeId = check.selectedModeId || 'partner';
      const startedAt = Date.now();

      const updateRes = await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'gamepage',
          currentPlayerIndex: idx,
          currentPlayerName: name,
          brainstormSessionEnded: false,
          partnerGamePhase: 'play',
          partnerMasterMode: false,
          partnerClosingStep: 'rune',
          resetClosingVotes: true,
          clearBrainstormProgress: true,
          incrementRound: true,
          partnerRoundStartedAt: startedAt
        }
      });
      const result = (updateRes && updateRes.result) || {};
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '状态同步失败', icon: 'none' });
        return;
      }

      clearLocalBrainstormProgress(roomId);
      clearPartnerSpecialMoveUsedFlag(roomId);
      const app = getApp();
      if (!app.globalData) app.globalData = {};
      app.globalData.roomId = roomId;
      app.globalData.gameMode = modeId;
      if (check.selectedBG) app.globalData.selectedBG = check.selectedBG;
      const problem = (check.roomState && check.roomState.selectedDesignProblem)
        || check.selectedDesignProblem;
      if (problem) app.globalData.selectedProblem = problem;

      this._stopStatePolling();
      const url = buildGamepageUrl(roomId, idx, modeId);
      if (!safeOpenUrl(url, { immediate: true })) {
        wx.reLaunch({ url });
      }
    } catch (e) {
      console.warn('leaderboard handleAnotherRound', e);
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ actioning: false });
    }
  },

  /** 清除当前模式后回房间，恢复“选择模式”入口 */
  async handleReturnRoom() {
    if (this.data.actioning) return;
    this.setData({ actioning: true });
    try {
      await this._exitHalliModeToRoom();
    } finally {
      if (this._pageAlive !== false) {
        this.setData({ actioning: false });
      }
    }
  },

  async _exitHalliModeToRoom() {
    if (this._exitingMode) return;
    const roomId = this.data.roomId || '';
    if (!roomId) {
      goRoomPage('');
      return;
    }
    if (this.data.isSubScreen) {
      goRoomPage(roomId);
      return;
    }

    this._exitingMode = true;
    wx.showLoading({ title: '处理中…', mask: true });
    try {
      const callRes = await wx.cloud.callFunction({
        name: 'roomClearBrainstormMode',
        data: { roomId }
      });
      const result = (callRes && callRes.result) || {};
      wx.hideLoading();
      if (result.ok !== true) {
        this._exitingMode = false;
        wx.showToast({ title: result.errMsg || '退出模式失败', icon: 'none' });
        return;
      }
      clearLocalBrainstormProgress(roomId);
      clearPartnerSpecialMoveUsedFlag(roomId);
      try {
        const app = getApp();
        if (app.globalData) {
          app.globalData.gameMode = '';
          app.globalData.selectedMode = null;
          app.globalData.selectedBG = null;
          app.globalData.selectedPlayer = null;
          app.globalData.selectedProblem = null;
        }
      } catch (e) {
        // ignore
      }
      goRoomPage(roomId);
    } catch (e) {
      wx.hideLoading();
      this._exitingMode = false;
      wx.showToast({ title: (e && e.errMsg) || '退出模式失败', icon: 'none' });
    }
  }
});
