const { goRoomPage, buildSpyPageUrl, openUrl, fetchRoomDataOrExit } = require('../../../utils/spyMode');
const { listLibraryCards, getLibraryGroupCount } = require('../../../utils/spyWordCardAssets');
const { SPY_PHASE } = require('../../../utils/spyGameState');
const { safeNavigateBack } = require('../../../utils/pageNavigate');

/** 分词开始后不允许查阅牌库 */
function isLibraryLocked(spyGame) {
  if (!spyGame || !spyGame.phase) return false;
  const phase = spyGame.phase;
  // 发言阶段可查阅牌库；投票/结果等阶段仍锁定
  return !(
    phase === SPY_PHASE.INTRO
    || phase === SPY_PHASE.SPEAK
    || phase === SPY_PHASE.SETTLE
    || phase === 'idle'
    || phase === 'lobby'
  );
}

Page({
  data: {
    roomId: '',
    groupCount: 0,
    cards: [],
    selectedWord: '',
    selectedCard: null,
    viewerOpen: false,
    locked: false
  },

  onLoad(options) {
    this._pageAlive = true;
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const cards = listLibraryCards();
    this.setData({
      roomId,
      groupCount: getLibraryGroupCount(),
      cards
    });
  },

  onShow() {
    this._pageAlive = true;
    this.checkLock();
  },

  onHide() {
    this._pageAlive = false;
  },

  onUnload() {
    this._pageAlive = false;
  },

  async checkLock() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    try {
      const result = await fetchRoomDataOrExit(roomId);
      if (!this._pageAlive || !result || result.ok !== true) return;
      const spyGame = result.roomState && result.roomState.spyGame;
      if (isLibraryLocked(spyGame)) {
        this.setData({ locked: true, viewerOpen: false });
        wx.showToast({ title: '对局中不可查阅牌库', icon: 'none' });
        setTimeout(() => {
          if (!this._pageAlive) return;
          wx.navigateBack({
            fail: () => {
              openUrl(buildSpyPageUrl('intro', roomId), { immediate: true, noReLaunch: true });
            }
          });
        }, 500);
      } else if (this._pageAlive) {
        this.setData({ locked: false });
      }
    } catch (e) {
      // 离线仍允许浏览本地牌库
    }
  },

  onTapCard(e) {
    if (this.data.locked) {
      wx.showToast({ title: '对局中不可查阅牌库', icon: 'none' });
      return;
    }
    const word = e.currentTarget.dataset.word;
    const card = (this.data.cards || []).find((c) => c.word === word);
    if (!card) return;
    this.setData({
      selectedWord: word,
      selectedCard: card,
      viewerOpen: true
    });
  },

  onCloseViewer() {
    this.setData({
      viewerOpen: false,
      selectedWord: '',
      selectedCard: null
    });
  },

  handleGoBack() {
    const roomId = this.data.roomId || '';
    safeNavigateBack({
      expectedPrev: 'packageSpy/pages/modeIndex/index',
      fallbackUrl: buildSpyPageUrl('intro', roomId)
    });
  },

  handleGoRoom() {
    this._pageAlive = false;
    goRoomPage(this.data.roomId);
  },

  noop() {}
});
