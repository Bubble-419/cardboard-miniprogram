/**
 * 合伙人模式 - 出牌页
 * 路径：pages/main-pages/partnerMode/gamepage/
 */
const { assignAvatarImages } = require('../../../../utils/avatars');
const { buildStatementUrl, buildSpecialMoveUrl } = require('../../../../utils/modeRoutes');
const { navigateByRoomState, safeOpenUrl } = require('../../../../utils/subAwaitRoutes');
const { resolveSelectedDesignProblem } = require('../../../../utils/selectedDesignProblem');
const {
  PHASE_PLAY,
  PHASE_DISCUSSION,
  normalizePartnerGamePhase,
  isDiscussionPhase,
} = require('../../../../utils/partnerGamePhase');
const {
  getNextPlayerTurn,
  buildPartnerAvatarList,
  resolveCurrentPlayerFromRoom
} = require('../../../../utils/partnerPlayerTurn');

Page({
  data: {
    roomId: '',
    isHost: false,
    avatarList: [],
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    members: [],
    isCurrentPlayer: false,
    selectedProblemText: '',
    gamepagePhase: PHASE_PLAY,
    cardIndex: 0,
    insertedImages: [],
    scoreOptions: [0, 1, 2, 3, 4, 5],
    selectedScore: null,
    scoredCount: 0,
    totalRequired: 0,
    canStartStatement: false,
    playHistory: [
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    ],
    discussionNotes: [
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    ]
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10)
      : 1;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    getApp().globalData.roomId = roomId;
    getApp().globalData.gameMode = 'partner';

    const initialPhase = options && options.phase === PHASE_DISCUSSION
      ? PHASE_DISCUSSION
      : PHASE_PLAY;

    this.setData({
      roomId,
      currentPlayerIndex,
      gamepagePhase: initialPhase,
      cardIndex: 0
    });

    this.loadRoomData();
  },

  onShow() {
    this.refreshScoreStatus();
  },

  onUnload() {
    this._stopScorePolling();
    this._stopStatePolling();
  },

  _applyRoomContext(result, options = {}) {
    const members = assignAvatarImages(result.members || this.data.members || []);
    const roomState = result.roomState || {};
    const player = resolveCurrentPlayerFromRoom(
      members,
      roomState,
      options.fallbackPlayerIndex != null
        ? options.fallbackPlayerIndex
        : this.data.currentPlayerIndex
    );
    const roomPhase = normalizePartnerGamePhase(
      roomState.partnerGamePhase || this.data.gamepagePhase
    );
    const playerChanged = player.currentPlayerIndex !== this.data.currentPlayerIndex;
    const phaseChanged = roomPhase !== this.data.gamepagePhase;

    const patch = {
      members,
      avatarList: buildPartnerAvatarList(members),
      currentPlayerIndex: player.currentPlayerIndex,
      currentPlayerName: player.currentPlayerName,
      isCurrentPlayer: player.isCurrentPlayer,
      gamepagePhase: roomPhase,
      totalRequired: Math.max(0, members.length - 1)
    };

    if (playerChanged || phaseChanged || options.resetTurnUi) {
      patch.cardIndex = 0;
      patch.selectedScore = null;
      patch.canStartStatement = false;
    }

    this.setData(patch);
    return { playerChanged, phaseChanged, members, player, roomPhase };
  },

  async loadRoomData() {
    const roomId = this.data.roomId;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.members || !result.members.length) {
        wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        return;
      }

      const members = assignAvatarImages(result.members);
      const app = getApp();
      const selectedProblem = resolveSelectedDesignProblem(app, result);
      const selectedProblemText = selectedProblem && selectedProblem.text
        ? selectedProblem.text
        : '';

      const { player } = this._applyRoomContext(result, {
        fallbackPlayerIndex: this.data.currentPlayerIndex,
        resetTurnUi: true
      });

      this.setData({
        isHost: result.isHost === true,
        selectedProblemText
      });

      if (result.isHost === true) {
        await this._updateRoomState('gamepage', player.currentPlayerIndex, player.currentPlayerName, {
          partnerGamePhase: this.data.gamepagePhase
        });
        this._stopStatePolling();
      } else {
        this._startStatePolling();
      }

      this.refreshScoreStatus();
      this._startScorePolling();
    } catch (e) {
      console.error('partner gamepage loadRoomData', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async refreshScoreStatus() {
    const { roomId, currentPlayerIndex, isHost } = this.data;
    if (!roomId) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getGameScoreStatus',
        data: { roomId, currentPlayerIndex }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) return;

      const scoredCount = result.scoredCount || 0;
      const totalRequired = result.totalRequired != null
        ? result.totalRequired
        : this.data.totalRequired;
      const canStartStatement = isHost
        && !isDiscussionPhase(this.data.gamepagePhase)
        && totalRequired > 0
        && scoredCount >= totalRequired;

      this.setData({
        scoredCount,
        totalRequired,
        canStartStatement
      });
    } catch (e) {
      console.warn('refreshScoreStatus', e);
    }
  },

  _startScorePolling() {
    this._stopScorePolling();
    this._scorePollTimer = setInterval(() => this.refreshScoreStatus(), 1500);
  },

  _stopScorePolling() {
    if (this._scorePollTimer) {
      clearInterval(this._scorePollTimer);
      this._scorePollTimer = null;
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        if (result.ok !== true || !result.roomState) return;
        const page = (result.roomState.currentPage || '').toLowerCase();
        if (page === 'gamepage') {
          const { playerChanged, phaseChanged } = this._applyRoomContext(result);
          if (playerChanged || phaseChanged) {
            this.refreshScoreStatus();
          }
          return;
        }
        if (page === 'statement') {
          const idx = result.roomState.currentPlayerIndex != null
            ? result.roomState.currentPlayerIndex
            : this.data.currentPlayerIndex;
          const name = result.roomState.currentPlayerName || this.data.currentPlayerName;
          safeOpenUrl(buildStatementUrl(roomId, idx, name, { isWaiting: true }));
          return;
        }
        navigateByRoomState(page, result.roomState, roomId);
      } catch (e) {
        console.warn('partner gamepage state poll', e);
      }
    };
    poll();
    this._statePollTimer = setInterval(poll, 1500);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName, extra) {
    const roomId = this.data.roomId || '';
    if (!roomId) return false;
    try {
      const data = { roomId, currentPage };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      if (extra && extra.partnerGamePhase != null) {
        data.partnerGamePhase = extra.partnerGamePhase;
      }
      if (extra && extra.incrementRound === true) {
        data.incrementRound = true;
      }
      const res = await wx.cloud.callFunction({ name: 'updateRoomState', data });
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('updateRoomState', e);
      return false;
    }
  },

  onCardSwiperChange(e) {
    const index = e.detail && e.detail.current != null ? e.detail.current : 0;
    this.setData({ cardIndex: index });
  },

  handleInsertImage() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        const remain = 9 - (this.data.insertedImages || []).length;
        if (remain <= 0) {
          wx.showToast({ title: '最多插入 9 张图片', icon: 'none' });
          return;
        }
        wx.chooseImage({
          count: remain,
          sizeType: ['compressed'],
          sourceType,
          success: (chooseRes) => {
            const paths = chooseRes.tempFilePaths || [];
            if (!paths.length) return;
            this.setData({
              insertedImages: [...(this.data.insertedImages || []), ...paths]
            });
          },
          fail: () => {
            wx.showToast({ title: '选择图片失败', icon: 'none' });
          }
        });
      }
    });
  },

  async onScoreTap(e) {
    if (this.data.isCurrentPlayer) {
      wx.showToast({ title: '当前出牌玩家无需打分', icon: 'none' });
      return;
    }
    const score = parseInt(e.currentTarget.dataset.score, 10);
    if (!Number.isFinite(score)) return;

    this.setData({ selectedScore: score });

    const { roomId, currentPlayerIndex } = this.data;
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitGameScore',
        data: { roomId, currentPlayerIndex, score }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
        return;
      }
      const scoredCount = result.scoredCount || 0;
      const totalRequired = result.totalRequired != null
        ? result.totalRequired
        : this.data.totalRequired;
      this.setData({
        scoredCount,
        totalRequired,
        canStartStatement: this.data.isHost
          && !isDiscussionPhase(this.data.gamepagePhase)
          && totalRequired > 0
          && scoredCount >= totalRequired
      });
    } catch (err) {
      console.warn('submitGameScore', err);
      wx.showToast({ title: '提交失败', icon: 'none' });
    }
  },

  handleSpecialMove() {
    const { roomId, currentPlayerIndex } = this.data;
    if (!roomId) return;
    wx.navigateTo({ url: buildSpecialMoveUrl(roomId, currentPlayerIndex) });
  },

  async handleStartStatement() {
    if (!this.data.canStartStatement || isDiscussionPhase(this.data.gamepagePhase)) return;

    const { roomId, currentPlayerIndex, currentPlayerName } = this.data;
    const ok = await this._updateRoomState('statement', currentPlayerIndex, currentPlayerName);
    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }

    safeOpenUrl(buildStatementUrl(roomId, currentPlayerIndex, currentPlayerName));
  },

  async handleEndDiscussion() {
    if (!this.data.isHost) {
      wx.showToast({ title: '请等待房主结束讨论', icon: 'none' });
      return;
    }

    const { roomId, members, currentPlayerIndex } = this.data;
    const { nextIndex, nextName, incrementRound } = getNextPlayerTurn(members, currentPlayerIndex);
    const ok = await this._updateRoomState('gamepage', nextIndex, nextName, {
      partnerGamePhase: PHASE_PLAY,
      incrementRound
    });
    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }

    this.setData({
      currentPlayerIndex: nextIndex,
      currentPlayerName: nextName,
      gamepagePhase: PHASE_PLAY,
      cardIndex: 0,
      selectedScore: null,
      canStartStatement: false,
      isCurrentPlayer: !!(members.find((m) => m.isMe && m.playerIndex === nextIndex))
    });
    this.refreshScoreStatus();
  },

  handleGoRoom() {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    wx.navigateTo({
      url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
    });
  },

  handleGoInspiration() {
    wx.navigateTo({ url: '/pages/inspiration/index' });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        const roomId = this.data.roomId || '';
        if (roomId) {
          wx.redirectTo({
            url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
          });
        } else {
          wx.reLaunch({ url: '/pages/main-pages/aaa/index' });
        }
      }
    });
  }
});
