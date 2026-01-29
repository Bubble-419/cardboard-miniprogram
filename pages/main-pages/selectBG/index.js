Page({
  data: {
    currentStep: 0,
    bg: {
      scene: '',
      user: '',
      platform: '',
      function: ''
    },
    canConfirm: false,

    showInput: false,
    editingType: 'scene',
    inputTitle: '场景',
    inputValue: ''
  },

  onLoad() {
    this.updateCanConfirm();
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  onSwiperChange(e) {
    this.setData({ currentStep: e.detail.current });
  },

  onNextCard() {
    const next = Math.min(3, this.data.currentStep + 1);
    this.setData({ currentStep: next });
  },

  onTapInput(e) {
    const { type } = e.detail || {};
    const map = {
      scene: '场景',
      user: '用户',
      platform: '平台',
      function: '功能'
    };
    const title = map[type] || '情境';
    this.setData({
      showInput: true,
      editingType: type,
      inputTitle: title,
      inputValue: this.data.bg[type] || ''
    });
  },

  closeInput() {
    this.setData({ showInput: false });
  },

  onInputChange(e) {
    this.setData({ inputValue: e.detail.value });
  },

  saveInput() {
    const type = this.data.editingType;
    const val = (this.data.inputValue || '').trim();
    this.setData({
      bg: { ...this.data.bg, [type]: val },
      showInput: false
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
    wx.redirectTo({ url: '/pages/main-pages/selectProblem/index' });
  }
});

