'use strict';

// 屏幕控制器由所属页面创建；展示组件不持有房间连接。
module.exports = function createCardLibraryScreen() {
const { goRoomPage, buildSpyPageUrl, fetchRoomDataOrExit } = require('../../utils/spyMode');
const {
  listLibraryCards,
  listLibraryCategories,
  getLibraryGroupCount
} = require('../../utils/spyWordCardAssets');
const { SPY_PHASE } = require('../../utils/spyGameState');
const { safeNavigateBack } = require('../../../utils/pageNavigate');
const {
  runPageInteraction,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');

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

return withPageInteractionLock({
  data: {
    roomId: '',
    groupCount: 0,
    categories: [],
    cards: [],
    selectedWord: '',
    selectedCard: null,
    viewerOpen: false,
    cardFullscreenOpen: false,
    cardFullscreen: null,
    locked: false
  },

  onLoad(options) {
    this._pageAlive = true;
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const categories = listLibraryCategories().map((group) => ({
      ...group,
      collapsed: false
    }));
    const cards = listLibraryCards();
    this.setData({
      roomId,
      groupCount: getLibraryGroupCount(),
      categories,
      cards
    });
  },

  onToggleCategory(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : '';
    if (!id) return;
    const categories = (this.data.categories || []).map((group) => (
      group.id === id
        ? { ...group, collapsed: !group.collapsed }
        : group
    ));
    this.setData({ categories });
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
        if (this._localScreenHost) {
          await this._localScreenHost.close(this);
          return;
        }
        await safeNavigateBack({ fallbackUrl: buildSpyPageUrl('intro', roomId) }, this);
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
      selectedCard: null,
      cardFullscreenOpen: false,
      cardFullscreen: null
    });
  },

  onOpenCardFullscreen(e) {
    const card = this.data.selectedCard;
    if (!card) return;
    const detail = (e && e.detail) || {};
    const hasFace = !!(
      card.assignedWordSrc
      || card.assignedWordFallbackSrc
      || card.word1Src
      || card.word1FallbackSrc
    );
    if (!hasFace) return;
    this.setData({
      cardFullscreenOpen: true,
      cardFullscreen: {
        word: card.word || this.data.selectedWord || '',
        initialCardState: detail.cardState || 'assignedWord',
        assignedWordSrc: card.assignedWordSrc || '',
        assignedWordFallbackSrc: card.assignedWordFallbackSrc || '',
        word1Src: card.word1Src || '',
        word1FallbackSrc: card.word1FallbackSrc || ''
      }
    });
  },

  onCloseCardFullscreen() {
    if (!this.data.cardFullscreenOpen) return;
    this.setData({ cardFullscreenOpen: false, cardFullscreen: null });
  },

  handleGoBack() {
    return runPageInteraction(this, async () => {
      const roomId = this.data.roomId || '';
      return safeNavigateBack({
        expectedPrev: 'packageSpy/pages/modeIndex/index',
        fallbackUrl: buildSpyPageUrl('intro', roomId)
      }, this);
    }, { loadingText: '正在返回…' });
  },

  handleGoRoom() {
    return runPageInteraction(this, async () => {
      this._pageAlive = false;
      await goRoomPage(this.data.roomId);
    }, { loadingText: '正在返回房间…' });
  },

  noop() {}
}, [
  'onTapCard',
  'onToggleCategory',
  'onCloseViewer',
  'onOpenCardFullscreen',
  'onCloseCardFullscreen',
  'handleGoBack',
  'handleGoRoom'
]);
};
