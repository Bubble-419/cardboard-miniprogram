/**
 * 共用模式首页 - 情境选择
 * 路径：pages/main-pages/modeIndex/
 * 入口参数：roomId, modeId (halliGalli | partner | spy)
 */
const { getScenariosForMode } = require('../../../utils/partnerScenarios');
const { navigateByRoomState } = require('../../../utils/subAwaitRoutes');

const MODE_META = {
  halliGalli: { title: '德国心脏病模式', gameMode: 'halliGalli' },
  partner: { title: '合伙人模式', gameMode: 'partner' },
  spy: { title: '谁是卧底模式', gameMode: 'spy' }
};

Page({
  data: {
    roomId: '',
    modeId: 'partner',
    modeTitle: '合伙人模式',
    isHost: true,
    isWaiting: false,
    scenarios: [],
    offlineScenario: null,
    customScenarios: [],
    selectedScenarioId: null,
    actionMode: 'add',
    navbarPaddingTop: 0
  },

  onLoad(options) {
    try {
      const sysInfo = wx.getSystemInfoSync();
      this.setData({ navbarPaddingTop: sysInfo.statusBarHeight || 44 });
    } catch (e) {
      this.setData({ navbarPaddingTop: 44 });
    }
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const modeId = (options && options.modeId) || 'partner';
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);
    const meta = MODE_META[modeId] || MODE_META.partner;

    if (roomId) {
      getApp().globalData.roomId = roomId;
    }
    getApp().globalData.gameMode = meta.gameMode;

    this.setData({
      roomId,
      modeId,
      modeTitle: meta.title,
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
    const scenarios = getScenariosForMode(this.data.modeId);
    const offlineScenario = scenarios.find((s) => s.isOffline || s.id === 'offline') || null;
    const customScenarios = scenarios.filter((s) => !s.isOffline && s.id !== 'offline');
    this.setData({ scenarios, offlineScenario, customScenarios });
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

  async _updateRoomState(currentPage, selectedBG) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    try {
      const data = { roomId, currentPage };
      if (selectedBG) data.selectedBG = selectedBG;
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data
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
        navigateByRoomState(page, result.roomState, roomId);
      } catch (e) {
        console.warn('modeIndex state poll', e);
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

  /** 新设计：点击卡片箭头直接选中并确认 */
  onCardArrow(e) {
    if (!this.data.isHost) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ selectedScenarioId: id, actionMode: 'select' });
    this._confirmSelectedScenario();
  },

  /** 新增情境入口 */
  handleAddScenario() {
    if (!this.data.isHost) return;
    this._goAddScenario();
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
    const mode = this.data.modeId === 'partner' ? 'partner' : 'halliGalli';
    getApp().globalData.gameMode = mode;
    this._updateRoomState('selectBG');
    const query = roomId
      ? `?mode=${mode}&roomId=${encodeURIComponent(roomId)}`
      : `?mode=${mode}`;
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
    if (!scenario) {
      wx.showToast({ title: '请选择情境', icon: 'none' });
      return;
    }

    const app = getApp();
    app.globalData = app.globalData || {};
    const roomIdEnc = encodeURIComponent(roomId);

    // 德国心脏病：线下情境 → 直接进入选玩家
    if (scenario.isOffline || scenario.id === 'offline') {
      app.globalData.gameMode = 'halliGalli';
      this._updateRoomState('selectPlayer');
      wx.redirectTo({
        url: `/pages/main-pages/selectPlayer/index?roomId=${roomIdEnc}`
      });
      return;
    }

    if (!scenario.bg) {
      wx.showToast({ title: '情境数据无效', icon: 'none' });
      return;
    }

    // 合伙人：确认情境页 → 选择问题
    if (this.data.modeId === 'partner') {
      app.globalData.selectedBG = { ...scenario.bg };
      app.globalData.gameMode = 'partner';
      wx.navigateTo({
        url: `/pages/main-pages/partnerMode/confirmBG/index?roomId=${roomIdEnc}`
      });
      return;
    }

    // 其他模式（含 halliGalli 案例/历史）：带入情境后进入选玩家
    const bg = { ...scenario.bg };
    if (this.data.modeId === 'halliGalli') {
      delete bg.platform;
    }
    app.globalData.selectedBG = bg;
    app.globalData.gameMode = this.data.modeId;
    this._updateRoomState('selectPlayer', bg);
    wx.redirectTo({
      url: `/pages/main-pages/selectPlayer/index?roomId=${roomIdEnc}`
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
