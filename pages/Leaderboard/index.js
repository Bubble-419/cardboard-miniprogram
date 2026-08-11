const { navigateByRoomState } = require('../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../utils/subScreenRoomPoll');

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
    // 从合伙人模式收尾页进入时，返回应回到房间，而非德国心脏病模式选择页
    if (this.data.from === 'closingEnd') {
      this._backToRoom();
      return;
    }
    wx.reLaunch({ url: '/pages/main-pages/modeIndex/index?modeId=halliGalli' });
  },

  _backToRoom() {
    const roomId = this.data.roomId || '';
    wx.reLaunch({
      url: `/pages/main-pages/addPlayer/index${roomId ? `?roomId=${encodeURIComponent(roomId)}` : ''}`
    });
  },

  async handleNewGame() {
    // 从合伙人模式收尾页进入时，「再来一局」应回到房间，不应走德国心脏病的清分/新局逻辑
    if (this.data.from === 'closingEnd') {
      this._backToRoom();
      return;
    }
    const { roomId } = this.data;
    if (roomId) {
      wx.showLoading({ title: '加载中…' });
      try {
        await wx.cloud.callFunction({
          name: 'clearRoomScores',
          data: { roomId }
        });
        await wx.cloud.callFunction({
          name: 'updateRoomState',
          data: { roomId, currentPage: 'auth' }
        });
      } catch (e) {
        console.warn('clearRoomScores/updateRoomState', e);
      } finally {
        wx.hideLoading();
      }
    }
    const app = getApp();
    const gd = app.globalData;
    gd.selectedPlayer = null;
    gd.selectedProblem = null;
    gd.selectedMode = null;
    gd.selectedBG = null;
    wx.reLaunch({ url: '/pages/main-pages/modeIndex/index?modeId=halliGalli' });
  }
});
