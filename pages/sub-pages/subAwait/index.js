const {
  getSceneUI,
  resolveSubScreenNavigation
} = require('../../../utils/subAwaitRoutes');
const {
  bindPageToRoomSession,
  unbindPageFromRoomSession,
  getRoomPageSnapshot
} = require('../../../modules/room-session/index');

Page({
  data: {
    roomId: '',
    countdown: 5,
    scene: 'bg',
    navbarTitle: '',
    mainText: '',
    mainTextLines: [],
    subText: '等待中...',
    subTextLine1: '',
    subTextLine2: '',
    statusText: '正在等待中...',
    multiLine: false,
    useHeroLayout: true
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (roomId) {
      getApp().globalData.roomId = roomId;
    }

    const initialScene = (options && options.scene) || 'bg';
    this.applyScene(initialScene);
    this.setData({ roomId });
    if (!this.data.useHeroLayout) {
      this.startCountdown();
    }
    this.startStateCheck();
  },

  onShow() {
    this.checkRoomState();
  },

  onUnload() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    unbindPageFromRoomSession(this);
  },

  applyScene(scene) {
    const ui = getSceneUI(scene);
    if (
      this.data.scene === scene
      && this.data.mainText === ui.mainText
      && this.data.useHeroLayout === !!ui.useHeroLayout
    ) {
      return;
    }
    this.setData({
      scene,
      navbarTitle: ui.navbarTitle,
      mainText: ui.mainText,
      mainTextLines: ui.mainTextLines,
      subText: ui.subText,
      subTextLine1: ui.subTextLine1 || '',
      subTextLine2: ui.subTextLine2 || '',
      statusText: ui.statusText || '正在等待中...',
      multiLine: ui.multiLine,
      useHeroLayout: ui.useHeroLayout === true
    });
  },

  startCountdown() {
    if (this.data.useHeroLayout) return;
    this.countdownTimer = setInterval(() => {
      const count = this.data.countdown > 0 ? this.data.countdown - 1 : 5;
      this.setData({ countdown: count || 5 });
    }, 1000);
  },

  async checkRoomState() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;

    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      const page = result && result.roomState && result.roomState.currentPage;
      const nav = resolveSubScreenNavigation(page, result && result.roomState, roomId);
      if (nav && nav.action === 'await') this.applyScene(nav.scene);
    } catch (e) {
      console.warn('subAwait checkRoomState', e);
    }
  },

  startStateCheck() {
    unbindPageFromRoomSession(this);
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || getApp().globalData.roomId || '',
      followNavigation: true,
      onSnapshot(snapshot) {
        const page = snapshot && snapshot.roomState && snapshot.roomState.currentPage;
        const nav = resolveSubScreenNavigation(page, snapshot && snapshot.roomState, this.data.roomId);
        if (nav && nav.action === 'await') this.applyScene(nav.scene);
      }
    }).catch((e) => console.warn('subAwait roomSession', e));
  }
});
