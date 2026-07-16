/**
 * 脑暴大富翁（partnerMode）- 出牌页
 * 路径：pages/main-pages/partnerMode/gamepage/
 */
const { assignAvatarImages } = require('../../../../utils/avatars');
const { buildStatementUrl, buildSpecialMoveUrl, buildClosingEndUrl, buildClosingStatementUrl } = require('../../../../utils/modeRoutes');
const { navigateByRoomState, safeOpenUrl } = require('../../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const { openPartnerPage } = require('../../../../utils/pageNavigate');
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
const {
  countSessionInspirations,
  withSessionFields
} = require('../../../../utils/partnerInspirationSession');
const { goRoomPage } = require('../../../../utils/goRoomPage');

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
    /** 当前行动玩家本轮首次倒计时起点；卡片循环重启不更新，供头像框同步 */
    avatarRoundStartedAt: null,
    roundTimerVisible: false,
    roundTimerElapsedRatio: 0,
    roundTimerRemainingSec: 30,
    cardCount: 1,
    paginationIndexes: [0],
    playHistory: [],
    discussionNotes: [],
    voiceLines: [],
    turnRecords: [],
    inspirationCount: 0,
    inspirationDraftText: '',
    inspirationDraftPhotos: [],
    inspirationInputFocused: false,
    inspirationHoldKeyboard: false,
    inspirationSaving: false,
    inspirationHasText: false
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
    if (this.data.roomId) {
      this._startStatePolling();
      this._startScorePolling();
    }
    // 进入页：同步房间倒计时（房主负责重开并广播，其他人跟随）
    this._ensureSharedRoundTimerOnEnter().then(() => {
      this._applyPendingSpecialMoveUsed();
      this.refreshScoreStatus();
      this._syncRoundSpeech();
      this._refreshInspirationCount();
    });
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
    this._stopRoundTimerBurstPoll();
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
    this._stopRoundTimerBurstPoll();
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
      // 房主兜底：本地到期立刻开下一轮，避免只靠组件事件导致全员卡住
      if (timerState.remainingSec <= 0) {
        if (this.data.isHost === true && !this._rollingRoundCountdown) {
          this._rollRoundCountdown();
        }
        if (!this._roundTimerBurstTimer) {
          this._startRoundTimerBurstPoll();
        }
      }
    };

    tick();
    this._roundTimerInterval = setInterval(tick, 250);
  },

  _stopRoundTimer() {
    if (this._roundTimerInterval) {
      clearInterval(this._roundTimerInterval);
      this._roundTimerInterval = null;
    }
  },

  /**
   * 倒计时到期后加速拉取服务器 startedAt，缩短非房主刷新延迟
   */
  _startRoundTimerBurstPoll() {
    this._stopRoundTimerBurstPoll();
    let count = 0;
    const tick = async () => {
      count += 1;
      if (count > 16 || !this.data.roomId || isClosingPhase(this.data.gamepagePhase)) {
        this._stopRoundTimerBurstPoll();
        return;
      }
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId: this.data.roomId }
        });
        const result = (res && res.result) || {};
        const next = result.roomState && result.roomState.partnerRoundStartedAt != null
          ? Number(result.roomState.partnerRoundStartedAt)
          : 0;
        // 非房主：仅在服务端戳更新且不被本地防回滚拒绝时应用
        if (
          next > 0
          && next !== Number(this.data.partnerRoundStartedAt)
          && isRoundTimerActive(next)
        ) {
          this._applySharedRoundTimer(next);
          if (Number(this.data.partnerRoundStartedAt) === next) {
            this._stopRoundTimerBurstPoll();
          }
        }
      } catch (e) {
        console.warn('_startRoundTimerBurstPoll', e);
      }
    };
    tick();
    this._roundTimerBurstTimer = setInterval(tick, 350);
  },

  _stopRoundTimerBurstPoll() {
    if (this._roundTimerBurstTimer) {
      clearInterval(this._roundTimerBurstTimer);
      this._roundTimerBurstTimer = null;
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
    // 全体玩家统一只信服务器时间戳；忽略过期戳，避免轮询把已滚的新周期打回旧周期
    const fromServer = roomState.partnerRoundStartedAt != null
      ? Number(roomState.partnerRoundStartedAt)
      : 0;
    if (!Number.isFinite(fromServer) || fromServer <= 0) return null;

    const pending = Number(this._pendingRoundStartedAt) || 0;
    // 房主刚写入的本地戳优先，防止写库完成前被旧服务端戳回滚
    if (pending > 0 && fromServer < pending) {
      return pending;
    }

    if (isRoundTimerActive(fromServer)) {
      this._cacheRoundStartedAt(this.data.roomId, currentRound, fromServer);
      return fromServer;
    }

    // 服务端戳已过期：若本地仍活跃则保留本地；否则返回 null 等待滚下一轮
    const local = Number(this.data.partnerRoundStartedAt) || 0;
    if (local > 0 && isRoundTimerActive(local)) {
      return local;
    }
    return null;
  },

  /**
   * 应用共享倒计时：设置起点并让所有玩家都可见（卡片框 + 头像框）
   * @param {number|null} startedAt
   * @param {{force?: boolean}} [options] force=true 时允许覆盖（进页初始化）
   */
  _turnTimerKey(round, playerIndex) {
    return `${round != null ? round : this.data.currentRound}-${playerIndex != null ? playerIndex : this.data.currentPlayerIndex}`;
  },

  /**
   * 解析头像框锚点：只信 partnerTurnStartedAt；缺失时同回合锁定本地首次值，绝不跟卡片循环戳
   */
  _resolveAvatarRoundStartedAt(roomState, partnerRoundStartedAt, turnChanged, currentRound, playerIndex) {
    if (isClosingPhase(this.data.gamepagePhase)) return null;
    const turnTs = roomState && roomState.partnerTurnStartedAt != null
      ? Number(roomState.partnerTurnStartedAt)
      : 0;
    const cardTs = Number(partnerRoundStartedAt) || 0;
    if (Number.isFinite(turnTs) && turnTs > 0) {
      // 换人后若服务端回合锚点尚未刷新（仍是上一玩家），用更新的卡片戳
      if (turnChanged && cardTs > turnTs) return cardTs;
      return turnTs;
    }

    const key = this._turnTimerKey(currentRound, playerIndex);
    const locked = Number(this.data.avatarRoundStartedAt) || 0;
    // 同一行动回合：保持已锁定锚点，防止被卡片循环的 partnerRoundStartedAt 污染
    if (!turnChanged && this._avatarTimerTurnKey === key && locked > 0) {
      return locked;
    }
    // 仅新回合允许用卡片戳作为首次锚点（兼容未部署 partnerTurnStartedAt 的旧房间）
    return cardTs > 0 ? cardTs : null;
  },

  /**
   * 头像框只用「本回合首次」时间戳；卡片循环滚动 partnerRoundStartedAt 时不得覆盖
   */
  _syncAvatarRoundStartedAt(ts, options = {}) {
    const force = options.force === true;
    const next = Number(ts);
    if (!Number.isFinite(next) || next <= 0 || isClosingPhase(this.data.gamepagePhase)) {
      if (this.data.avatarRoundStartedAt != null) {
        this.setData({ avatarRoundStartedAt: null });
      }
      this._avatarTimerTurnKey = '';
      return;
    }
    const key = options.turnKey || this._turnTimerKey();
    // 非强制：同回合已有锚点则永不覆盖（卡片循环/轮询都走这里）
    if (!force && this._avatarTimerTurnKey === key && this.data.avatarRoundStartedAt) {
      return;
    }
    this._avatarTimerTurnKey = key;
    if (Number(this.data.avatarRoundStartedAt) !== next) {
      this.setData({ avatarRoundStartedAt: next });
    }
  },

  _applySharedRoundTimer(startedAt, options = {}) {
    const force = options.force === true;
    const ts = Number(startedAt);
    if (!Number.isFinite(ts) || ts <= 0 || isClosingPhase(this.data.gamepagePhase)) {
      this.setData({
        partnerRoundStartedAt: null,
        avatarRoundStartedAt: null,
        roundTimerVisible: false,
        roundTimerElapsedRatio: 0
      });
      this._avatarTimerTurnKey = '';
      this._stopRoundTimer();
      return;
    }

    const current = Number(this.data.partnerRoundStartedAt) || 0;
    const pending = Number(this._pendingRoundStartedAt) || 0;

    // 禁止更旧戳覆盖（含写库竞态期的服务端旧值）
    if (!force) {
      if (pending > 0 && ts < pending) return;
      if (current > 0 && ts < current) return;
      if (current > 0 && isRoundTimerActive(current) && !isRoundTimerActive(ts)) return;
    }

    if (pending > 0 && ts >= pending) {
      this._pendingRoundStartedAt = 0;
    }

    const timerState = getRoundTimerState(ts);
    this._cacheRoundStartedAt(this.data.roomId, this.data.currentRound, ts);
    this.setData({
      partnerRoundStartedAt: ts,
      roundTimerVisible: this._pageVisible !== false,
      roundTimerRemainingSec: timerState.remainingSec,
      roundTimerElapsedRatio: timerState.elapsedRatio
    });
    // 仅换人/进页显式同步头像锚点；卡片循环禁止碰头像锚点
    if (options.syncTurnAvatar === true) {
      this._syncAvatarRoundStartedAt(ts, { force: true });
    }
    this._restartRoundTimer();
  },

  /**
   * 进入 gamepage：有活跃服务端计时则跟随；否则仅房主开新一轮并广播
   */
  async _ensureSharedRoundTimerOnEnter() {
    if (isClosingPhase(this.data.gamepagePhase)) {
      this._pendingRoundStartedAt = 0;
      this._applySharedRoundTimer(null, { force: true });
      return;
    }
    if (!this.data.roomId) return;
    if (this._syncingRoundTimer) return;
    this._syncingRoundTimer = true;
    try {
      let serverStartedAt = null;
      let serverTurnStartedAt = null;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId: this.data.roomId }
        });
        const result = (res && res.result) || {};
        if (result.ok === true && result.roomState) {
          if (result.isHost === true && this.data.isHost !== true) {
            this.setData({ isHost: true });
          } else if (result.isHost === false && this.data.isHost === true) {
            this.setData({ isHost: false });
          }
          const ts = result.roomState.partnerRoundStartedAt != null
            ? Number(result.roomState.partnerRoundStartedAt)
            : 0;
          if (Number.isFinite(ts) && ts > 0 && isRoundTimerActive(ts)) {
            serverStartedAt = ts;
          }
          const turnTs = result.roomState.partnerTurnStartedAt != null
            ? Number(result.roomState.partnerTurnStartedAt)
            : 0;
          if (Number.isFinite(turnTs) && turnTs > 0) {
            serverTurnStartedAt = turnTs;
          }
        }
      } catch (e) {
        console.warn('_ensureSharedRoundTimerOnEnter fetch', e);
      }

      // 已有活跃计时：全员（含房主）只跟随；头像锚点用回合级时间戳，勿被卡片循环戳覆盖
      if (serverStartedAt) {
        this._applySharedRoundTimer(serverStartedAt, { force: true, syncTurnAvatar: false });
        this._syncAvatarRoundStartedAt(serverTurnStartedAt || serverStartedAt, { force: true });
        return;
      }

      if (this.data.isHost === true) {
        const startedAt = Date.now();
        this._pendingRoundStartedAt = startedAt;
        this._applySharedRoundTimer(startedAt, { force: true, syncTurnAvatar: true });
        const { currentPlayerIndex, currentPlayerName } = this.data;
        try {
          await this._updateRoomState('gamepage', currentPlayerIndex, currentPlayerName, {
            partnerRoundStartedAt: startedAt,
            partnerGamePhase: this.data.gamepagePhase,
            syncPartnerTurnTimer: true
          });
        } catch (e) {
          console.warn('_ensureSharedRoundTimerOnEnter write', e);
        }
        return;
      }

      // 非房主等待房主广播，不使用本地 Date.now() 占位（会永久不同步）
      this._syncRoundTimerVisible(null);
      this._startRoundTimerBurstPoll();
    } finally {
      this._syncingRoundTimer = false;
    }
  },

  _syncRoundTimerVisible(partnerRoundStartedAt) {
    const visible = !!(
      this._pageVisible !== false
      && partnerRoundStartedAt
      && !isClosingPhase(this.data.gamepagePhase)
    );
    if (visible !== this.data.roundTimerVisible) {
      this.setData({ roundTimerVisible: visible });
    }
  },

  async _rollRoundCountdown() {
    // 只由房主重启循环，避免多端各自 Date.now() 导致不同步
    if (!this.data.isHost) return;
    if (this._rollingRoundCountdown) return;
    // 卡片框与头像框都会触发到期；当前周期仍有效则不再开新一轮
    if (isRoundTimerActive(this.data.partnerRoundStartedAt)) return;
    const { roomId, currentPlayerIndex, currentPlayerName } = this.data;
    if (!roomId || isClosingPhase(this.data.gamepagePhase)) return;

    this._rollingRoundCountdown = true;
    const ts = Date.now();
    this._pendingRoundStartedAt = ts;
    // 卡片循环：只滚 partnerRoundStartedAt，不刷新头像首次锚点
    this._applySharedRoundTimer(ts, { force: true, syncTurnAvatar: false });
    try {
      await this._updateRoomState('gamepage', currentPlayerIndex, currentPlayerName, {
        partnerRoundStartedAt: ts,
        syncPartnerTurnTimer: false
      });
    } catch (e) {
      console.warn('_rollRoundCountdown', e);
    } finally {
      this._rollingRoundCountdown = false;
    }
  },

  handleRoundTimerExpire(e) {
    const detail = (e && e.detail) || {};
    // 卡片框/头像框到期都会进这里；防抖合并，避免双通道打出两轮不同 Date.now()
    if (detail.loop === false) return;
    const now = Date.now();
    if (this._lastExpireHandledAt && now - this._lastExpireHandledAt < 1500) {
      return;
    }
    this._lastExpireHandledAt = now;
    if (this.data.isHost === true) {
      this._rollRoundCountdown();
    }
    this._startRoundTimerBurstPoll();
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
    const turnChanged = playerChanged || roundChanged || sessionChanged || options.resetTurnUi;
    const avatarRoundStartedAt = isClosingPhase(roomPhase)
      ? null
      : this._resolveAvatarRoundStartedAt(
        roomState,
        partnerRoundStartedAt,
        turnChanged,
        currentRound,
        player.currentPlayerIndex
      );
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
      avatarRoundStartedAt: isClosingPhase(roomPhase) ? null : avatarRoundStartedAt,
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

    const prevStartedAt = Number(this.data.partnerRoundStartedAt) || 0;
    const nextStartedAt = Number(patch.partnerRoundStartedAt) || 0;
    // 先锁定本回合头像 key，避免 setData 后被卡片戳二次覆盖
    if (!isClosingPhase(roomPhase) && avatarRoundStartedAt) {
      this._avatarTimerTurnKey = this._turnTimerKey(currentRound, player.currentPlayerIndex);
    } else if (isClosingPhase(roomPhase) || turnChanged) {
      // turnChanged 时下面会用新锚点重锁
      if (isClosingPhase(roomPhase)) this._avatarTimerTurnKey = '';
    }
    this.setData(patch, () => {
      if (!isClosingPhase(roomPhase) && patch.partnerRoundStartedAt) {
        // 卡片时间戳变化：绝不 syncTurnAvatar（头像锚点已在 patch 中按回合锁定）
        if (nextStartedAt !== prevStartedAt) {
          this._applySharedRoundTimer(patch.partnerRoundStartedAt, {
            syncTurnAvatar: false
          });
        } else {
          this._syncRoundTimerVisible(patch.partnerRoundStartedAt);
          this._syncTimerFromStartedAt();
        }
        if (patch.avatarRoundStartedAt) {
          this._syncAvatarRoundStartedAt(patch.avatarRoundStartedAt, {
            force: turnChanged,
            turnKey: this._turnTimerKey(currentRound, player.currentPlayerIndex)
          });
        }
      } else if (isClosingPhase(roomPhase)) {
        this._applySharedRoundTimer(null, { force: true });
      } else {
        this._restartRoundTimer();
        this._syncRoundTimerVisible(patch.partnerRoundStartedAt);
      }
      this._syncRoundSpeech();
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

      const app = getApp();
      const selectedProblem = resolveSelectedDesignProblem(app, result);
      const selectedProblemText = selectedProblem && selectedProblem.text
        ? selectedProblem.text
        : '';

      this._applyRoomContext(result, {
        fallbackPlayerIndex: this.data.currentPlayerIndex,
        resetTurnUi: true
      });

      this.setData({
        isHost: result.isHost === true,
        selectedProblemText
      });

      this._startStatePolling();
      this.refreshScoreStatus();
      this._startScorePolling();
      this._roomLoaded = true;
      // 房主重开并广播；其他端跟随同一时间戳显示倒计时
      await this._ensureSharedRoundTimerOnEnter();
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
            const state = pollResult.roomState || {};
            // 房主/副屏：收尾相关页必须主动跳转（followSubScreenRoomPoll 对房主不会 navigate）
            if (page === 'closingstatement') {
              safeOpenUrl(buildClosingStatementUrl(roomId, {
                closingVoteSessionId: state.closingVoteSessionId || '',
                _t: Date.now()
              }), { immediate: true });
              return true;
            }
            if (page === 'closingend') {
              safeOpenUrl(buildClosingEndUrl(roomId), { immediate: true });
              return true;
            }
            if (page === 'gamepage') {
              const prevMaster = this.data.isMasterMode;
              const prevClosingStep = this.data.closingStep;
              const { playerChanged, phaseChanged, roundChanged } = this._applyRoomContext(pollResult);
              // 倒计时已由 _applyRoomContext 统一处理，避免二次 apply 造成回滚
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
            if (page === 'statement') {
              const idx = state.currentPlayerIndex != null
                ? state.currentPlayerIndex
                : this.data.currentPlayerIndex;
              const playerName = state.currentPlayerName || this.data.currentPlayerName;
              safeOpenUrl(buildStatementUrl(roomId, idx, playerName), { immediate: true });
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
    // 缩短间隔，让非房主更快跟上新一轮 startedAt（到期后另有 burst poll）
    this._statePollTimer = setInterval(poll, 800);
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
      if (extra && extra.syncPartnerTurnTimer != null) {
        data.syncPartnerTurnTimer = extra.syncPartnerTurnTimer === true;
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
    // 先停轮询，避免 navigate 过程中被房间态打回 gamepage
    this._stopStatePolling();
    this._stopRoundTimerBurstPoll();
    const url = buildSpecialMoveUrl(roomId, initiatorIndex);
    const opened = openPartnerPage(url);
    if (!opened) {
      wx.navigateTo({
        url,
        fail: () => {
          this._startStatePolling();
          wx.showToast({ title: '打开失败，请重试', icon: 'none' });
        }
      });
    }
  },

  async handleStartStatement() {
    if (!this.data.canStartStatement || isDiscussionPhase(this.data.gamepagePhase)) return;

    this._stopRoundSpeech();
    this._stopStatePolling();
    this._stopRoundTimerBurstPoll();
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
    goRoomPage(this.data.roomId);
  },

  async _refreshInspirationCount() {
    const { roomId, brainstormSessionSeq } = this.data;
    if (!roomId) return;
    const inspirationCount = await countSessionInspirations(roomId, brainstormSessionSeq);
    if (inspirationCount !== this.data.inspirationCount) {
      this.setData({ inspirationCount });
    }
  },

  onInspirationComposerTap() {
    if (!this.data.inspirationInputFocused) {
      this.setData({ inspirationInputFocused: true });
    }
  },

  onInspirationFocus() {
    if (this._inspirationBlurTimer) {
      clearTimeout(this._inspirationBlurTimer);
      this._inspirationBlurTimer = null;
    }
    this.setData({ inspirationInputFocused: true });
  },

  onInspirationBlur() {
    if (this._inspirationBlurTimer) clearTimeout(this._inspirationBlurTimer);
    this._inspirationBlurTimer = setTimeout(() => {
      this.setData({ inspirationInputFocused: false, inspirationHoldKeyboard: false });
    }, 180);
  },

  onInspirationDismissFocus() {
    if (this._inspirationBlurTimer) {
      clearTimeout(this._inspirationBlurTimer);
      this._inspirationBlurTimer = null;
    }
    this.setData({ inspirationInputFocused: false, inspirationHoldKeyboard: false });
  },

  onInspirationInput(e) {
    const text = (e.detail && e.detail.value) || '';
    this.setData({
      inspirationDraftText: text,
      inspirationHasText: !!text.trim()
    });
  },

  _shouldShowInspirationCamera() {
    return this.data.inspirationInputFocused && !this.data.inspirationHasText;
  },

  onInspirationActionTap() {
    if (this._shouldShowInspirationCamera()) {
      this.onInspirationAddPhoto();
      return;
    }
    this.onInspirationSave();
  },

  onInspirationAddPhoto() {
    const photos = this.data.inspirationDraftPhotos || [];
    if (photos.length >= 9) {
      wx.showToast({ title: '最多 9 张图片', icon: 'none' });
      return;
    }
    this.setData({ inspirationHoldKeyboard: true });
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        wx.chooseImage({
          count: 9 - photos.length,
          sizeType: ['compressed'],
          sourceType,
          success: (chooseRes) => {
            const paths = chooseRes.tempFilePaths || [];
            if (!paths.length) {
              this.setData({ inspirationHoldKeyboard: false });
              return;
            }
            this.setData({
              inspirationDraftPhotos: photos.concat(paths),
              inspirationInputFocused: true,
              inspirationHoldKeyboard: true
            });
          },
          fail: () => {
            this.setData({ inspirationHoldKeyboard: false, inspirationInputFocused: true });
          }
        });
      },
      fail: () => {
        this.setData({ inspirationHoldKeyboard: false });
      }
    });
  },

  onInspirationRemovePhoto(e) {
    const index = e.currentTarget.dataset.index;
    if (index == null) return;
    const photos = (this.data.inspirationDraftPhotos || []).slice();
    photos.splice(index, 1);
    this.setData({ inspirationDraftPhotos: photos });
  },

  onInspirationPreviewPhoto(e) {
    const url = e.currentTarget.dataset.url;
    const urls = this.data.inspirationDraftPhotos || [];
    if (!url) return;
    wx.previewImage({ current: url, urls });
  },

  async _uploadInspirationPhotos(paths) {
    const roomId = this.data.roomId || 'default';
    const results = [];
    for (let i = 0; i < paths.length; i += 1) {
      const filePath = paths[i];
      try {
        const cloudPath = `inspiration/${roomId}/${Date.now()}_${i}.jpg`;
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
        if (uploadRes && uploadRes.fileID) {
          results.push(uploadRes.fileID);
          continue;
        }
      } catch (e) {
        console.warn('_uploadInspirationPhotos cloud fail', e);
      }
      results.push(await persistTempPhoto(filePath));
    }
    return results;
  },

  async onInspirationSave() {
    if (this.data.inspirationSaving) return;
    const content = (this.data.inspirationDraftText || '').trim();
    const draftPhotos = this.data.inspirationDraftPhotos || [];
    if (!content && !draftPhotos.length) {
      wx.showToast({ title: '请输入灵感内容', icon: 'none' });
      return;
    }

    this.setData({ inspirationSaving: true });
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      const imageUrls = draftPhotos.length
        ? await this._uploadInspirationPhotos(draftPhotos)
        : [];
      const saveRes = await wx.cloud.callFunction({
        name: 'saveInspiration',
        data: withSessionFields({
          type: imageUrls.length ? 'image' : 'text',
          content,
          imageUrls,
          isAIGenerated: false
        }, this.data.roomId, this.data.brainstormSessionSeq)
      });
      const result = (saveRes && saveRes.result) || {};
      if (result.ok !== true) {
        throw new Error(result.errMsg || '保存失败');
      }
      this.setData({
        inspirationDraftText: '',
        inspirationDraftPhotos: [],
        inspirationHasText: false,
        inspirationInputFocused: false,
        inspirationHoldKeyboard: false
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      await this._refreshInspirationCount();
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ inspirationSaving: false });
      wx.hideLoading();
    }
  },

  handleGoInspirationCenter() {
    const roomId = this.data.roomId || '';
    let url = '/pages/inspiration/index?scope=workshop';
    if (roomId) {
      url += `&roomId=${encodeURIComponent(roomId)}`;
    }
    wx.navigateTo({ url });
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
