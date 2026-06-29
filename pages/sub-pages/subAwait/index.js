const {
  getSceneUI,
  resolveSubScreenNavigation,
  navigateByRoomState
} = require('../../../utils/subAwaitRoutes');

Page({
  data: {
    roomId: '',
    countdown: 5,
    scene: 'bg',
    navbarTitle: '',
    mainText: '',
    mainTextLines: [],
    subText: '等待中...',
    multiLine: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (roomId) {
      getApp().globalData.roomId = roomId;
    }

    const initialScene = (options && options.scene) || 'bg';
    this.applyScene(initialScene);
    this.setData({ roomId });
    this.startCountdown();
    this.startStateCheck();
  },

  onShow() {
    this.checkRoomState();
  },

  onUnload() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.stateCheckTimer) clearInterval(this.stateCheckTimer);
  },

  applyScene(scene) {
    const ui = getSceneUI(scene);
    if (this.data.scene === scene && this.data.mainText === ui.mainText) return;
    this.setData({
      scene,
      navbarTitle: ui.navbarTitle,
      mainText: ui.mainText,
      mainTextLines: ui.mainTextLines,
      subText: ui.subText,
      multiLine: ui.multiLine
    });
  },

  startCountdown() {
    this.countdownTimer = setInterval(() => {
      const count = this.data.countdown > 0 ? this.data.countdown - 1 : 5;
      this.setData({ countdown: count || 5 });
    }, 1000);
  },

  checkRoomState() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;

    wx.cloud.callFunction({
      name: 'getAddPlayerData',
      data: { roomId }
    }).then((res) => {
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.roomState) return;

      const page = result.roomState.currentPage || '';
      const nav = resolveSubScreenNavigation(page, result.roomState, roomId);
      if (!nav) return;

      if (nav.action === 'redirect') {
        navigateByRoomState(page, result.roomState, roomId);
      } else if (nav.action === 'await') {
        this.applyScene(nav.scene);
      }
    }).catch((e) => console.warn('subAwait checkRoomState', e));
  },

  startStateCheck() {
    if (this.stateCheckTimer) clearInterval(this.stateCheckTimer);
    this.checkRoomState();
    this.stateCheckTimer = setInterval(() => this.checkRoomState(), 1500);
  }
});
