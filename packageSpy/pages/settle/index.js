const {
  fetchRoomDataOrExit,
  callSpyAction,
  captureSpyCommandContext,
  goRoomPage,
  buildSpyAvatarList,
  buildSpyRevealPlayers,
  winnerLabel,
  withSpyRefreshGuard,
  startSpyRoomPoll,
  stopSpyRoomPoll,
  bumpSpyRoomSession
} = require('../../utils/spyMode');
const {
  getWordCardAssets,
  listLibraryCards
} = require('../../utils/spyWordCardAssets');
const {
  runPageInteraction,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');

function buildGamePairCards(civilianWord, spyWord) {
  const libraryByWord = {};
  listLibraryCards().forEach((card) => {
    if (card && card.word) libraryByWord[card.word] = card;
  });

  return [
    { word: civilianWord, roleTag: '平民词' },
    { word: spyWord, roleTag: '卧底词' }
  ].filter((item) => item.word).map((item) => {
    const fromLibrary = libraryByWord[item.word] || {};
    const assets = getWordCardAssets(item.word);
    return {
      word: item.word,
      displayName: fromLibrary.displayName || item.word,
      roleTag: item.roleTag,
      blurb: fromLibrary.blurb || '',
      assignedWordSrc: assets.assignedWordSrc,
      assignedWordFallbackSrc: assets.assignedWordFallbackSrc,
      word1Src: assets.word1Src,
      word1FallbackSrc: assets.word1FallbackSrc
    };
  });
}

Page(withPageInteractionLock({
  data: {
    roomId: '',
    avatarList: [],
    winnerSide: '',
    winnerText: '',
    civilianWord: '',
    spyWord: '',
    revealPlayers: [],
    gamePairCards: [],
    isHost: false,
    acting: false,
    viewerOpen: false,
    selectedCardIndex: 0,
    selectedCard: null,
    cardFullscreenOpen: false,
    cardFullscreen: null
  },

  onLoad(options) {
    this._pageAlive = true;
    this.setData({
      roomId: (options && options.roomId) || getApp().globalData.roomId || ''
    });
  },

  onShow() {
    this._pageAlive = true;
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

        const spyGame = (result.roomState && result.roomState.spyGame) || {};
        const nextCommandContext = spyGame.phase === 'settle'
          ? captureSpyCommandContext(result)
          : null;
        const winnerSide = spyGame.winnerSide || '';
        const revealPlayers = buildSpyRevealPlayers(spyGame);
        const civilianWord = spyGame.civilianWord || '';
        const spyWord = spyGame.spyWord || '';
        const gamePairCards = buildGamePairCards(civilianWord, spyWord);

        const patch = {
          avatarList: buildSpyAvatarList(result.members || [], spyGame.players),
          isHost: result.isHost === true,
          winnerSide,
          winnerText: winnerLabel(winnerSide) || '本局结束',
          civilianWord,
          spyWord,
          revealPlayers,
          gamePairCards
        };

        if (this.data.viewerOpen) {
          const nextIndex = Math.min(
            this.data.selectedCardIndex || 0,
            Math.max(gamePairCards.length - 1, 0)
          );
          patch.selectedCardIndex = nextIndex;
          patch.selectedCard = gamePairCards[nextIndex] || null;
          if (!patch.selectedCard) {
            patch.viewerOpen = false;
            patch.selectedCardIndex = 0;
          }
        }

        this.setData(patch, () => {
          if (nextCommandContext) this._spyCommandContext = nextCommandContext;
        });
      } catch (e) {
        console.warn('spy settle refresh', e);
      }
    });
  },

  onTapRevealWord(e) {
    const word = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.word
      : '';
    if (!word) return;
    const cards = this.data.gamePairCards || [];
    let index = cards.findIndex((card) => card.word === word);
    if (index < 0) {
      const rebuilt = buildGamePairCards(
        this.data.civilianWord,
        this.data.spyWord
      );
      index = rebuilt.findIndex((card) => card.word === word);
      if (index < 0) return;
      this.setData({
        gamePairCards: rebuilt,
        selectedCardIndex: index,
        selectedCard: rebuilt[index],
        viewerOpen: true
      });
      return;
    }
    this.setData({
      selectedCardIndex: index,
      selectedCard: cards[index],
      viewerOpen: true
    });
  },

  onCloseViewer() {
    this.setData({
      viewerOpen: false,
      selectedCard: null,
      selectedCardIndex: 0
    });
  },

  onViewerHorizontalSwipe(e) {
    const direction = e && e.detail ? e.detail.direction : '';
    const cards = this.data.gamePairCards || [];
    if (cards.length < 2) return;
    const current = this.data.selectedCardIndex || 0;
    const delta = direction === 'left' ? 1 : direction === 'right' ? -1 : 0;
    if (!delta) return;
    const next = (current + delta + cards.length) % cards.length;
    if (next === current) return;
    this.setData({
      selectedCardIndex: next,
      selectedCard: cards[next]
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
        word: card.word || '',
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

  onRestart() {
    return runPageInteraction(this, () => this._restart(), {
      loadingText: '正在准备新一局…'
    });
  },

  async _restart() {
    if (this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('restart', {
        roomId: this.data.roomId,
        context: this._spyCommandContext
      });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      bumpSpyRoomSession();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  onFinishSession() {
    return runPageInteraction(this, () => this._finishSession(), {
      loadingText: '正在结束本次游戏…'
    });
  },

  async _finishSession() {
    if (this.data.acting || !this.data.isHost) return;
    this.setData({ acting: true });
    try {
      const completed = await callSpyAction('complete', {
        roomId: this.data.roomId,
        context: this._spyCommandContext
      });
      if (!completed || completed.ok !== true) {
        wx.showToast({ title: completed && completed.errMsg || '结束失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      const returned = await callSpyAction('returnToLobby', {
        roomId: this.data.roomId,
        context: this._spyCommandContext
      });
      if (!returned || returned.ok !== true) {
        wx.showToast({ title: returned && returned.errMsg || '返回房间失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      this._pageAlive = false;
      this.stopPolling();
      await goRoomPage(this.data.roomId);
    } catch (e) {
      wx.showToast({ title: e && (e.errMsg || e.message) || '结束失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    return runPageInteraction(this, async () => {
      this._pageAlive = false;
      if (typeof this.stopPolling === 'function') this.stopPolling();
      await goRoomPage(this.data.roomId);
    }, { loadingText: '正在返回房间…' });
  }
}, ['onRestart', 'onFinishSession', 'handleGoRoom']));
