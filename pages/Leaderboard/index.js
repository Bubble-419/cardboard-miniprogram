const { followSubScreenRoomPoll } = require('../../utils/subScreenRoomPoll');
const { goRoomPage } = require('../../utils/goRoomPage');
const { clearLocalBrainstormProgress } = require('../../utils/roomBrainstormProgress');
const { clearPartnerSpecialMoveUsedFlag } = require('../../utils/partnerSpecialMove');

Page({
  data: {
    roomId: '',
    isSubScreen: false,
    leaderboard: [],
    loading: true,
    error: '',
    from: ''
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

  handleBack() {
    if (this.data.from === 'closingEnd') {
      this._backToRoom();
      return;
    }
    this._exitHalliModeToRoom();
  },

  _backToRoom() {
    const roomId = this.data.roomId || '';
    goRoomPage(roomId);
  },

  async handleNewGame() {
    if (this.data.from === 'closingEnd') {
      this._backToRoom();
      return;
    }
    await this._exitHalliModeToRoom();
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
