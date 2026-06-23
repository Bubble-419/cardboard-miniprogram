const { saveHistoryScenario } = require('../../../utils/partnerScenarios');

const STEPS_WITH_PLATFORM = [
  { type: 'scene', label: '场景' },
  { type: 'user', label: '用户' },
  { type: 'platform', label: '平台' },
  { type: 'function', label: '功能' }
];

const STEPS_WITHOUT_PLATFORM = [
  { type: 'scene', label: '场景' },
  { type: 'user', label: '用户' },
  { type: 'function', label: '功能' }
];

Page({
  data: {
    includePlatform: false,
    steps: STEPS_WITHOUT_PLATFORM,
    currentStep: 0,
    bg: {
      scene: '',
      user: '',
      platform: '',
      function: ''
    },
    canConfirm: false
  },

  onLoad(options) {
    const mode = (options && options.mode) || getApp().globalData.gameMode || '';
    const includePlatform = mode === 'partner';
    const steps = includePlatform ? STEPS_WITH_PLATFORM : STEPS_WITHOUT_PLATFORM;

    if (options && options.roomId) {
      getApp().globalData.roomId = options.roomId;
    }
    if (includePlatform) {
      getApp().globalData.gameMode = 'partner';
    }

    this.setData({ includePlatform, steps, currentStep: 0 });
    this.updateCanConfirm();
    this._updateRoomState('selectBG');
  },

  async _updateRoomState(currentPage) {
    const roomId = getApp().globalData.roomId || '';
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

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  onSwiperChange(e) {
    this.setData({ currentStep: e.detail.current });
  },

  onTapStep(e) {
    const step = Number(e.currentTarget.dataset.step || 0);
    const maxStep = (this.data.steps || []).length - 1;
    if (step < 0 || step > maxStep) return;
    this.setData({ currentStep: step });
  },

  onNextCard() {
    const maxStep = (this.data.steps || []).length - 1;
    const next = Math.min(maxStep, this.data.currentStep + 1);
    this.setData({ currentStep: next });
  },

  onCardInput(e) {
    const { type, value } = e.detail || {};
    if (!type) return;
    const val = (value || '').trim();
    this.setData({
      bg: { ...this.data.bg, [type]: val }
    });
    this.updateCanConfirm();
  },

  updateCanConfirm() {
    const { scene, user, platform, function: func } = this.data.bg;
    const can = this.data.includePlatform
      ? !!(scene && user && platform && func)
      : !!(scene && user && func);
    this.setData({ canConfirm: can });
  },

  confirmBG() {
    if (!this.data.canConfirm) return;
    const app = getApp();
    app.globalData = app.globalData || {};
    const bg = { ...this.data.bg };
    if (!this.data.includePlatform) {
      delete bg.platform;
    }
    app.globalData.selectedBG = bg;

    if (this.data.includePlatform) {
      saveHistoryScenario(bg);
    }

    const roomId = app.globalData.roomId || '';
    const url = roomId
      ? `/pages/main-pages/selectPlayer/index?roomId=${encodeURIComponent(roomId)}`
      : '/pages/main-pages/selectPlayer/index';
    this._updateRoomState('selectPlayer');
    wx.redirectTo({ url });
  }
});
