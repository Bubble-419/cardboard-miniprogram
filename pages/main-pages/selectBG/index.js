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

const { goRoomPage } = require('../../../utils/goRoomPage');
const { safeNavigateBack } = require('../../../utils/pageNavigate');
const {
  isPageInteractionLocked,
  runPageInteraction,
  runPageNavigation
} = require('../../../utils/pageInteractionLock');

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
    canConfirm: false,
    avatarList: [],
    interactionLocked: false,
    interactionLoading: false,
    interactionLoadingText: '加载中…'
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

    // 从 confirmBG 点卡跳回时：恢复已填数据 + 定位到对应卡片
    const savedBG = getApp().globalData.selectedBG || {};
    const bg = {
      scene:    savedBG.scene    || '',
      user:     savedBG.user     || '',
      platform: savedBG.platform || '',
      function: savedBG.function || ''
    };
    const stepParam = parseInt((options && options.step) || '0', 10);
    const currentStep = (stepParam >= 0 && stepParam < steps.length) ? stepParam : 0;

    this.setData({ includePlatform, steps, currentStep, bg });
    this.updateCanConfirm();
    this._updateRoomState('selectBG');
  },

  async _updateRoomState(currentPage) {
    const roomId = getApp().globalData.roomId || '';
    if (!roomId) return false;
    try {
      const res = await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: { roomId, currentPage }
      });
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('updateRoomState', e);
      return false;
    }
  },

  goBack() {
    if (isPageInteractionLocked(this)) return;
    return runPageInteraction(this, async () => {
      const roomId = getApp().globalData.roomId || '';
      const fallbackUrl = roomId
        ? `/pages/main-pages/modeIndex/index?roomId=${encodeURIComponent(roomId)}&modeId=partner`
        : '/pages/main-pages/modeIndex/index?modeId=partner';
      safeNavigateBack({
        expectedPrev: [
          'pages/main-pages/modeIndex/index',
          'pages/main-pages/partnerMode/confirmBG/index'
        ],
        fallbackUrl
      });
    }, { loadingText: '正在返回…' });
  },

  handleGoRoom() {
    if (isPageInteractionLocked(this)) return;
    return runPageInteraction(this, () => goRoomPage(getApp().globalData.roomId), {
      loadingText: '正在返回房间…'
    });
  },

  onSwiperChange(e) {
    if (isPageInteractionLocked(this)) return;
    this.setData({ currentStep: e.detail.current });
  },

  onTapStep(e) {
    if (isPageInteractionLocked(this)) return;
    const step = Number(e.currentTarget.dataset.step || 0);
    const maxStep = (this.data.steps || []).length - 1;
    if (step < 0 || step > maxStep) return;
    this.setData({ currentStep: step });
  },

  onNextCard() {
    if (isPageInteractionLocked(this)) return;
    const maxStep = (this.data.steps || []).length - 1;
    const next = Math.min(maxStep, this.data.currentStep + 1);
    this.setData({ currentStep: next });
  },

  onCardInput(e) {
    if (isPageInteractionLocked(this)) return;
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

  async confirmBG() {
    if (isPageInteractionLocked(this)) return;
    if (!this.data.canConfirm) return;
    if (this._confirmPending) return;
    return runPageNavigation(this, async () => {
      const app = getApp();
      app.globalData = app.globalData || {};
      const bg = { ...this.data.bg };
      if (!this.data.includePlatform) {
        delete bg.platform;
      }
      app.globalData.selectedBG = bg;
      app.globalData.selectedBGSource = 'custom';

      const roomId = app.globalData.roomId || '';
      this._confirmPending = true;
      try {
        if (roomId) {
          try {
            const res = await wx.cloud.callFunction({
              name: 'updateRoomState',
              data: {
                roomId,
                currentPage: this.data.includePlatform ? 'confirmBG' : 'selectPlayer',
                selectedBG: bg
              }
            });
            const result = (res && res.result) || {};
            if (result.ok !== true) {
              wx.showToast({ title: result.errMsg || '同步房间失败，请重试', icon: 'none' });
              return;
            }
          } catch (e) {
            console.warn('updateRoomState selectedBG', e);
            wx.showToast({ title: '同步房间失败，请重试', icon: 'none' });
            return;
          }
        }

        if (this.data.includePlatform) {
          const query = roomId
            ? `?roomId=${encodeURIComponent(roomId)}`
            : '';
          return {
            method: 'redirectTo',
            url: `/pages/main-pages/partnerMode/confirmBG/index${query}`
          };
        }

        const url = roomId
          ? `?roomId=${encodeURIComponent(roomId)}`
          : '';
        return {
          method: 'redirectTo',
          url: `/pages/main-pages/selectPlayer/index${url}`
        };
      } finally {
        this._confirmPending = false;
      }
    }, {
      loadingText: '正在确认情境…'
    });
  }
});
