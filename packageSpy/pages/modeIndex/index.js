const {
  fetchRoomDataOrExit,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  filterPlayerMembers,
  buildSpyPageUrl,
  getDefaultSpyCount,
  MIN_PLAYERS,
  openUrl,
  withSpyRefreshGuard,
  safePageSetData,
  startSpyRoomPoll,
  stopSpyRoomPoll,
  bumpSpyRoomSession
} = require('../../../utils/spyMode');
const { followSpyRoomState } = require('../../../utils/spyFollow');
const { getLibraryGroupCount } = require('../../../utils/spyWordCardAssets');
const { SPY_PHASE } = require('../../../utils/spyGameState');
const { safeNavigateBack } = require('../../../utils/pageNavigate');

function shouldShowLibrary(spyGame) {
  if (!spyGame || !spyGame.phase) return true;
  const phase = spyGame.phase;
  // 未开局 / 已结算回大厅：可查；分词及对局中锁定
  return (
    phase === SPY_PHASE.INTRO
    || phase === SPY_PHASE.SETTLE
    || phase === 'idle'
    || phase === 'lobby'
  );
}

Page({
  data: {
    roomId: '',
    isHost: false,
    playerAvatarList: [],
    playerCount: 0,
    minPlayers: MIN_PLAYERS,
    spyCountHint: '',
    canStart: false,
    statusText: '等待玩家到齐后开始',
    waitFooterText: '等待更多玩家加入…',
    starting: false,
    showLibraryEntry: true,
    libraryGroupCount: 0,
    rulesExpanded: false,
    rulesNeedScroll: false
  },

  onLoad(options) {
    this._pageAlive = true;

    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    getApp().globalData.roomId = roomId;
    getApp().globalData.gameMode = 'spy';
    this.setData({
      roomId,
      minPlayers: MIN_PLAYERS,
      libraryGroupCount: getLibraryGroupCount()
    });
  },

  onShow() {
    this._pageAlive = true;
    this.refreshRoom();
    this.startPolling();
    if (this.data.rulesExpanded) this.scheduleRulesScrollMeasure();
  },

  onResize() {
    if (this.data.rulesExpanded) this.scheduleRulesScrollMeasure();
  },

  onHide() {
    // hide 时也标记不可写，避免 navigateTo 牌库后异步轮询 setData 触发基础库空指针
    this._pageAlive = false;
    this.stopPolling();
  },

  onUnload() {
    this._pageAlive = false;
    if (this._rulesMeasureTimer) {
      clearTimeout(this._rulesMeasureTimer);
      this._rulesMeasureTimer = null;
    }
    this.stopPolling();
  },

  async refreshRoom(prefetchedResult) {
    const roomId = this.data.roomId;
    if (!roomId || this._pageAlive === false) return;
    await withSpyRefreshGuard(this, async () => {
      try {
        if (this._pageAlive === false) return;
        const result = (prefetchedResult && prefetchedResult.ok === true)
          ? prefetchedResult
          : await fetchRoomDataOrExit(roomId);
        if (this._pageAlive === false || !result || result.ok !== true) return;

        followSpyRoomState(result, roomId, {
          stayOnPage: 'spymodeindex',
          allowHost: true
        });

        if (this._pageAlive === false) return;

        const members = result.members || [];
        const players = filterPlayerMembers(members);
        const playerCount = players.length;
        const spyCount = getDefaultSpyCount(playerCount);
        const isHost = result.isHost === true;
        const canStart = isHost && playerCount >= MIN_PLAYERS;
        const spyGame = result.roomState && result.roomState.spyGame;
        let statusText = '等待更多玩家加入…';
        let waitFooterText = '等待更多玩家加入…';
        if (playerCount >= MIN_PLAYERS) {
          statusText = isHost ? '人数已齐，可开始游戏' : '人数已齐，等待房主开始游戏';
          waitFooterText = '等待房主开始游戏…';
        }

        safePageSetData(this, {
          isHost,
          playerAvatarList: buildAvatarList(players),
          playerCount,
          canStart,
          spyCountHint: playerCount >= MIN_PLAYERS
            ? `当前 ${playerCount} 名玩家，本局将自动分配 ${spyCount} 名卧底`
            : `当前 ${playerCount} 名玩家，人数不足`,
          statusText,
          waitFooterText,
          showLibraryEntry: shouldShowLibrary(spyGame)
        });
      } catch (e) {
        console.warn('spy modeIndex refresh', e);
      }
    });
  },

  startPolling() {
    startSpyRoomPoll(this, {
      intervalMs: 1000,
      onPollResult: (result) => this.refreshRoom(result)
    });
  },

  stopPolling() {
    stopSpyRoomPoll(this);
  },

  onOpenLibrary() {
    if (!this.data.showLibraryEntry) {
      wx.showToast({ title: '对局中不可查阅牌库', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: buildSpyPageUrl('cardLibrary', this.data.roomId)
    });
  },

  onToggleRules() {
    const next = !this.data.rulesExpanded;
    this.setData({
      rulesExpanded: next,
      rulesNeedScroll: false
    }, () => {
      if (next) this.scheduleRulesScrollMeasure();
    });
  },

  scheduleRulesScrollMeasure() {
    if (this._rulesMeasureTimer) {
      clearTimeout(this._rulesMeasureTimer);
    }
    this._rulesMeasureTimer = setTimeout(() => {
      this._rulesMeasureTimer = null;
      this.measureRulesScroll();
    }, 50);
  },

  measureRulesScroll() {
    if (!this._pageAlive || !this.data.rulesExpanded) return;
    const q = this.createSelectorQuery();
    q.select('.section-rules').boundingClientRect();
    q.select('#rulesContent').boundingClientRect();
    q.exec((res) => {
      if (!this._pageAlive || !this.data.rulesExpanded) return;
      const box = res && res[0];
      const content = res && res[1];
      if (!box || !content) return;
      const needScroll = content.height > box.height + 1;
      if (needScroll !== this.data.rulesNeedScroll) {
        this.setData({ rulesNeedScroll: needScroll });
      }
    });
  },

  async onStartGame() {
    if (!this.data.isHost) {
      wx.showToast({ title: '仅房主可开始游戏', icon: 'none' });
      return;
    }
    if (!this.data.canStart || this.data.starting) return;
    this.setData({ starting: true, showLibraryEntry: false });
    wx.showLoading({ title: '分配词语中…' });
    try {
      const result = await callSpyAction('startAssign', { roomId: this.data.roomId });
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '开始失败', icon: 'none' });
        this.setData({ starting: false, showLibraryEntry: true });
        return;
      }
      const navigated = openUrl(buildSpyPageUrl('speak', this.data.roomId), {
        immediate: true,
        noReLaunch: true
      });
      bumpSpyRoomSession();
      if (!navigated && this._pageAlive) {
        this.setData({ starting: false });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.errMsg) || '开始失败', icon: 'none' });
      if (this._pageAlive) this.setData({ starting: false, showLibraryEntry: true });
    }
  },

  handleGoBack() {
    const roomId = this.data.roomId || '';
    const fallbackUrl = roomId
      ? `/pages/main-pages/brainstormMode/index?roomId=${encodeURIComponent(roomId)}`
      : '/pages/main-pages/brainstormMode/index';
    safeNavigateBack({
      expectedPrev: 'pages/main-pages/brainstormMode/index',
      fallbackUrl
    });
  },

  handleGoRoom() {
    this._pageAlive = false;
    if (typeof this.stopPolling === 'function') this.stopPolling();
    goRoomPage(this.data.roomId);
  }
});
