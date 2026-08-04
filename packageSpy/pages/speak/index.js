const {
  fetchRoomDataOrExit,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  buildSpyPageUrl,
  openUrl,
  withSpyRefreshGuard
} = require('../../../utils/spyMode');
const { followSpyRoomState } = require('../../../utils/spyFollow');
const {
  getWordCardAssets,
  getLibraryGroupCount,
  listLibraryCards
} = require('../../../utils/spyWordCardAssets');

const SWIPE_THRESHOLD_PX = 48;

function getWindowMetrics() {
  try {
    const sys = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    return {
      windowWidth: (sys && sys.windowWidth) || 375,
      statusBarHeight: (sys && sys.statusBarHeight) || 20,
      safeBottom: (sys && sys.safeAreaInsets && sys.safeAreaInsets.bottom)
        || (sys && sys.screenHeight && sys.safeArea
          ? Math.max(0, sys.screenHeight - sys.safeArea.bottom)
          : 0)
    };
  } catch (e) {
    return { windowWidth: 375, statusBarHeight: 20, safeBottom: 0 };
  }
}

Page({
  data: {
    roomId: '',
    compactMode: false,
    singleCol: false,
    avatarList: [],
    myCard: null,
    myWord: '',
    myBlurb: '',
    cardBackSrc: '',
    assignedWordSrc: '',
    assignedWordFallbackSrc: '',
    word1Src: '',
    word1FallbackSrc: '',
    cardReady: false,
    libraryGroupCount: 0,
    libraryCards: [],
    contentTab: 0,
    acting: false,
    isHost: false,
    tieBreak: false,
    viewerOpen: false,
    selectedWord: '',
    selectedCard: null
  },

  _applyLayoutMetrics() {
    const { windowWidth } = getWindowMetrics();
    this.setData({
      compactMode: windowWidth < 340,
      singleCol: windowWidth < 300
    });
  },

  onLoad(options) {
    this._pageAlive = true;
    this._applyLayoutMetrics();
    this.setData({
      roomId: (options && options.roomId) || getApp().globalData.roomId || '',
      libraryGroupCount: getLibraryGroupCount(),
      libraryCards: listLibraryCards(),
      contentTab: 0
    });
  },

  onShow() {
    this._pageAlive = true;
    this._applyLayoutMetrics();
    this.refresh();
    this.startPolling();
  },

  onHide() {
    this._pageAlive = false;
    this.stopPolling();
  },

  onUnload() {
    this._pageAlive = false;
    this.stopPolling();
  },

  onResize() {
    this._applyLayoutMetrics();
  },

  startPolling() {
    this.stopPolling();
    this._pollTimer = setInterval(() => {
      if (this._pageAlive === false) return;
      this.refresh();
    }, 800);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  async refresh() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    await withSpyRefreshGuard(this, async () => {
      try {
        const result = await fetchRoomDataOrExit(roomId);
        if (!this._pageAlive || !result || result.ok !== true) return;

        followSpyRoomState(result, roomId, {
          stayOnPage: 'spyspeak',
          allowHost: true,
          // 投票已开始：必须全员进投票页，覆盖大厅停留锁
          force: !!(result.roomState
            && result.roomState.spyGame
            && result.roomState.spyGame.phase === 'vote')
        });

        const spyGame = result.roomState && result.roomState.spyGame;
        const members = result.members || [];
        const isHost = result.isHost === true;
        this.setData({
          avatarList: buildAvatarList(members),
          isHost
        });
        if (!spyGame) return;

        let myCard = this.data.myCard;
        if (!myCard) {
          const cardRes = await callSpyAction('getMyCard', { roomId });
          if (cardRes.ok && this._pageAlive) {
            myCard = cardRes.card;
          }
        }

        const myWord = (myCard && myCard.word) || '';
        const assets = getWordCardAssets(myWord);
        const nextCard = {
          myCard,
          myWord,
          myBlurb: (myCard && myCard.blurb) || '',
          tieBreak: spyGame.tieBreak === true
        };
        const cardReady = !!(myWord && (assets.assignedWordSrc || assets.assignedWordFallbackSrc));
        if (
          myWord !== this.data.myWord
          || assets.assignedWordSrc !== this.data.assignedWordSrc
          || !this.data.cardReady
        ) {
          nextCard.cardBackSrc = assets.backSrc;
          nextCard.assignedWordSrc = assets.assignedWordSrc;
          nextCard.assignedWordFallbackSrc = assets.assignedWordFallbackSrc;
          nextCard.word1Src = assets.word1Src;
          nextCard.word1FallbackSrc = assets.word1FallbackSrc;
          nextCard.cardReady = cardReady;
        }

        this.setData(nextCard);
      } catch (e) {
        console.warn('spy speak refresh', e);
      }
    });
  },

  onTapContentTab(e) {
    const tab = Number(e.currentTarget.dataset.tab);
    if (!Number.isFinite(tab) || tab === this.data.contentTab) return;
    this.setData({ contentTab: tab });
  },

  onPanelTouchStart(e) {
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    this._panelTouchX = t.clientX;
    this._panelTouchY = t.clientY;
  },

  onPanelTouchEnd(e) {
    const startX = this._panelTouchX;
    const startY = this._panelTouchY;
    this._panelTouchX = null;
    this._panelTouchY = null;
    if (startX == null) return;

    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.2) return;

    if (dx < 0 && this.data.contentTab === 0) {
      this.setData({ contentTab: 1 });
    } else if (dx > 0 && this.data.contentTab === 1) {
      this.setData({ contentTab: 0 });
    }
  },

  onTapLibraryCard(e) {
    const word = e.currentTarget.dataset.word;
    const card = (this.data.libraryCards || []).find((c) => c.word === word);
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

  async onStartVote() {
    if (!this.data.isHost || this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('startVote', { roomId: this.data.roomId });
      if (result.ok !== true) {
        const hint = result.errCode === 'DEPRECATED'
          ? '请重新上传云函数 roomCommand 后再试'
          : (result.errMsg || '操作失败');
        wx.showToast({ title: hint, icon: 'none', duration: 2500 });
        return;
      }
      // 房主立即进投票页；成员由发言页轮询 follow 同步
      try {
        const { clearSpyLobbyStay, clearSpyFollowLock } = require('../../../utils/spyFollow');
        const { clearPendingNavigation } = require('../../../utils/pageNavigate');
        clearSpyLobbyStay();
        clearSpyFollowLock();
        clearPendingNavigation();
      } catch (e) {
        // ignore
      }
      this._pageAlive = false;
      this.stopPolling();
      openUrl(buildSpyPageUrl('vote', this.data.roomId), {
        immediate: true,
        noReLaunch: true
      });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
    } finally {
      if (this._pageAlive) this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    this._pageAlive = false;
    if (typeof this.stopPolling === 'function') this.stopPolling();
    goRoomPage(this.data.roomId);
  },

  noop() {}
});
