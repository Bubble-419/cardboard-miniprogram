/**
 * 共用模式首页 - 情境选择
 * 路径：pages/main-pages/modeIndex/
 * 入口参数：roomId, modeId (halliGalli | partner | spy)
 */
const { getScenariosForMode } = require('../../../utils/partnerScenarios');
const { buildScenarioTagsForMode } = require('../../../utils/scenarioCategories');
const { navigateByRoomState } = require('../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');
const {
  bindPageToRoomSession,
  unbindPageFromRoomSession
} = require('../../../modules/room-session/index');
const { PARTNER_MODE_DISPLAY_TITLE } = require('../../../utils/modeDisplayNames');
const { goRoomPage } = require('../../../utils/goRoomPage');
const { buildAvatarListAsync } = require('../../../utils/avatars');
const { safeNavigateBack } = require('../../../utils/pageNavigate');

const MODE_META = {
  halliGalli: { title: '德国心脏病模式', gameMode: 'halliGalli' },
  partner: { title: PARTNER_MODE_DISPLAY_TITLE, gameMode: 'partner' },
  spy: { title: '谁是卧底模式', gameMode: 'spy' }
};

Page({
  data: {
    roomId: '',
    modeId: 'partner',
    modeTitle: PARTNER_MODE_DISPLAY_TITLE,
    isHost: true,
    isWaiting: false,
    workshopName: '脑暴工作坊',
    avatarList: [],
    currentUser: null,
    scenarios: [],
    offlineScenario: null,
    customScenarios: [],
    selectedScenarioId: null,
    actionMode: 'add'
  },

  onLoad(options) {
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
      this._fetchRoomMembers();
      this._startStatePolling();
      return;
    }
    this._fetchHostStatus();
  },

  onShow() {
    if (this.data.roomId) {
      this._fetchRoomMembers({ silent: true });
    }
    if (this.data.isHost && !this.data.isWaiting) {
      this._loadScenarios();
    }
    if (this.data.isWaiting || this.data.isHost === false) {
      this._startStatePolling();
    }
  },

  onHide() {
    this._stopStatePolling();
  },

  onUnload() {
    this._stopStatePolling();
  },

  _loadScenarios() {
    const { modeId } = this.data;
    const scenarios = getScenariosForMode(modeId);
    const offlineScenario = scenarios.find((s) => s.isOffline || s.id === 'offline') || null;
    const customScenarios = scenarios
      .filter((s) => !s.isOffline && s.id !== 'offline')
      .map((item) => ({
        ...item,
        tags: buildScenarioTagsForMode(modeId, item.bg)
      }));
    this.setData({ scenarios, offlineScenario, customScenarios });
  },

  async _syncMembersFromResult(result) {
    if (!result || result.ok !== true) return;
    const avatarList = await buildAvatarListAsync(result.members || []);
    const me = avatarList.find((item) => item.isMe);
    this.setData({
      workshopName: result.workshopName || this.data.workshopName,
      avatarList,
      currentUser: me ? me.id : null
    });
  },

  async _fetchRoomMembers(opts = {}) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        await this._syncMembersFromResult(result);
      }
      return result;
    } catch (e) {
      if (!opts.silent) {
        console.warn('modeIndex fetchRoomMembers', e);
      }
      return null;
    }
  },

  async _fetchHostStatus() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      this.setData({ isHost: true });
      this._loadScenarios();
      return;
    }
    try {
      const result = await this._fetchRoomMembers();
      if (result && result.ok === true) {
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
    if (!roomId) return false;
    try {
      const data = { roomId, currentPage };
      if (selectedBG) data.selectedBG = selectedBG;
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

  _startStatePolling() {
    this._stopStatePolling();
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || getApp().globalData.roomId || '',
      intervalMs: 2000,
      followNavigation: true,
      onSnapshot(snapshot) {
        if (snapshot && snapshot.ok && snapshot.raw) {
          this._syncMembersFromResult(snapshot.raw);
        }
      }
    }).catch((e) => console.warn('modeIndex roomSession', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
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

  async _goAddScenario() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    const mode = this.data.modeId === 'partner' ? 'partner' : 'halliGalli';
    getApp().globalData.gameMode = mode;
    getApp().globalData.selectedBGSource = 'custom';
    if (roomId) {
      const ok = await this._updateRoomState('selectBG');
      if (!ok) {
        wx.showToast({ title: '同步房间失败，请重试', icon: 'none' });
        return;
      }
    }
    const query = roomId
      ? `?mode=${mode}&roomId=${encodeURIComponent(roomId)}`
      : `?mode=${mode}`;
    wx.navigateTo({
      url: `/pages/main-pages/selectBG/index${query}`
    });
  },

  async _confirmSelectedScenario() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }
    if (this._navPending) return;
    const scenario = (this.data.scenarios || []).find(
      (item) => item.id === this.data.selectedScenarioId
    );
    if (!scenario) {
      wx.showToast({ title: '请选择情境', icon: 'none' });
      return;
    }

    const app = getApp();
    app.globalData = app.globalData || {};
    app.globalData.selectedBGSource = scenario.type || 'case';
    const roomIdEnc = encodeURIComponent(roomId);
    this._navPending = true;

    try {
      // 线下情境：跳过情境填写，直接进入选玩家
      if (scenario.isOffline || scenario.id === 'offline') {
        const offlineMode = this.data.modeId === 'partner' ? 'partner' : 'halliGalli';
        app.globalData.gameMode = offlineMode;
        const ok = await this._updateRoomState('selectPlayer');
        if (!ok) {
          wx.showToast({ title: '同步房间失败，请重试', icon: 'none' });
          return;
        }
        wx.redirectTo({
          url: `/pages/main-pages/selectPlayer/index?roomId=${roomIdEnc}`
        });
        return;
      }

      if (!scenario.bg) {
        wx.showToast({ title: '情境数据无效', icon: 'none' });
        return;
      }

      // 脑暴大富翁（partnerMode）：确认情境页 → 选择问题
      if (this.data.modeId === 'partner') {
        app.globalData.selectedBG = { ...scenario.bg };
        app.globalData.gameMode = 'partner';
        const ok = await this._updateRoomState('confirmBG', app.globalData.selectedBG);
        if (!ok) {
          wx.showToast({ title: '同步房间失败，请重试', icon: 'none' });
          return;
        }
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
      const ok = await this._updateRoomState('selectPlayer', bg);
      if (!ok) {
        wx.showToast({ title: '同步房间失败，请重试', icon: 'none' });
        return;
      }
      wx.redirectTo({
        url: `/pages/main-pages/selectPlayer/index?roomId=${roomIdEnc}`
      });
    } finally {
      this._navPending = false;
    }
  },

  handleGoBack() {
    const roomId = this.data.roomId || '';
    const fallbackUrl = roomId
      ? `/pages/main-pages/brainstormMode/index?roomId=${encodeURIComponent(roomId)}`
      : '/pages/main-pages/brainstormMode/index';
    safeNavigateBack({
      expectedPrev: 'pages/main-pages/brainstormMode/index',
      fallbackUrl
    });
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
