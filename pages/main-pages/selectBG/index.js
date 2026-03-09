Page({
  data: {
    currentStep: 0,
    bg: {
      scene: '',
      user: '',
      platform: '',
      function: ''
    },
    canConfirm: false
  },

  onLoad() {
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
    this.setData({ currentStep: step });
  },

  onNextCard() {
    const next = Math.min(3, this.data.currentStep + 1);
    this.setData({ currentStep: next });
  },

  onCardInput(e) {
    const { type, value } = e.detail || {};
    if (!type) return;
    const val = (value || '').trim();
    this.setData({
      bg: { ...this.data.bg, [type]: val },
    });
    this.updateCanConfirm();
  },

  updateCanConfirm() {
    const { scene, user, platform, function: func } = this.data.bg;
    const can = !!(scene && user && platform && func);
    this.setData({ canConfirm: can });
  },

  confirmBG() {
    if (!this.data.canConfirm) return;
    const app = getApp();
    app.globalData = app.globalData || {};
    app.globalData.selectedBG = { ...this.data.bg };
    this._updateRoomState('selectProblem');
    wx.redirectTo({ url: '/pages/main-pages/selectProblem/index' });
  }
});

