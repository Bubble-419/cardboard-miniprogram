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
  safePageSetData
} = require('../../../../utils/spyMode');
const { followSpyRoomState } = require('../../../../utils/spyFollow');
const { getLibraryGroupCount } = require('../../../../utils/spyWordCardAssets');
const { SPY_PHASE } = require('../../../../utils/spyGameState');

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
    avatarList: [],
    playerAvatarList: [],
    playerCount: 0,
    minPlayers: MIN_PLAYERS,
    spyCountHint: '',
    canStart: false,
    statusText: '等待玩家到齐后开始',
    starting: false,
    showLibraryEntry: true,
    libraryGroupCount: 0,
    rulesExpanded: false
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
  },

  onHide() {
    // hide 时也标记不可写，避免 navigateTo 牌库后异步轮询 setData 触发基础库空指针
    this._pageAlive = false;
    this.stopPolling();
  },

  onUnload() {
    this._pageAlive = false;
    this.stopPolling();
  },

  async refreshRoom() {
    const roomId = this.data.roomId;
    if (!roomId || this._pageAlive === false) return;
    await withSpyRefreshGuard(this, async () => {
      try {
        if (this._pageAlive === false) return;
        const result = await fetchRoomDataOrExit(roomId);
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
        const canStart = playerCount >= MIN_PLAYERS;
        const spyGame = result.roomState && result.roomState.spyGame;

        safePageSetData(this, {
          avatarList: buildAvatarList(members),
          playerAvatarList: buildAvatarList(players),
          playerCount,
          canStart,
          spyCountHint: canStart
            ? `当前 ${playerCount} 名玩家，本局将自动分配 ${spyCount} 名卧底`
            : `当前 ${playerCount} 名玩家，人数不足`,
          statusText: canStart ? '人数已齐，任意玩家可开始游戏' : '等待更多玩家加入…',
          showLibraryEntry: shouldShowLibrary(spyGame)
        });
      } catch (e) {
        console.warn('spy modeIndex refresh', e);
      }
    });
  },

  startPolling() {
    this.stopPolling();
    this._pollTimer = setInterval(() => {
      if (this._pageAlive === false) return;
      this.refreshRoom();
    }, 1000);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
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
    this.setData({ rulesExpanded: !this.data.rulesExpanded });
  },

  async onStartGame() {
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
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({
          url: `/pages/main-pages/brainstormMode/index?roomId=${encodeURIComponent(this.data.roomId)}`
        });
      }
    });
  },

  handleGoRoom() {
    this._pageAlive = false;
    if (typeof this.stopPolling === 'function') this.stopPolling();
    goRoomPage(this.data.roomId);
  }
});
