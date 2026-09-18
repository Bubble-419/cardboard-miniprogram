const {
  getSceneUI,
  sceneFromWorkflowStep,
  sceneFromMemberView,
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

    const initialScene = (options && options.scene)
      || sceneFromWorkflowStep(options && options.phase)
      || 'bg';
    this.applyScene(initialScene);
    this.setData({ roomId });
    this.startStateCheck();
  },

  onShow() {
    this.checkRoomState();
  },

  onUnload() {
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
      useHeroLayout: true
    });
  },

  _sceneFromSnapshot(snapshot) {
    const routeName = snapshot && snapshot.view && snapshot.view.route && snapshot.view.route.name;
    // 已经离开等待页时不要再按默认 scene=bg 刷情境空状态，否则会和跟随跳转抢 setData。
    if (routeName && routeName !== 'subAwait') return '';
    const page = snapshot && snapshot.roomState && snapshot.roomState.currentPage;
    const nav = resolveSubScreenNavigation(page, snapshot && snapshot.roomState, this.data.roomId);
    return sceneFromMemberView(snapshot && snapshot.view)
      || ((nav && nav.action === 'await' && nav.scene) || '');
  },

  async checkRoomState() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;

    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      const scene = this._sceneFromSnapshot(result);
      if (scene) this.applyScene(scene);
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
        const scene = this._sceneFromSnapshot(snapshot);
        if (scene) this.applyScene(scene);
      }
    }).catch((e) => console.warn('subAwait roomSession', e));
  }
});
