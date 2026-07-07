/**
 * 脑暴大富翁（partnerMode）- 出牌页
 * 路径：pages/main-pages/partnerMode/gamepage/
 */
const { assignAvatarImages } = require('../../../../utils/avatars');
const { buildStatementUrl, buildSpecialMoveUrl, buildClosingEndUrl } = require('../../../../utils/modeRoutes');
const { navigateByRoomState, safeOpenUrl } = require('../../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const { resolveSelectedDesignProblem } = require('../../../../utils/selectedDesignProblem');
const {
  PHASE_PLAY,
  PHASE_DISCUSSION,
  PHASE_CLOSING,
  CLOSING_STEP_RUNE,
  CLOSING_STEP_REVIEW,
  normalizePartnerGamePhase,
  isDiscussionPhase,
  isClosingPhase,
} = require('../../../../utils/partnerGamePhase');
const {
  getNextPlayerTurn,
  buildPartnerAvatarList,
  resolveCurrentPlayerFromRoom
} = require('../../../../utils/partnerPlayerTurn');
const {
  clearPartnerSpecialMoveUsedFlag,
  markPartnerSpecialMoveUsed,
  isSpecialMoveUsedForCurrentTurn
} = require('../../../../utils/partnerSpecialMove');
const {
  getRoundTimerState,
  buildPaginationIndexes,
  isRoundTimerActive,
  ROUND_DURATION_SEC
} = require('../../../../utils/partnerRoundTimer');
const {
  normalizePartnerRoundContent
} = require('../../../../utils/partnerRoundContent');
const {
  buildDisplaySummaries,
  playerHasSummaryCards,
  isSamePlayerIndex
} = require('../../../../utils/partnerRoundNavigation');
const { createPartnerRoundSpeech } = require('../../../../utils/partnerRoundSpeech');
const {
  attachPrivateNotesToSummaries,
  savePrivateRoundNote,
  persistTempPhoto
} = require('../../../../utils/partnerRoundPrivateNotes');

Page({
  data: {
    roomId: '',
    isHost: false,
    avatarList: [],
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    selectedPlayerIndex: 1,
    indicatorPlayerIndex: 1,
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
    isMasterMode: false,
    closingStep: CLOSING_STEP_RUNE,
    closingQuestionPlayers: [],
    reviewPhotos: [],
    canStartStatement: false,
    specialMoveUsedThisTurn: false,
    currentRound: 1,
    brainstormSessionSeq: 0,
    roundSummaries: [],
    displayRoundSummaries: [],
    filteredPlayerIndex: null,
    isPlayerFilterActive: false,
    cardIndexBeforeFilter: 0,
    partnerRoundStartedAt: null,
    roundTimerVisible: false,
    roundTimerElapsedRatio: 0,
    roundTimerRemainingSec: 30,
    cardCount: 1,
    paginationIndexes: [0],
    playHistory: [],
    discussionNotes: [],
    voiceLines: [],
    turnRecords: []
  },

  onLoad(options) {
    this._playerFilterIndex = null;
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
      : (options && options.phase === PHASE_CLOSING ? PHASE_CLOSING : PHASE_PLAY);
    const initialClosingStep = options && options.closingStep === CLOSING_STEP_REVIEW
      ? CLOSING_STEP_REVIEW
      : CLOSING_STEP_RUNE;
    const specialMoveUsedFromUrl = options && (options.specialMoveUsed === '1' || options.specialMoveUsed === 1);

    this.setData({
      roomId,
      currentPlayerIndex,
      gamepagePhase: initialPhase,
      closingStep: initialClosingStep,
      cardIndex: initialPhase === PHASE_CLOSING && initialClosingStep === CLOSING_STEP_REVIEW ? 1 : 0,
      specialMoveUsedThisTurn: !!specialMoveUsedFromUrl
    });

    this.loadRoomData();
    this._roundSpeech = createPartnerRoundSpeech({
      onText: () => this._syncRoomContext()
    });
  },

  _applyPendingSpecialMoveUsed() {
    const roomId = this.data.roomId;
    if (!roomId) return;

    const app = getApp();
    const flag = app.globalData && app.globalData.partnerSpecialMoveUsedTurn;
    if (flag && flag.roomId === roomId) {
      this.setData({ specialMoveUsedThisTurn: true });
      return;
    }

    if (isSpecialMoveUsedForCurrentTurn(
      roomId,
      this.data.brainstormSessionSeq,
      this.data.currentRound,
      this.data.currentPlayerIndex
    )) {
      this.setData({ specialMoveUsedThisTurn: true });
    }
  },

  onShow() {
    this._pageVisible = true;
    this._applyPendingSpecialMoveUsed();
    this._syncTimerFromStartedAt();
    this._restartRoundTimer();
    this._syncRoomContext().then(() => {
      this._applyPendingSpecialMoveUsed();
      this.refreshScoreStatus();
      this._syncRoundTimerVisible(this.data.partnerRoundStartedAt);
      this._syncRoundSpeech();
    });
    if (this.data.roomId) {
      this._startStatePolling();
      this._startScorePolling();
    }
    this._syncRoundTimerVisible(this.data.partnerRoundStartedAt);
  },

  async _syncRoomContext() {
    const roomId = this.data.roomId;
    if (!roomId) return null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.members && result.members.length) {
        this._applyRoomContext(result);
        const roomState = result.roomState || {};
        return {
          roundContent: this._applyRoundContentFromRoom(roomState),
          currentPlayerIndex: roomState.currentPlayerIndex != null
            ? roomState.currentPlayerIndex
            : this.data.currentPlayerIndex
        };
      }
    } catch (e) {
      console.warn('partner gamepage syncRoomContext', e);
    }
    return null;
  },

  onHide() {
    this._pageVisible = false;
    this.setData({ roundTimerVisible: false });
    this._stopRoundSpeech();
    this._stopScorePolling();
    this._stopStatePolling();
    this._stopRoundTimer();
    this._syncRoundContentToRoom();
  },

  onUnload() {
    this._stopRoundSpeech();
    if (this._roundSpeech) {
      this._roundSpeech.destroy();
      this._roundSpeech = null;
    }
    this._stopScorePolling();
    this._stopStatePolling();
    this._stopRoundTimer();
  },

  _applyRoundContentFromRoom(roomState) {
    return normalizePartnerRoundContent(roomState && roomState.partnerCurrentRoundContent);
  },

  _buildClientRoundContentPatch() {
    return {
      playHistory: this.data.playHistory || [],
      discussionNotes: this.data.discussionNotes || [],
      images: this.data.insertedImages || []
    };
  },

  _buildRoundSummaryPayload() {
    return {
      ...this._buildClientRoundContentPatch(),
      voiceLines: this.data.voiceLines || [],
      turnRecords: this.data.turnRecords || [],
      aiSummary: { status: 'pending' }
    };
  },

  _shouldRunRoundSpeech() {
    return this.data.isHost
      && this._pageVisible
      && this._roomLoaded
      && !isClosingPhase(this.data.gamepagePhase)
      && !!this.data.roomId;
  },

  async _syncRoundSpeech() {
    if (!this._roundSpeech) return;
    if (!this._shouldRunRoundSpeech()) {
      this._roundSpeech.stop();
      return;
    }
    this._roundSpeech.setPhase(
      isDiscussionPhase(this.data.gamepagePhase) ? 'discussion' : 'play'
    );
    if (this._roundSpeech.isActive()) return;
    await this._roundSpeech.start({
      roomId: this.data.roomId,
      phase: isDiscussionPhase(this.data.gamepagePhase) ? 'discussion' : 'play'
    });
  },

  _stopRoundSpeech() {
    if (this._roundSpeech) {
      this._roundSpeech.stop();
    }
  },

  _resolveActivePlayerFilter() {
    if (this._playerFilterIndex != null) {
      return this._playerFilterIndex;
    }
    return this.data.isPlayerFilterActive ? this.data.filteredPlayerIndex : null;
  },

  _buildDisplayCardState(options) {
    const {
      roundSummaries,
      members,
      filteredPlayerIndex,
      isPlayerFilterActive,
      currentPlayerIndex,
      preferredCardIndex,
      roomId,
      brainstormSessionSeq
    } = options || {};

    const filterActive = isPlayerFilterActive === true;
    const summaries = attachPrivateNotesToSummaries(
      buildDisplaySummaries(
        roundSummaries,
        members,
        filteredPlayerIndex,
        filterActive
      ),
      roomId || this.data.roomId,
      brainstormSessionSeq != null ? brainstormSessionSeq : this.data.brainstormSessionSeq
    );
    const displayRoundSummaries = summaries;
    const summaryCount = displayRoundSummaries.length;
    const cardCount = Math.max(1, summaryCount + 1);
    const actionCardIndex = summaryCount;
    const cardIndex = preferredCardIndex != null
      ? Math.min(Math.max(0, preferredCardIndex), cardCount - 1)
      : actionCardIndex;
    const indicatorPlayerIndex = cardIndex < summaryCount && displayRoundSummaries[cardIndex]
      ? displayRoundSummaries[cardIndex].playerIndex
      : currentPlayerIndex;

    return {
      displayRoundSummaries,
      cardCount,
      paginationIndexes: buildPaginationIndexes(cardCount),
      cardIndex,
      isPlayerFilterActive: filterActive,
      selectedPlayerIndex: filterActive
        ? filteredPlayerIndex
        : currentPlayerIndex,
      indicatorPlayerIndex
    };
  },

  _resolveIndicatorPlayerIndex(cardIndex) {
    const summaries = this.data.displayRoundSummaries || [];
    if (cardIndex < summaries.length && summaries[cardIndex]) {
      return summaries[cardIndex].playerIndex;
    }
    return this.data.currentPlayerIndex;
  },

  _syncTimerFromStartedAt() {
    const { partnerRoundStartedAt, gamepagePhase } = this.data;
    if (isClosingPhase(gamepagePhase) || !partnerRoundStartedAt) {
      if (this.data.roundTimerElapsedRatio !== 0) {
        this.setData({ roundTimerElapsedRatio: 0 });
      }
      return;
    }
    const timerState = getRoundTimerState(partnerRoundStartedAt);
    this.setData({
      roundTimerElapsedRatio: timerState.elapsedRatio,
      roundTimerRemainingSec: timerState.remainingSec
    });
  },

  _restartRoundTimer() {
    this._stopRoundTimer();
    const { partnerRoundStartedAt, gamepagePhase } = this.data;
    if (isClosingPhase(gamepagePhase) || !partnerRoundStartedAt) return;

    const tick = () => {
      const startedAt = this.data.partnerRoundStartedAt;
      if (!startedAt) return;
      const timerState = getRoundTimerState(startedAt);
      this.setData({
        roundTimerElapsedRatio: timerState.elapsedRatio,
        roundTimerRemainingSec: timerState.remainingSec
      });
    };

    tick();
    this._roundTimerInterval = setInterval(tick, 1000);
  },

  _stopRoundTimer() {
    if (this._roundTimerInterval) {
      clearInterval(this._roundTimerInterval);
      this._roundTimerInterval = null;
    }
  },

  async _syncRoundContentToRoom() {
    const roomId = this.data.roomId;
    if (!roomId || isClosingPhase(this.data.gamepagePhase)) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'gamepage',
          partnerCurrentRoundContent: this._buildClientRoundContentPatch()
        }
      });
    } catch (e) {
      console.warn('syncRoundContentToRoom', e);
    }
  },

  _cacheRoundStartedAt(roomId, round, startedAt) {
    const app = getApp();
    if (!app.globalData) app.globalData = {};
    app.globalData.partnerRoundStartedAt = { roomId, round, startedAt };
  },

  _clearRoundStartedAtCache() {
    const app = getApp();
    if (app.globalData) {
      app.globalData.partnerRoundStartedAt = null;
    }
  },

  _resolvePartnerRoundStartedAt(roomState, currentRound) {
    const roomId = this.data.roomId;
    const fromServer = roomState.partnerRoundStartedAt != null
      ? Number(roomState.partnerRoundStartedAt)
      : 0;
    if (Number.isFinite(fromServer) && fromServer > 0) {
      this._cacheRoundStartedAt(roomId, currentRound, fromServer);
      return fromServer;
    }

    const cached = getApp().globalData && getApp().globalData.partnerRoundStartedAt;
    if (
      cached
      && cached.roomId === roomId
      && cached.round === currentRound
      && isRoundTimerActive(cached.startedAt)
    ) {
      return Number(cached.startedAt);
    }

    const local = Number(this.data.partnerRoundStartedAt);
    if (Number.isFinite(local) && local > 0 && isRoundTimerActive(local)) {
      return local;
    }
    return null;
  },

  _syncRoundTimerVisible(partnerRoundStartedAt) {
    const visible = !!(this._roomLoaded
      && this._pageVisible
      && partnerRoundStartedAt
      && !isClosingPhase(this.data.gamepagePhase));
    if (visible !== this.data.roundTimerVisible) {
      this.setData({ roundTimerVisible: visible });
    }
  },

  async _rollRoundCountdown(startedAt) {
    const ts = startedAt || Date.now();
    const { roomId, currentPlayerIndex, currentPlayerName, currentRound } = this.data;
    if (!roomId || isClosingPhase(this.data.gamepagePhase)) return;

    this._cacheRoundStartedAt(roomId, currentRound, ts);
    this.setData({
      partnerRoundStartedAt: ts,
      roundTimerVisible: true,
      roundTimerRemainingSec: ROUND_DURATION_SEC
    });
    this._restartRoundTimer();

    if (!this.data.isHost) return;

    try {
      await this._updateRoomState('gamepage', currentPlayerIndex, currentPlayerName, {
        partnerRoundStartedAt: ts
      });
    } catch (e) {
      console.warn('_rollRoundCountdown', e);
    }
  },

  handleRoundTimerExpire(e) {
    const detail = (e && e.detail) || {};
    if (detail.loop !== true) return;
    this._rollRoundCountdown(detail.startedAt);
  },

  async _ensureRoundTimerStarted(isHost) {
    if (isClosingPhase(this.data.gamepagePhase)) return;
    if (!isHost) return;
    if (isRoundTimerActive(this.data.partnerRoundStartedAt)) return;

    const startedAt = Date.now();
    const { currentPlayerIndex, currentPlayerName, currentRound } = this.data;
    this._cacheRoundStartedAt(this.data.roomId, currentRound, startedAt);
    this.setData({ partnerRoundStartedAt: startedAt });
    this._syncRoundTimerVisible(startedAt);

    try {
      await this._updateRoomState('gamepage', currentPlayerIndex, currentPlayerName, {
        partnerRoundStartedAt: startedAt
      });
    } catch (e) {
      console.warn('_ensureRoundTimerStarted', e);
    }
  },

  _validateSpecialMoveFlag(flag, patch, members) {
    const me = members.find((m) => m.isMe);
    if (!me || me.playerIndex !== flag.playerIndex) return false;
    if (flag.playerIndex !== patch.currentPlayerIndex) return false;
    return true;
  },

  _resolveSpecialMoveUsed(patch, members) {
    if (!patch.isCurrentPlayer) {
      return false;
    }

    if (patch.isMasterMode) {
      return true;
    }

    const roomId = this.data.roomId;
    const app = getApp();
    const flag = app.globalData && app.globalData.partnerSpecialMoveUsedTurn;

    if (flag && flag.roomId === roomId && this._validateSpecialMoveFlag(flag, patch, members)) {
      markPartnerSpecialMoveUsed(
        roomId,
        flag.playerIndex,
        patch.currentRound,
        patch.brainstormSessionSeq
      );
      app.globalData.partnerSpecialMoveUsedTurn = null;
      return true;
    }

    return isSpecialMoveUsedForCurrentTurn(
      roomId,
      patch.brainstormSessionSeq,
      patch.currentRound,
      patch.currentPlayerIndex
    );
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
    const closingQuestionPlayers = Array.isArray(roomState.closingQuestionPlayers)
      ? roomState.closingQuestionPlayers
      : [];
    const closingStep = roomState.partnerClosingStep || CLOSING_STEP_RUNE;
    const currentRound = roomState.currentRound != null ? roomState.currentRound : 1;
    const brainstormSessionSeq = roomState.brainstormSessionSeq != null
      ? roomState.brainstormSessionSeq
      : 0;
    const playerChanged = player.currentPlayerIndex !== this.data.currentPlayerIndex;
    const phaseChanged = roomPhase !== this.data.gamepagePhase;
    const roundChanged = currentRound !== this.data.currentRound;
    const sessionChanged = brainstormSessionSeq !== this.data.brainstormSessionSeq;
    const hadPriorContext = (this.data.members || []).length > 0;
    const me = members.find((m) => m.isMe);
    const myPlayerIndex = me ? me.playerIndex : null;
    const turnIndexChanged = player.currentPlayerIndex !== this.data.currentPlayerIndex;
    const becameMyTurn = hadPriorContext
      && turnIndexChanged
      && myPlayerIndex != null
      && player.currentPlayerIndex === myPlayerIndex;
    const leftMyTurn = hadPriorContext
      && turnIndexChanged
      && myPlayerIndex != null
      && this.data.currentPlayerIndex === myPlayerIndex
      && player.currentPlayerIndex !== myPlayerIndex;
    const closingStepChanged = isClosingPhase(roomPhase)
      && closingStep !== this.data.closingStep;
    const roundSummaries = (Array.isArray(roomState.partnerRoundSummaries)
      ? roomState.partnerRoundSummaries
      : [])
      .slice()
      .sort((a, b) => (a.round || 0) - (b.round || 0))
      .map((item) => ({
        ...item,
        voiceLines: Array.isArray(item.voiceLines) ? item.voiceLines : [],
        turnRecords: Array.isArray(item.turnRecords) ? item.turnRecords : []
      }));
    const roundContent = this._applyRoundContentFromRoom(roomState);
    const partnerRoundStartedAt = this._resolvePartnerRoundStartedAt(roomState, currentRound);
    const timerPatch = (!isClosingPhase(roomPhase) && partnerRoundStartedAt)
      ? (() => {
        const timerState = getRoundTimerState(partnerRoundStartedAt);
        return {
          roundTimerElapsedRatio: timerState.elapsedRatio,
          roundTimerRemainingSec: timerState.remainingSec
        };
      })()
      : { roundTimerElapsedRatio: 0 };
    const nextFilteredPlayerIndex = (playerChanged || roundChanged || sessionChanged || options.resetTurnUi)
      ? null
      : this._resolveActivePlayerFilter();
    const nextFilterActive = nextFilteredPlayerIndex != null
      && !Number.isNaN(parseInt(nextFilteredPlayerIndex, 10));
    if (!nextFilterActive) {
      this._playerFilterIndex = null;
    }
    const paginationState = this._buildDisplayCardState({
      roundSummaries,
      members,
      filteredPlayerIndex: nextFilteredPlayerIndex,
      isPlayerFilterActive: nextFilterActive,
      currentPlayerIndex: player.currentPlayerIndex,
      preferredCardIndex: (roundChanged || sessionChanged || options.resetTurnUi)
        ? undefined
        : this.data.cardIndex,
      roomId: this.data.roomId,
      brainstormSessionSeq
    });

    const patch = {
      members,
      avatarList: isClosingPhase(roomPhase)
        ? buildPartnerAvatarList(members, closingQuestionPlayers)
        : buildPartnerAvatarList(members),
      currentPlayerIndex: player.currentPlayerIndex,
      currentPlayerName: player.currentPlayerName,
      isCurrentPlayer: player.isCurrentPlayer,
      gamepagePhase: roomPhase,
      isMasterMode: roomState.partnerMasterMode === true,
      closingQuestionPlayers,
      closingStep,
      currentRound,
      brainstormSessionSeq,
      totalRequired: Math.max(0, members.length - 1),
      roundSummaries,
      filteredPlayerIndex: nextFilteredPlayerIndex,
      isPlayerFilterActive: nextFilterActive,
      partnerRoundStartedAt,
      voiceLines: roundContent.voiceLines,
      turnRecords: roundContent.turnRecords,
      ...timerPatch,
      displayRoundSummaries: paginationState.displayRoundSummaries,
      cardCount: paginationState.cardCount,
      paginationIndexes: paginationState.paginationIndexes,
      cardIndex: paginationState.cardIndex,
      selectedPlayerIndex: paginationState.selectedPlayerIndex,
      indicatorPlayerIndex: paginationState.indicatorPlayerIndex,
      isPlayerFilterActive: paginationState.isPlayerFilterActive
    };

    if (roundChanged || sessionChanged) {
      patch.playHistory = [];
      patch.discussionNotes = [];
      patch.insertedImages = [];
      patch.voiceLines = [];
      patch.turnRecords = [];
      this._clearRoundStartedAtCache();
      const serverTs = roomState.partnerRoundStartedAt != null
        ? Number(roomState.partnerRoundStartedAt)
        : 0;
      patch.partnerRoundStartedAt = serverTs > 0 ? serverTs : null;
    }

    if (playerChanged || phaseChanged || roundChanged || sessionChanged || options.resetTurnUi) {
      patch.selectedScore = null;
      patch.canStartStatement = false;
      patch.scoredCount = 0;
      if (playerChanged || roundChanged || sessionChanged || options.resetTurnUi) {
        patch.filteredPlayerIndex = null;
        patch.isPlayerFilterActive = false;
        patch.cardIndexBeforeFilter = 0;
        this._playerFilterIndex = null;
      }
      if (!isClosingPhase(roomPhase) && (roundChanged || sessionChanged || options.resetTurnUi)) {
        const resetCardState = this._buildDisplayCardState({
          roundSummaries,
          members,
          filteredPlayerIndex: null,
          isPlayerFilterActive: false,
          currentPlayerIndex: player.currentPlayerIndex
        });
        patch.displayRoundSummaries = resetCardState.displayRoundSummaries;
        patch.cardCount = resetCardState.cardCount;
        patch.paginationIndexes = resetCardState.paginationIndexes;
        patch.cardIndex = resetCardState.cardIndex;
        patch.selectedPlayerIndex = resetCardState.selectedPlayerIndex;
        patch.indicatorPlayerIndex = resetCardState.indicatorPlayerIndex;
        patch.isPlayerFilterActive = false;
      }
    }

    if (becameMyTurn || leftMyTurn || roundChanged || sessionChanged) {
      patch.specialMoveUsedThisTurn = false;
    }
    if (becameMyTurn || roundChanged || sessionChanged) {
      clearPartnerSpecialMoveUsedFlag(this.data.roomId);
    }

    if (leftMyTurn) {
      patch.specialMoveUsedThisTurn = false;
    } else if (!(becameMyTurn || roundChanged || sessionChanged)) {
      patch.specialMoveUsedThisTurn = this._resolveSpecialMoveUsed(patch, members);
    }

    if (closingStepChanged || (phaseChanged && isClosingPhase(roomPhase))) {
      patch.cardIndex = closingStep === CLOSING_STEP_REVIEW ? 1 : 0;
    }

    this.setData(patch, () => {
      this._restartRoundTimer();
      this._syncRoundTimerVisible(patch.partnerRoundStartedAt);
      if (
        !patch.partnerRoundStartedAt
        && this.data.isHost
        && !isClosingPhase(this.data.gamepagePhase)
      ) {
        this._ensureRoundTimerStarted(true).then(() => {
          this._syncRoundTimerVisible(this.data.partnerRoundStartedAt);
          this._syncRoundSpeech();
        });
      } else {
        this._syncRoundSpeech();
      }
    });
    return { playerChanged, phaseChanged, roundChanged, members, player, roomPhase };
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
      }
      this._startStatePolling();

      this.refreshScoreStatus();
      this._startScorePolling();
      this._roomLoaded = true;
      await this._ensureRoundTimerStarted(result.isHost === true);
      this._syncRoundTimerVisible(this.data.partnerRoundStartedAt);
      await this._syncRoundSpeech();
      await this._syncRoundContentToRoom();
    } catch (e) {
      console.error('partner gamepage loadRoomData', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async refreshScoreStatus() {
    const { roomId, isHost, gamepagePhase } = this.data;
    if (!roomId || isClosingPhase(gamepagePhase)) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getGameScoreStatus',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) return;

      const scoredCount = result.scoredCount || 0;
      const totalRequired = result.totalRequired != null
        ? result.totalRequired
        : this.data.totalRequired;
      const canStartStatement = isHost
        && !isDiscussionPhase(gamepagePhase)
        && !isClosingPhase(gamepagePhase)
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
        followSubScreenRoomPoll(result, roomId, {
          beforeNavigate: (pollResult, page) => {
            if (page === 'gamepage') {
              const prevMaster = this.data.isMasterMode;
              const prevClosingStep = this.data.closingStep;
              const { playerChanged, phaseChanged, roundChanged } = this._applyRoomContext(pollResult);
              if (
                playerChanged
                || phaseChanged
                || roundChanged
                || prevMaster !== this.data.isMasterMode
                || prevClosingStep !== this.data.closingStep
              ) {
                this.refreshScoreStatus();
              }
              return true;
            }
            if (this.data.isHost && page === 'statement') {
              const idx = pollResult.roomState.currentPlayerIndex != null
                ? pollResult.roomState.currentPlayerIndex
                : this.data.currentPlayerIndex;
              const playerName = pollResult.roomState.currentPlayerName || this.data.currentPlayerName;
              safeOpenUrl(buildStatementUrl(roomId, idx, playerName));
              return true;
            }
            return false;
          }
        });
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
      if (extra && extra.partnerMasterMode != null) {
        data.partnerMasterMode = extra.partnerMasterMode;
      }
      if (extra && extra.partnerClosingStep != null) {
        data.partnerClosingStep = extra.partnerClosingStep;
      }
      if (extra && extra.roundSummary) {
        data.roundSummary = extra.roundSummary;
      }
      if (extra && extra.partnerCurrentRoundContent) {
        data.partnerCurrentRoundContent = extra.partnerCurrentRoundContent;
      }
      if (extra && extra.partnerRoundStartedAt != null) {
        data.partnerRoundStartedAt = extra.partnerRoundStartedAt;
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
    const maxIndex = (this.data.displayRoundSummaries || []).length;
    const cardIndex = Math.min(index, maxIndex);
    this.setData({
      cardIndex,
      indicatorPlayerIndex: this._resolveIndicatorPlayerIndex(cardIndex)
    });
  },

  handleAvatarTap(e) {
    if (isClosingPhase(this.data.gamepagePhase)) return;
    const id = e.detail && (e.detail.playerIndex != null ? e.detail.playerIndex : e.detail.id);
    if (id == null || id === '') return;

    const playerIndex = parseInt(id, 10);
    if (Number.isNaN(playerIndex)) return;

    const {
      members,
      roundSummaries,
      currentPlayerIndex,
      isPlayerFilterActive,
      filteredPlayerIndex,
      cardIndexBeforeFilter,
      cardIndex
    } = this.data;
    const memberCount = (members || []).length;
    const activeFilter = this._resolveActivePlayerFilter();

    if (isPlayerFilterActive && isSamePlayerIndex(activeFilter, playerIndex)) {
      this._playerFilterIndex = null;
      const restoredIndex = cardIndexBeforeFilter != null
        ? cardIndexBeforeFilter
        : (roundSummaries || []).length;
      const cardState = this._buildDisplayCardState({
        roundSummaries,
        members,
        filteredPlayerIndex: null,
        isPlayerFilterActive: false,
        currentPlayerIndex,
        preferredCardIndex: restoredIndex
      });
      this.setData({
        filteredPlayerIndex: null,
        isPlayerFilterActive: false,
        cardIndexBeforeFilter: 0,
        ...cardState
      });
      return;
    }

    if (!playerHasSummaryCards(playerIndex, {
      roundSummaries,
      memberCount,
      currentPlayerIndex
    })) {
      wx.showToast({ title: '暂无发言纪要', icon: 'none' });
      return;
    }

    this._playerFilterIndex = playerIndex;

    const playerSummaries = buildDisplaySummaries(
      roundSummaries,
      members,
      playerIndex,
      true
    );
    const isActing = isSamePlayerIndex(playerIndex, currentPlayerIndex);
    const preferredCardIndex = isActing
      ? playerSummaries.length
      : Math.max(0, playerSummaries.length - 1);

    const cardState = this._buildDisplayCardState({
      roundSummaries,
      members,
      filteredPlayerIndex: playerIndex,
      isPlayerFilterActive: true,
      currentPlayerIndex,
      preferredCardIndex
    });

    this.setData({
      filteredPlayerIndex: playerIndex,
      isPlayerFilterActive: true,
      cardIndexBeforeFilter: cardIndex,
      ...cardState
    });
  },

  _findSummaryIndexByRound(round) {
    return (this.data.displayRoundSummaries || []).findIndex(
      (item) => item && parseInt(item.round, 10) === parseInt(round, 10)
    );
  },

  _saveRoundPrivateNote(round, note) {
    const idx = this._findSummaryIndexByRound(round);
    if (idx < 0) return;
    savePrivateRoundNote(
      this.data.roomId,
      this.data.brainstormSessionSeq,
      round,
      note
    );
    this.setData({
      [`displayRoundSummaries[${idx}].privateNote`]: note
    });
  },

  onRoundPrivateNoteInput(e) {
    const round = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.round
      : null;
    if (round == null) return;
    const idx = this._findSummaryIndexByRound(round);
    if (idx < 0) return;
    const text = (e.detail && e.detail.value) || '';
    const item = this.data.displayRoundSummaries[idx] || {};
    const photos = (item.privateNote && item.privateNote.photos) || [];
    this._saveRoundPrivateNote(round, { text, photos });
  },

  onRoundPrivateNotePhoto(e) {
    const round = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.round
      : null;
    if (round == null) return;
    const idx = this._findSummaryIndexByRound(round);
    if (idx < 0) return;
    const item = this.data.displayRoundSummaries[idx] || {};
    const photos = (item.privateNote && item.privateNote.photos) || [];
    if (photos.length >= 9) {
      wx.showToast({ title: '最多 9 张图片', icon: 'none' });
      return;
    }

    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        wx.chooseImage({
          count: 9 - photos.length,
          sizeType: ['compressed'],
          sourceType,
          success: async (chooseRes) => {
            const paths = chooseRes.tempFilePaths || [];
            if (!paths.length) return;
            wx.showLoading({ title: '保存中…', mask: true });
            try {
              const saved = [];
              for (let i = 0; i < paths.length; i += 1) {
                saved.push(await persistTempPhoto(paths[i]));
              }
              const text = (item.privateNote && item.privateNote.text) || '';
              this._saveRoundPrivateNote(round, {
                text,
                photos: photos.concat(saved)
              });
            } catch (err) {
              console.warn('onRoundPrivateNotePhoto', err);
              wx.showToast({ title: '图片保存失败', icon: 'none' });
            } finally {
              wx.hideLoading();
            }
          },
          fail: () => {
            wx.showToast({ title: '选择图片失败', icon: 'none' });
          }
        });
      }
    });
  },

  onRoundPrivateNotePhotoRemove(e) {
    const dataset = e.currentTarget && e.currentTarget.dataset;
    const round = dataset && dataset.round;
    const photoIndex = dataset && dataset.index != null ? parseInt(dataset.index, 10) : -1;
    if (round == null || photoIndex < 0) return;
    const idx = this._findSummaryIndexByRound(round);
    if (idx < 0) return;
    const item = this.data.displayRoundSummaries[idx] || {};
    const photos = ((item.privateNote && item.privateNote.photos) || []).slice();
    if (photoIndex >= photos.length) return;
    photos.splice(photoIndex, 1);
    const text = (item.privateNote && item.privateNote.text) || '';
    this._saveRoundPrivateNote(round, { text, photos });
  },

  onRoundPrivateNotePreview(e) {
    const dataset = e.currentTarget && e.currentTarget.dataset;
    const url = dataset && dataset.url;
    const round = dataset && dataset.round;
    if (!url) return;
    const idx = this._findSummaryIndexByRound(round);
    const item = idx >= 0 ? this.data.displayRoundSummaries[idx] : null;
    const urls = item && item.privateNote ? item.privateNote.photos || [] : [url];
    wx.previewImage({ current: url, urls });
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
    if (!this.data.isCurrentPlayer) {
      wx.showToast({ title: '请等待您的轮次', icon: 'none' });
      return;
    }
    if (this.data.isMasterMode || this.data.specialMoveUsedThisTurn) return;
    const { roomId, members } = this.data;
    if (!roomId) return;
    const me = (members || []).find((m) => m.isMe);
    const initiatorIndex = me ? me.playerIndex : this.data.currentPlayerIndex;
    wx.navigateTo({ url: buildSpecialMoveUrl(roomId, initiatorIndex) });
  },

  async handleStartStatement() {
    if (!this.data.canStartStatement || isDiscussionPhase(this.data.gamepagePhase)) return;

    this._stopRoundSpeech();
    this._stopStatePolling();
    await this._syncRoundContentToRoom();

    const { roomId, currentPlayerIndex, currentPlayerName } = this.data;
    const ok = await this._updateRoomState('statement', currentPlayerIndex, currentPlayerName, {
      partnerMasterMode: false
    });
    if (!ok) {
      this._startStatePolling();
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
    const extra = {
      partnerGamePhase: PHASE_PLAY,
      partnerMasterMode: false,
      incrementRound
    };
    if (incrementRound) {
      const ctx = await this._syncRoomContext();
      const roundContent = ctx && ctx.roundContent;
      extra.roundSummary = {
        ...this._buildRoundSummaryPayload(),
        voiceLines: (roundContent && roundContent.voiceLines.length)
          ? roundContent.voiceLines
          : (this.data.voiceLines || []),
        turnRecords: (roundContent && roundContent.turnRecords.length)
          ? roundContent.turnRecords
          : (this.data.turnRecords || [])
      };
    }
    const ok = await this._updateRoomState('gamepage', nextIndex, nextName, extra);
    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }

    this.setData({
      currentPlayerIndex: nextIndex,
      currentPlayerName: nextName,
      gamepagePhase: PHASE_PLAY,
      isMasterMode: false,
      selectedScore: null,
      canStartStatement: false,
      scoredCount: 0,
      specialMoveUsedThisTurn: false,
      isCurrentPlayer: !!(members.find((m) => m.isMe && m.playerIndex === nextIndex)),
      playHistory: incrementRound ? [] : this.data.playHistory,
      discussionNotes: incrementRound ? [] : this.data.discussionNotes,
      insertedImages: incrementRound ? [] : this.data.insertedImages,
      voiceLines: incrementRound ? [] : this.data.voiceLines,
      turnRecords: incrementRound ? [] : this.data.turnRecords
    }, () => {
      if (incrementRound) {
        this._roundSpeech && this._roundSpeech.stop();
        this._syncRoomContext().then(() => this._syncRoundSpeech());
      } else {
        this.refreshScoreStatus();
        this._syncRoundSpeech();
      }
    });
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

  async handleClosingNextStep() {
    if (!this.data.isHost) {
      wx.showToast({ title: '请等待房主操作', icon: 'none' });
      return;
    }
    const { roomId, currentPlayerIndex, currentPlayerName } = this.data;
    const ok = await this._updateRoomState('gamepage', currentPlayerIndex, currentPlayerName, {
      partnerGamePhase: PHASE_CLOSING,
      partnerClosingStep: CLOSING_STEP_REVIEW
    });
    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }
    this.setData({
      closingStep: CLOSING_STEP_REVIEW,
      cardIndex: 1
    });
  },

  async handleEndBrainstorm() {
    if (!this.data.isHost) {
      wx.showToast({ title: '请等待房主结束脑暴', icon: 'none' });
      return;
    }
    const { roomId, currentPlayerIndex, currentPlayerName } = this.data;
    const ok = await this._updateRoomState('closingEnd', currentPlayerIndex, currentPlayerName, {
      partnerGamePhase: PHASE_CLOSING
    });
    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }
    safeOpenUrl(buildClosingEndUrl(roomId));
  },

  handleClosingPhoto() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        const remain = 9 - (this.data.reviewPhotos || []).length;
        if (remain <= 0) {
          wx.showToast({ title: '最多拍摄 9 张', icon: 'none' });
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
              reviewPhotos: [...(this.data.reviewPhotos || []), ...paths]
            });
          }
        });
      }
    });
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
