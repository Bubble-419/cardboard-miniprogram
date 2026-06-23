/**
 * 合伙人模式 - 模式首页（情境选择）
 * 路径：pages/main-pages/partnerMode/modeIndex/
 */
const { getAllScenarios } = require('../../../../utils/partnerScenarios');

Page({
  data: {
    roomId: '',
    modeId: 'partner',
    isHost: true,
    isWaiting: false,
    scenarios: [],
    selectedScenarioId: null,
    actionMode: 'add' // add | select
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const modeId = (options && options.modeId) || 'partner';
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);

    if (roomId) {
      getApp().globalData.roomId = roomId;
    }
    getApp().globalData.gameMode = 'partner';

    this.setData({
      roomId,
      modeId,
      isWaiting: !!isWaiting
    });

    if (isWaiting) {
      this.setData({ isHost: false });
      this._startStatePolling();
      return;
    }
    this._fetchHostStatus();
  },

  onShow() {
    if (this.data.isHost && !this.data.isWaiting) {
      this._loadScenarios();
    }
  },

  onUnload() {
    this._stopStatePolling();
  },

  _loadScenarios() {
    this.setData({ scenarios: getAllScenarios() });
  },

  async _fetchHostStatus() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      this.setData({ isHost: true });
      this._loadScenarios();
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        const isHost = result.isHost === true;
        this.setData({ isHost, roomId });
        if (isHost) {
          this._updateRoomState('auth');
          this._loadScenarios();
        } else {
          this._startStatePolling();
        }
      } else {
        this.setData({ isHost: true });
        this._loadScenarios();
      }
    } catch (e) {
      this.setData({ isHost: true });
      this._loadScenarios();
    }
  },

  async _updateRoomState(currentPage) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: { roomId, currentPage }
      });
    } catch (e) {
      console.warn('updateRoomState', e);
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        if (result.ok !== true || !result.roomState) return;
        const page = (result.roomState.currentPage || '').toLowerCase();
        const roomIdEnc = encodeURIComponent(roomId);
        if (page === 'auth' || page === 'selectbg' || page === 'selectproblem') {
          wx.redirectTo({ url: `/pages/sub-pages/awaitBG/index?roomId=${roomIdEnc}` });
        } else if (page === 'selectmode') {
          wx.redirectTo({ url: `/pages/sub-pages/awaitMode/index?roomId=${roomIdEnc}` });
        } else if (page === 'selectplayer') {
          wx.redirectTo({ url: `/pages/sub-pages/awaitPlayer/index?roomId=${roomIdEnc}` });
        } else if (page === 'gamepage') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          wx.redirectTo({ url: `/pages/main-pages/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}` });
        } else if (page === 'statement') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          wx.redirectTo({ url: `/pages/main-pages/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isSubScreen=1` });
        } else if (page === 'creativeinput') {
          wx.redirectTo({ url: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}` });
        } else if (page === 'creativesummary') {
          wx.redirectTo({ url: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}` });
        }
      } catch (e) {
        console.warn('partnerMode state poll', e);
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

  onTapScenario(e) {
    if (!this.data.isHost) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const nextId = this.data.selectedScenarioId === id ? null : id;
    this.setData({
      selectedScenarioId: nextId,
      actionMode: nextId ? 'select' : 'add'
    });
  },

  handleFooterAction() {
    if (!this.data.isHost) return;
    if (this.data.actionMode === 'select' && this.data.selectedScenarioId) {
      this._confirmSelectedScenario();
      return;
    }
    this._goAddScenario();
  },

  _goAddScenario() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    this._updateRoomState('selectBG');
    const query = roomId
      ? `?mode=partner&roomId=${encodeURIComponent(roomId)}`
      : '?mode=partner';
    wx.navigateTo({
      url: `/pages/main-pages/selectBG/index${query}`
    });
  },

  _confirmSelectedScenario() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }
    const scenario = (this.data.scenarios || []).find(
      (item) => item.id === this.data.selectedScenarioId
    );
    if (!scenario || !scenario.bg) {
      wx.showToast({ title: '请选择情境', icon: 'none' });
      return;
    }

    const app = getApp();
    app.globalData = app.globalData || {};
    app.globalData.selectedBG = { ...scenario.bg };
    app.globalData.gameMode = 'partner';

    this._updateRoomState('selectPlayer');
    wx.redirectTo({
      url: `/pages/main-pages/selectPlayer/index?roomId=${encodeURIComponent(roomId)}`
    });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({
          url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(this.data.roomId)}`
        });
      }
    });
  }
});
