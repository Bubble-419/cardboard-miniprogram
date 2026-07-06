const {
  getSceneUI,
  resolveSubScreenNavigation,
  shouldSkipStaleSubScreenRedirect
} = require('../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');

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
      followSubScreenRoomPoll(result, roomId, {
        beforeNavigate: (pollResult, page) => {
          const nav = resolveSubScreenNavigation(page, pollResult.roomState, roomId);
          if (!nav) return true;
          if (nav.action === 'await') {
            this.applyScene(nav.scene);
            return true;
          }
          if (nav.action === 'redirect' && shouldSkipStaleSubScreenRedirect(page)) {
            return true;
          }
          return false;
        }
      });
    }).catch((e) => console.warn('subAwait checkRoomState', e));
  },

  startStateCheck() {
    if (this.stateCheckTimer) clearInterval(this.stateCheckTimer);
    this.checkRoomState();
    this.stateCheckTimer = setInterval(() => this.checkRoomState(), 1500);
  }
});
