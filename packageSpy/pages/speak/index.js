const {
  fetchRoomDataOrExit,
  callSpyAction,
  captureSpyCommandContext,
  goRoomPage,
  buildAvatarList,
  withSpyRefreshGuard,
  startSpyRoomPoll,
  stopSpyRoomPoll,
  bumpSpyRoomSession
} = require('../../utils/spyMode');
const {
  getWordCardAssets,
  getLibraryGroupCount,
  listLibraryCards,
  listLibraryCategories
} = require('../../utils/spyWordCardAssets');
const {
  buildTiedNames,
  isTieReturnPending,
  showTieReturnModal
} = require('../../utils/spyTiePrompt');
const {
  runPageInteraction,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');

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

Page(withPageInteractionLock({
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
    libraryCategories: [],
    libraryCards: [],
    contentTab: 0,
    acting: false,
    isCurrentSpeaker: false,
    currentSpeakerName: '',
    currentSpeakerAvatar: '',
    questionRound: false,
    phaseTitle: '发言阶段',
    finishActionText: '我已完成发言',
    waitingHintPrefix: '当前发言',
    tieBreak: false,
    tiedNamesText: '',
    viewerOpen: false,
    identityCardFullscreenOpen: false,
    identityCardFullscreen: null,
    selectedWord: '',
    selectedCard: null,
    panelScrollY: true
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
      libraryCategories: listLibraryCategories().map((group) => ({
        ...group,
        collapsed: false
      })),
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
    if (this.data.identityCardFullscreenOpen) {
      this.setData({ identityCardFullscreenOpen: false, identityCardFullscreen: null });
    }
    this.stopPolling();
  },

  onUnload() {
    this._pageAlive = false;
    if (this._panelMeasureTimer) {
      clearTimeout(this._panelMeasureTimer);
      this._panelMeasureTimer = null;
    }
    this.stopPolling();
  },

  onResize() {
    this._applyLayoutMetrics();
    this.schedulePanelScrollMeasure();
  },

  startPolling() {
    startSpyRoomPoll(this, {
      onPollResult: (result) => this.refresh(result)
    });
  },

  stopPolling() {
    stopSpyRoomPoll(this);
  },

  async refresh(prefetchedResult) {
    const roomId = this.data.roomId;
    if (!roomId) return;
    await withSpyRefreshGuard(this, async () => {
      try {
        const result = (prefetchedResult && prefetchedResult.ok === true)
          ? prefetchedResult
          : await fetchRoomDataOrExit(roomId);
        if (!this._pageAlive || !result || result.ok !== true) return;

        const spyGame = result.roomState && result.roomState.spyGame;
        const nextCommandContext = spyGame && spyGame.phase === 'speak'
          ? captureSpyCommandContext(result)
          : null;
        const members = result.members || [];
        const avatarList = buildAvatarList(members);
        const currentSpeakerSeat = spyGame && spyGame.speakOrder
          && spyGame.speakOrder[spyGame.currentSpeakerIndex];
        const currentSpeaker = members.find((member) => Number(member.playerIndex) === Number(currentSpeakerSeat));
        const speakerKey = currentSpeaker
          ? (currentSpeaker.userId || String(currentSpeaker.playerIndex))
          : '';
        const speakerAvatarItem = speakerKey
          ? avatarList.find((item) => String(item.id) === String(speakerKey))
          : null;
        this.setData({
          avatarList,
          isCurrentSpeaker: !!(currentSpeaker && currentSpeaker.isMe),
          currentSpeakerName: currentSpeaker && currentSpeaker.nickName || '',
          currentSpeakerAvatar: (speakerAvatarItem && (speakerAvatarItem.avatar || speakerAvatarItem.avatarImage)) || ''
        }, () => {
          if (nextCommandContext) this._spyCommandContext = nextCommandContext;
        });
        if (!spyGame) return;

        if (isTieReturnPending(spyGame)) {
          showTieReturnModal(spyGame);
        }

        let myCard = this.data.myCard;
        if (!myCard) {
          const cardRes = await callSpyAction('getMyCard', { roomId });
          if (cardRes.ok && this._pageAlive) {
            myCard = cardRes.card;
          }
        }

        const myWord = (myCard && myCard.word) || '';
        const assets = getWordCardAssets(myWord);
        const questionRound = spyGame.questionRound === true
          || (result.view && result.view.session
            && result.view.session.workflow
            && result.view.session.workflow.step === 'SPY_QUESTION');
        const nextCard = {
          myCard,
          myWord,
          myBlurb: (myCard && myCard.blurb) || '',
          questionRound,
          phaseTitle: questionRound ? '提问阶段' : '发言阶段',
          finishActionText: questionRound ? '我已提问完毕' : '我已完成发言',
          waitingHintPrefix: questionRound ? '当前提问' : '当前发言',
          tieBreak: spyGame.tieBreak === true,
          tiedNamesText: buildTiedNames(spyGame).join('、')
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
    this.setContentTab(tab);
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
      this.setContentTab(1);
    } else if (dx > 0 && this.data.contentTab === 1) {
      this.setContentTab(0);
    }
  },

  setContentTab(tab) {
    this.setData({
      contentTab: tab,
      panelScrollY: tab === 0
    }, () => this.schedulePanelScrollMeasure());
  },

  schedulePanelScrollMeasure() {
    if (this._panelMeasureTimer) {
      clearTimeout(this._panelMeasureTimer);
    }
    this._panelMeasureTimer = setTimeout(() => {
      this._panelMeasureTimer = null;
      this.measurePanelScroll();
    }, 50);
  },

  measurePanelScroll() {
    if (!this._pageAlive) return;
    if (this.data.contentTab !== 1) {
      if (!this.data.panelScrollY) this.setData({ panelScrollY: true });
      return;
    }
    const q = this.createSelectorQuery();
    q.select('.card-scroll').boundingClientRect();
    q.select('#rulesPanel').boundingClientRect();
    q.exec((res) => {
      if (!this._pageAlive) return;
      const box = res && res[0];
      const content = res && res[1];
      if (!box || !content) return;
      const needScroll = content.height > box.height + 1;
      if (needScroll !== this.data.panelScrollY) {
        this.setData({ panelScrollY: needScroll });
      }
    });
  },

  onToggleLibraryCategory(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : '';
    if (!id) return;
    const libraryCategories = (this.data.libraryCategories || []).map((group) => (
      group.id === id
        ? { ...group, collapsed: !group.collapsed }
        : group
    ));
    this.setData({ libraryCategories });
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

  onOpenIdentityCardFullscreen(e) {
    if (!this.data.cardReady || !this.data.myWord) return;
    const detail = (e && e.detail) || {};
    this.setData({
      identityCardFullscreenOpen: true,
      identityCardFullscreen: {
        word: this.data.myWord,
        skipBack: false,
        initialCardState: detail.cardState || 'assignedWord',
        backSrc: this.data.cardBackSrc || '',
        assignedWordSrc: this.data.assignedWordSrc || '',
        assignedWordFallbackSrc: this.data.assignedWordFallbackSrc || '',
        word1Src: this.data.word1Src || '',
        word1FallbackSrc: this.data.word1FallbackSrc || ''
      }
    });
  },

  onOpenLibraryCardFullscreen(e) {
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
      identityCardFullscreenOpen: true,
      identityCardFullscreen: {
        word: card.word || this.data.selectedWord || '',
        skipBack: true,
        initialCardState: detail.cardState || 'assignedWord',
        backSrc: '',
        assignedWordSrc: card.assignedWordSrc || '',
        assignedWordFallbackSrc: card.assignedWordFallbackSrc || '',
        word1Src: card.word1Src || '',
        word1FallbackSrc: card.word1FallbackSrc || ''
      }
    });
  },

  onCloseIdentityCardFullscreen() {
    if (!this.data.identityCardFullscreenOpen) return;
    this.setData({ identityCardFullscreenOpen: false, identityCardFullscreen: null });
  },
  onFinishSpeak() {
    return runPageInteraction(this, () => this._finishSpeak(), {
      loadingText: '正在结束发言…'
    });
  },

  async _finishSpeak() {
    if (!this.data.isCurrentSpeaker || this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('finishSpeak', {
        roomId: this.data.roomId,
        context: this._spyCommandContext
      });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '操作失败', icon: 'none', duration: 2500 });
        return;
      }
      bumpSpyRoomSession();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
    } finally {
      if (this._pageAlive) this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    return runPageInteraction(this, async () => {
      this._pageAlive = false;
      if (typeof this.stopPolling === 'function') this.stopPolling();
      await goRoomPage(this.data.roomId);
    }, { loadingText: '正在返回房间…' });
  },

  noop() {}
}, [
  'onTapContentTab',
  'onPanelTouchStart',
  'onPanelTouchEnd',
  'onToggleLibraryCategory',
  'onTapLibraryCard',
  'onCloseViewer',
  'onOpenIdentityCardFullscreen',
  'onOpenLibraryCardFullscreen',
  'onCloseIdentityCardFullscreen',
  'onFinishSpeak',
  'handleGoRoom'
]));
