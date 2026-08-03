/**
 * 脑暴大富翁（partnerMode）- 出牌页
 * 路径：pages/main-pages/partnerMode/gamepage/
 */
const {
  assignAvatarImages,
  getMemberAvatarFingerprint
} = require('../../../../utils/avatars');

/** 匿名表达统一灰色默认头像（不区分玩家） */
const EXPRESS_ANON_AVATAR = '/assets/home/user-avatar-default.png';
const { buildStatementUrl, buildSpecialMoveUrl, buildClosingEndUrl, buildClosingStatementUrl } = require('../../../../utils/modeRoutes');
const { navigateByRoomState, safeOpenUrl, openPartnerPage } = require('../../../../utils/subAwaitRoutes');
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
  resolveCurrentPlayerFromRoom,
  toPlayerIndex
} = require('../../../../utils/partnerPlayerTurn');
const {
  clearPartnerSpecialMoveUsedFlag,
  markPartnerSpecialMoveUsed,
  isSpecialMoveUsedForCurrentTurn
} = require('../../../../utils/partnerSpecialMove');
const {
  getRoundTimerState,
  buildPaginationDots,
  isRoundTimerActive,
  getSyncedNow,
  ROUND_DURATION_SEC
} = require('../../../../utils/partnerRoundTimer');
const {
  normalizePartnerRoundContent,
  normalizeContentBlocks,
  appendTextSegments,
  appendImageBlocks,
  deriveListsFromBlocks,
  splitRecordSegments
} = require('../../../../utils/partnerRoundContent');
const {
  buildDisplaySummaries,
  playerHasSummaryCards,
  isSamePlayerIndex
} = require('../../../../utils/partnerRoundNavigation');
const { createPartnerRoundSpeech } = require('../../../../utils/partnerRoundSpeech');
const {
  attachPrivateNotesToSummaries,
  loadAllPrivateNotes,
  loadPrivateRoundNote,
  savePrivateRoundNote,
  persistTempPhoto
} = require('../../../../utils/partnerRoundPrivateNotes');
const {
  countSessionInspirations,
  withSessionFields
} = require('../../../../utils/partnerInspirationSession');
const { goRoomPage } = require('../../../../utils/goRoomPage');

/** 房主首次进入 gamepage 的「开始表态」引导，设备级只展示一次 */
const HOST_STATEMENT_TIP_KEY = 'partnerHostGamepageTipSeen';

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
    /** 底部「特殊行动」：仅当前出牌玩家本人可见 */
    showSpecialMoveBtn: false,
    selectedProblemText: '',
    problemExpanded: false,
    problemTextOverflow: false,
    gamepagePhase: PHASE_PLAY,
    cardIndex: 0,
    playImages: [],
    discussionImages: [],
    playBlocks: [],
    discussionBlocks: [],
    scoreOptions: [0, 1, 2, 3, 4, 5],
    selectedScore: null,
    scoredCount: 0,
    /** 打分抽屉：translateY=0 全展开；=max 仅露头部 */
    scorePanelExpanded: false,
    scoreSheetTranslateY: 120,
    scoreSheetCollapsedPx: 72,
    scoreSheetMaxTranslateY: 120,
    /** 裁剪可见高度 = collapsed + (maxY - translateY)，与 transform 同步 */
    scoreSheetVisiblePx: 72,
    scoreSheetAnimating: false,
    totalRequired: 0,
    isMasterMode: false,
    closingStep: CLOSING_STEP_RUNE,
    closingQuestionPlayers: [],
    reviewPhotos: [],
    closingReviewRounds: [],
    closingCreativeBlocks: [],
    closingHasDeckImage: false,
    closingCreativeEditText: '',
    closingCreativeEditFocus: false,
    closingCreativeSaving: false,
    playDraftText: '',
    playDraftFocused: false,
    discussionDraftText: '',
    discussionDraftFocused: false,
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
    /** 服务端 max / startTime 就绪前不启动倒计时 */
    roundTimerReady: false,
    roundTimerMaxSec: ROUND_DURATION_SEC,
    roundTimerElapsedRatio: 0,
    roundTimerRemainingSec: ROUND_DURATION_SEC,
    cardCount: 1,
    paginationDots: [{ key: 0, sizeClass: 'dot-lg', active: true }],
    playHistory: [],
    discussionNotes: [],
    voiceLines: [],
    turnRecords: [],
    inspirationCount: 0,
    inspirationDraftText: '',
    inspirationDraftPhotos: [],
    inspirationInputFocused: false,
    inspirationHoldKeyboard: false,
    inspirationKeyboardHeight: 0,
    /** transform 上移量；不改文档流，避免进页/点击闪动 */
    inspirationLiftStyle: '',
    inspirationSaving: false,
    inspirationHasText: false,
    topBarPaddingRight: 30,
    cardDraftText: '',
    cardDraftPhotos: [],
    cardDraftHasText: false,
    cardDraftSaving: false,
    /** 讨论卡内联输入（兼容旧字段，插图后聚焦用） */
    cardInlineEditTarget: '',
    cardInlineEditText: '',
    cardInlineEditFocus: false,
    cardInlineEditSaving: false,
    expressModalVisible: false,
    expressChatPanelVisible: false,
    expressCanSend: false,
    expressComposerOpen: false,
    expressDraftText: '',
    expressHasText: false,
    expressSending: false,
    expressChatList: [],
    /** 讨论卡：出牌阶段匿名表达 */
    playExpressChatList: [],
    /** 讨论卡：疑问讨论阶段匿名表达 */
    discussionExpressChatList: [],
    expressChatAnchor: '',
    discussionExpressChatAnchor: '',
    expressViewRound: 0,
    /** 房主首次进入：开始表态按钮引导蒙层 */
    showHostStatementTip: false,
    hostStatementTipReady: false,
    hostStatementTipSpotStyle: '',
    hostStatementTipTextStyle: ''
  },

  _applyTopBarSafeInset() {
    try {
      const menu = wx.getMenuButtonBoundingClientRect();
      const sys = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const windowWidth = (sys && sys.windowWidth) || 375;
      // 避开右上角胶囊：保留「屏幕右边距到胶囊左边」的空间
      const rightPx = Math.max(12, windowWidth - (menu.left || windowWidth) + 8);
      const rightRpx = Math.ceil((rightPx * 750) / windowWidth);
      this.setData({ topBarPaddingRight: rightRpx });
    } catch (e) {
      this.setData({ topBarPaddingRight: 200 });
    }
  },

  onLoad(options) {
    this._playerFilterIndex = null;
    this._expressAnonColorMap = Object.create(null);
    this._expressMessagesAll = [];
    this._seenExpressIds = {};
    this._expressReady = false;
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

    // 进房先清旧倒计时，避免沿用上一房间/阶段
    this._resetRoundTimerSession();

    this._applyTopBarSafeInset();
    this.loadRoomData();
    this._roundSpeech = createPartnerRoundSpeech({
      onText: () => this._syncRoomContext()
    });
  },

  _applyPendingSpecialMoveUsed() {
    const roomId = this.data.roomId;
    if (!roomId) return;

    // 非当前出牌玩家不展示特殊行动，无需同步已使用态
    if (!this.data.isCurrentPlayer) {
      this.setData({ specialMoveUsedThisTurn: false });
      return;
    }

    const currentPlayerIndex = this.data.currentPlayerIndex;
    const app = getApp();
    const flag = app.globalData && app.globalData.partnerSpecialMoveUsedTurn;
    if (flag && flag.roomId === roomId) {
      // 仅当标记属于本人且为本轮出牌玩家时才视为已使用
      if (toPlayerIndex(flag.playerIndex, 0) === toPlayerIndex(currentPlayerIndex, 0)) {
        this.setData({ specialMoveUsedThisTurn: true });
        return;
      }
      // 过期轮次标记清掉，避免误锁按钮
      if (app.globalData) {
        app.globalData.partnerSpecialMoveUsedTurn = null;
      }
    }

    if (isSpecialMoveUsedForCurrentTurn(
      roomId,
      this.data.brainstormSessionSeq,
      this.data.currentRound,
      currentPlayerIndex
    )) {
      this.setData({ specialMoveUsedThisTurn: true });
    } else {
      this.setData({ specialMoveUsedThisTurn: false });
    }
  },

  /** 反面随机拼「采用卡组」返回后：提示打分 / 房主开始表态 */
  _applyAdoptDeckHint() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    const app = getApp();
    const hint = app.globalData && app.globalData.partnerAdoptDeckHint;
    if (!hint || hint.roomId !== roomId) return;
    app.globalData.partnerAdoptDeckHint = null;
    const title = this.data.isHost
      ? '请其他玩家打分，完成后点击开始表态'
      : '已采用卡组，请其他玩家打分';
    wx.showToast({ title, icon: 'none', duration: 2500 });
  },

  /** 房主首次进入出牌页：蒙层提示「开始表态」需全员打分后才亮起 */
  _maybeShowHostStatementTip() {
    if (this.data.showHostStatementTip) return;
    if (!this.data.isHost) return;
    if (isDiscussionPhase(this.data.gamepagePhase) || isClosingPhase(this.data.gamepagePhase)) {
      return;
    }
    try {
      if (wx.getStorageSync(HOST_STATEMENT_TIP_KEY)) return;
    } catch (e) {
      // ignore storage read failure
    }
    this.setData({ showHostStatementTip: true, hostStatementTipReady: false }, () => {
      this._measureHostStatementTip(0);
    });
  },

  _measureHostStatementTip(retry) {
    if (!this.data.showHostStatementTip) return;
    const attempt = retry || 0;
    wx.createSelectorQuery()
      .select('#hostStatementBtn')
      .boundingClientRect((rect) => {
        if (!rect || !rect.width) {
          if (attempt < 8) {
            setTimeout(() => this._measureHostStatementTip(attempt + 1), 80);
          }
          return;
        }
        const pad = 6;
        const top = Math.max(0, rect.top - pad);
        const left = Math.max(0, rect.left - pad);
        const width = rect.width + pad * 2;
        const height = rect.height + pad * 2;
        let windowHeight = 667;
        try {
          const sys = typeof wx.getWindowInfo === 'function'
            ? wx.getWindowInfo()
            : wx.getSystemInfoSync();
          windowHeight = (sys && sys.windowHeight) || windowHeight;
        } catch (e) {
          // keep default
        }
        const tipBottomGap = 20;
        this.setData({
          hostStatementTipReady: true,
          hostStatementTipSpotStyle:
            `top:${top}px;left:${left}px;width:${width}px;height:${height}px;`,
          hostStatementTipTextStyle:
            `bottom:${Math.max(12, windowHeight - top + tipBottomGap)}px;`
        });
      })
      .exec();
  },

  dismissHostStatementTip() {
    if (!this.data.showHostStatementTip) return;
    this.setData({
      showHostStatementTip: false,
      hostStatementTipReady: false,
      hostStatementTipSpotStyle: '',
      hostStatementTipTextStyle: ''
    });
    try {
      wx.setStorageSync(HOST_STATEMENT_TIP_KEY, '1');
    } catch (e) {
      // ignore storage write failure
    }
  },

  preventMove() {},

  onShow() {
    this._pageVisible = true;
    this._bindInspirationKeyboard();
    this._applyPendingSpecialMoveUsed();
    if (this.data.roomId) {
      this._startStatePolling();
      this._startScorePolling();
      // 角标独立刷新，不依赖倒计时同步链路
      this._refreshInspirationCount();
    }
    // 前后台切换：先停旧 interval，再按服务端重算剩余时间（不叠加定时器）
    this._stopRoundTimer();
    this._stopRoundTimerBurstPoll();
    this.setData({ roundTimerReady: false, roundTimerVisible: false });
    this._ensureSharedRoundTimerOnEnter().then(() => {
      if (this._pageVisible === false) return;
      this._applyPendingSpecialMoveUsed();
      this._applyAdoptDeckHint();
      this.refreshScoreStatus();
      this._syncRoundSpeech();
      this._refreshInspirationCount();
      this._measureInspirationFooterClearance();
    }).catch((e) => {
      console.warn('gamepage onShow timer sync', e);
      if (this._pageVisible !== false) {
        this._refreshInspirationCount();
        this._measureInspirationFooterClearance();
      }
    });
  },

  async _syncRoomContext() {
    const roomId = this.data.roomId;
    if (!roomId) return null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId, full: true }
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
    this._unbindInspirationKeyboard();
    // 先停所有定时器，避免 hide 后 setInterval 继续 setData 触发基础库空指针
    this._stopRoundSpeech();
    this._stopScorePolling();
    this._stopStatePolling();
    this._stopRoundTimerBurstPoll();
    this._stopRoundTimer();
    try {
      this.setData({
        roundTimerVisible: false,
        inspirationKeyboardHeight: 0,
        inspirationLiftStyle: ''
      });
    } catch (e) {
      // ignore: 页面帧已销毁
    }
    this._syncRoundContentToRoom();
  },

  onUnload() {
    this._pageVisible = false;
    this._unbindInspirationKeyboard();
    this._stopRoundSpeech();
    if (this._roundSpeech) {
      this._roundSpeech.destroy();
      this._roundSpeech = null;
    }
    this._stopScorePolling();
    this._stopStatePolling();
    this._stopRoundTimerBurstPoll();
    this._stopRoundTimer();
    this._resetRoundTimerSession();
  },

  _applyRoundContentFromRoom(roomState) {
    return normalizePartnerRoundContent(roomState && roomState.partnerCurrentRoundContent);
  },

  _buildClientRoundContentPatch() {
    // 出牌解释 / 疑问讨论：全员共享（按插入顺序的 blocks）
    return {
      playHistory: this.data.playHistory || [],
      discussionNotes: this.data.discussionNotes || [],
      playImages: this.data.playImages || [],
      discussionImages: this.data.discussionImages || [],
      playBlocks: this.data.playBlocks || [],
      discussionBlocks: this.data.discussionBlocks || [],
      images: this.data.playImages || []
    };
  },

  _loadLocalRoundInserts(round, sessionSeq) {
    const note = loadPrivateRoundNote(
      this.data.roomId,
      sessionSeq != null ? sessionSeq : this.data.brainstormSessionSeq,
      round != null ? round : this.data.currentRound
    );
    return {
      playHistory: (note && note.playHistory) || [],
      discussionNotes: (note && note.discussionNotes) || [],
      playImages: (note && note.playImages) || [],
      discussionImages: (note && note.discussionImages) || [],
      playBlocks: (note && note.playBlocks) || [],
      discussionBlocks: (note && note.discussionBlocks) || []
    };
  },

  _persistLocalRoundInserts(overrides = {}) {
    const roomId = this.data.roomId;
    const round = this.data.currentRound;
    if (!roomId || round == null) return;
    const existing = loadPrivateRoundNote(roomId, this.data.brainstormSessionSeq, round);
    savePrivateRoundNote(roomId, this.data.brainstormSessionSeq, round, {
      ...existing,
      playHistory: overrides.playHistory != null
        ? overrides.playHistory
        : (this.data.playHistory || []),
      discussionNotes: overrides.discussionNotes != null
        ? overrides.discussionNotes
        : (this.data.discussionNotes || []),
      playImages: overrides.playImages != null
        ? overrides.playImages
        : (this.data.playImages || []),
      discussionImages: overrides.discussionImages != null
        ? overrides.discussionImages
        : (this.data.discussionImages || []),
      playBlocks: overrides.playBlocks != null
        ? overrides.playBlocks
        : (this.data.playBlocks || []),
      discussionBlocks: overrides.discussionBlocks != null
        ? overrides.discussionBlocks
        : (this.data.discussionBlocks || []),
      // 不再写混合 images，避免旧逻辑误读
      images: []
    });
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
      paginationDots: buildPaginationDots(cardIndex, cardCount),
      cardIndex,
      isPlayerFilterActive: filterActive,
      selectedPlayerIndex: filterActive
        ? filteredPlayerIndex
        : currentPlayerIndex,
      indicatorPlayerIndex
    };
  },

  /** 收尾复盘：优先房间共享纪要，回退本机旧私有笔记 */
  _buildClosingReviewRounds(options) {
    const {
      roomId,
      brainstormSessionSeq,
      currentRound,
      playHistory,
      discussionNotes,
      playImages,
      discussionImages,
      playBlocks,
      discussionBlocks
    } = options || {};

    const sessionSeq = brainstormSessionSeq != null
      ? brainstormSessionSeq
      : this.data.brainstormSessionSeq;
    const allNotes = loadAllPrivateNotes(
      roomId || this.data.roomId,
      sessionSeq
    );
    const summaries = this.data.roundSummaries || [];
    summaries.forEach((summary) => {
      if (!summary || summary.round == null) return;
      const key = String(summary.round);
      const hasShared = (summary.playHistory && summary.playHistory.length)
        || (summary.discussionNotes && summary.discussionNotes.length)
        || (summary.playImages && summary.playImages.length)
        || (summary.discussionImages && summary.discussionImages.length)
        || (summary.playBlocks && summary.playBlocks.length)
        || (summary.discussionBlocks && summary.discussionBlocks.length);
      if (hasShared) {
        allNotes[key] = {
          playHistory: summary.playHistory || [],
          discussionNotes: summary.discussionNotes || [],
          playImages: summary.playImages || summary.images || [],
          discussionImages: summary.discussionImages || [],
          playBlocks: summary.playBlocks || [],
          discussionBlocks: summary.discussionBlocks || []
        };
      }
    });

    // 当前轮以页面最新共享内容为准
    const curRound = Number(currentRound) || 0;
    if (curRound > 0) {
      allNotes[String(curRound)] = {
        playHistory: Array.isArray(playHistory) ? playHistory : [],
        discussionNotes: Array.isArray(discussionNotes) ? discussionNotes : [],
        playImages: Array.isArray(playImages) ? playImages : [],
        discussionImages: Array.isArray(discussionImages) ? discussionImages : [],
        playBlocks: Array.isArray(playBlocks) ? playBlocks : [],
        discussionBlocks: Array.isArray(discussionBlocks) ? discussionBlocks : []
      };
    }

    return Object.keys(allNotes)
      .map((key) => Number(key))
      .filter((round) => Number.isFinite(round) && round > 0)
      .sort((a, b) => a - b)
      .map((round) => {
        const note = allNotes[String(round)] || {};
        const privateNote = {
          playHistory: Array.isArray(note.playHistory) ? note.playHistory : [],
          discussionNotes: Array.isArray(note.discussionNotes) ? note.discussionNotes : [],
          playImages: Array.isArray(note.playImages) ? note.playImages : [],
          discussionImages: Array.isArray(note.discussionImages) ? note.discussionImages : [],
          playBlocks: Array.isArray(note.playBlocks) ? note.playBlocks : [],
          discussionBlocks: Array.isArray(note.discussionBlocks) ? note.discussionBlocks : []
        };
        return { round, privateNote };
      })
      .filter((item) => {
        const n = item.privateNote;
        return n.playHistory.length
          || n.discussionNotes.length
          || n.playImages.length
          || n.discussionImages.length
          || n.playBlocks.length
          || n.discussionBlocks.length;
      });
  },

  _resolveIndicatorPlayerIndex(cardIndex) {
    const summaries = this.data.displayRoundSummaries || [];
    if (cardIndex < summaries.length && summaries[cardIndex]) {
      return summaries[cardIndex].playerIndex;
    }
    return this.data.currentPlayerIndex;
  },

  _getTimerNow() {
    return getSyncedNow(this._serverClockOffsetMs || 0);
  },

  _ingestServerClock(result) {
    const serverNow = result && result.serverNow != null ? Number(result.serverNow) : NaN;
    if (!Number.isFinite(serverNow) || serverNow <= 0) return;
    // 用往返中点近似对齐服务端时间，避免各端墙钟漂移
    const localNow = Date.now();
    this._serverClockOffsetMs = serverNow - localNow;
    if (result.roundTimerMaxSec != null) {
      const maxSec = Number(result.roundTimerMaxSec);
      if (Number.isFinite(maxSec) && maxSec > 0 && maxSec !== this.data.roundTimerMaxSec) {
        this.setData({ roundTimerMaxSec: maxSec });
      }
    }
  },

  /** 清空倒计时会话：停所有定时器 + 丢掉旧 startTime（进房/换房/卸页时调用） */
  _resetRoundTimerSession() {
    this._stopRoundTimer();
    this._stopRoundTimerBurstPoll();
    this._pendingRoundStartedAt = 0;
    this._rollingRoundCountdown = false;
    this._avatarTimerTurnKey = '';
    this._clearRoundStartedAtCache();
    this.setData({
      partnerRoundStartedAt: null,
      avatarRoundStartedAt: null,
      roundTimerVisible: false,
      roundTimerReady: false,
      roundTimerElapsedRatio: 0,
      roundTimerRemainingSec: this.data.roundTimerMaxSec || ROUND_DURATION_SEC
    });
  },

  _syncTimerFromStartedAt() {
    const { partnerRoundStartedAt, gamepagePhase, roundTimerMaxSec } = this.data;
    if (isClosingPhase(gamepagePhase) || !partnerRoundStartedAt || !this.data.roundTimerReady) {
      if (this.data.roundTimerElapsedRatio !== 0) {
        this.setData({ roundTimerElapsedRatio: 0 });
      }
      return;
    }
    const timerState = getRoundTimerState(
      partnerRoundStartedAt,
      roundTimerMaxSec || ROUND_DURATION_SEC,
      this._getTimerNow()
    );
    this.setData({
      roundTimerElapsedRatio: timerState.elapsedRatio,
      roundTimerRemainingSec: timerState.remainingSec
    });
  },

  _restartRoundTimer() {
    this._stopRoundTimer();
    const { partnerRoundStartedAt, gamepagePhase, roundTimerReady, roundTimerMaxSec } = this.data;
    if (isClosingPhase(gamepagePhase) || !partnerRoundStartedAt || !roundTimerReady) return;

    const maxSec = roundTimerMaxSec || ROUND_DURATION_SEC;
    // 先渲染当前剩余（新开局为 max），不在加载瞬间人为减 1
    const initial = getRoundTimerState(partnerRoundStartedAt, maxSec, this._getTimerNow());
    this.setData({
      roundTimerElapsedRatio: initial.elapsedRatio,
      roundTimerRemainingSec: initial.remainingSec
    });

    // 对齐到下一整秒边界再开始 interval，保证「满 1 秒后才首次减 1」
    const elapsedMs = Math.max(0, this._getTimerNow() - Number(partnerRoundStartedAt));
    const delayToNextSecond = Math.max(50, 1000 - (elapsedMs % 1000));

    const tick = () => {
      if (this._pageVisible === false) return;
      // 输入灵感时避免高频 setData 顶布局/卡死
      if (
        this.data.inspirationInputFocused
        || this.data.inspirationHoldKeyboard
        || this._inspirationNativeFocused
      ) return;
      const startedAt = this.data.partnerRoundStartedAt;
      if (!startedAt || !this.data.roundTimerReady) return;
      const timerState = getRoundTimerState(
        startedAt,
        this.data.roundTimerMaxSec || ROUND_DURATION_SEC,
        this._getTimerNow()
      );
      try {
        this.setData({
          roundTimerElapsedRatio: timerState.elapsedRatio,
          roundTimerRemainingSec: timerState.remainingSec
        });
      } catch (e) {
        return;
      }
      if (timerState.remainingSec <= 0) {
        if (this.data.isHost === true && !this._rollingRoundCountdown) {
          this._rollRoundCountdown();
        }
        if (!this._roundTimerBurstTimer) {
          this._startRoundTimerBurstPoll();
        }
      }
    };

    clearTimeout(this._roundTimerAlignTimer);
    this._roundTimerAlignTimer = setTimeout(() => {
      this._roundTimerAlignTimer = null;
      if (this._pageVisible === false) return;
      tick();
      this._stopRoundTimer();
      this._roundTimerInterval = setInterval(tick, 1000);
    }, delayToNextSecond);
  },

  _stopRoundTimer() {
    if (this._roundTimerAlignTimer) {
      clearTimeout(this._roundTimerAlignTimer);
      this._roundTimerAlignTimer = null;
    }
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
      if (this._pageVisible === false) {
        this._stopRoundTimerBurstPoll();
        return;
      }
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
        this._ingestServerClock(result);
        const next = result.roomState && result.roomState.partnerRoundStartedAt != null
          ? Number(result.roomState.partnerRoundStartedAt)
          : 0;
        const maxSec = this.data.roundTimerMaxSec || ROUND_DURATION_SEC;
        // 非房主：仅在服务端戳更新且不被本地防回滚拒绝时应用
        if (
          next > 0
          && next !== Number(this.data.partnerRoundStartedAt)
          && isRoundTimerActive(next, maxSec, this._getTimerNow())
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

  _canEditPlayNotes() {
    return !!this.data.isHost || !!this.data.isCurrentPlayer;
  },

  _canEditDiscussionNotes() {
    return !!this.data.isHost;
  },

  _closingDeckImagePatch(blocks) {
    const list = blocks != null ? blocks : (this.data.closingCreativeBlocks || []);
    return {
      closingHasDeckImage: list.some((b) => b && b.type === 'image' && b.url)
    };
  },

  _canEditSharedSection(target) {
    if (target === 'play') return this._canEditPlayNotes();
    if (target === 'discussion') return this._canEditDiscussionNotes();
    return false;
  },

  async _syncRoundContentToRoom(overrides) {
    const roomId = this.data.roomId;
    if (!roomId || isClosingPhase(this.data.gamepagePhase)) return false;
    // 房主可同步全部；当前出牌玩家仅同步出牌解释（服务端会忽略其讨论字段）
    if (!this.data.isHost && !this.data.isCurrentPlayer) return false;
    // 内容所属轮次：换轮后禁止把上一轮纪要写进新一轮
    const contentRound = overrides && overrides.contentRound != null
      ? Number(overrides.contentRound)
      : Number(this.data.currentRound);
    if (!Number.isFinite(contentRound) || contentRound <= 0) return false;
    if (Number(this.data.currentRound) !== contentRound) return false;

    const patch = overrides && typeof overrides === 'object'
      ? {
        playHistory: overrides.playHistory != null
          ? overrides.playHistory
          : (this.data.playHistory || []),
        discussionNotes: overrides.discussionNotes != null
          ? overrides.discussionNotes
          : (this.data.discussionNotes || []),
        playImages: overrides.playImages != null
          ? overrides.playImages
          : (this.data.playImages || []),
        discussionImages: overrides.discussionImages != null
          ? overrides.discussionImages
          : (this.data.discussionImages || []),
        playBlocks: overrides.playBlocks != null
          ? overrides.playBlocks
          : (this.data.playBlocks || []),
        discussionBlocks: overrides.discussionBlocks != null
          ? overrides.discussionBlocks
          : (this.data.discussionBlocks || []),
        images: overrides.playImages != null
          ? overrides.playImages
          : (this.data.playImages || [])
      }
      : this._buildClientRoundContentPatch();
    // 非房主出牌玩家：只推送出牌解释，避免误带讨论字段
    const payload = this.data.isHost
      ? patch
      : {
        playHistory: patch.playHistory || [],
        playImages: patch.playImages || [],
        playBlocks: patch.playBlocks || [],
        images: patch.playImages || []
      };
    // 全空时不推送，避免进房/切后台把他人已写纪要冲成空数组
    const hasContent = this.data.isHost
      ? (
        (payload.playHistory && payload.playHistory.length)
        || (payload.discussionNotes && payload.discussionNotes.length)
        || (payload.playImages && payload.playImages.length)
        || (payload.discussionImages && payload.discussionImages.length)
        || (payload.playBlocks && payload.playBlocks.length)
        || (payload.discussionBlocks && payload.discussionBlocks.length)
        || (payload.images && payload.images.length)
      )
      : (
        (payload.playHistory && payload.playHistory.length)
        || (payload.playImages && payload.playImages.length)
        || (payload.playBlocks && payload.playBlocks.length)
        || (payload.images && payload.images.length)
      );
    if (!hasContent) return false;
    const syncToken = ++this._roundContentSyncToken;
    try {
      const res = await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'gamepage',
          contentRound,
          partnerCurrentRoundContent: payload
        }
      });
      // 请求期间已换轮：丢弃结果，避免把旧轮内容认作成功
      if (syncToken !== this._roundContentSyncToken
        || Number(this.data.currentRound) !== contentRound) {
        return false;
      }
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('syncRoundContentToRoom', e);
      return false;
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

    const maxSec = this.data.roundTimerMaxSec || ROUND_DURATION_SEC;
    const now = this._getTimerNow();
    if (isRoundTimerActive(fromServer, maxSec, now)) {
      this._cacheRoundStartedAt(this.data.roomId, currentRound, fromServer);
      return fromServer;
    }

    // 服务端戳已过期：若本地仍活跃则保留本地；否则返回 null 等待滚下一轮
    const local = Number(this.data.partnerRoundStartedAt) || 0;
    if (local > 0 && isRoundTimerActive(local, maxSec, now)) {
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
    const maxSec = this.data.roundTimerMaxSec || ROUND_DURATION_SEC;
    const now = this._getTimerNow();
    const ts = Number(startedAt);
    if (!Number.isFinite(ts) || ts <= 0 || isClosingPhase(this.data.gamepagePhase)) {
      this.setData({
        partnerRoundStartedAt: null,
        avatarRoundStartedAt: null,
        roundTimerVisible: false,
        roundTimerReady: false,
        roundTimerElapsedRatio: 0,
        roundTimerRemainingSec: maxSec
      });
      this._avatarTimerTurnKey = '';
      this._stopRoundTimer();
      return;
    }

    // 已过期的服务端戳只清空，绝不点亮倒计时（避免进主流程立刻震动）
    if (!isRoundTimerActive(ts, maxSec, now)) {
      if (isRoundTimerActive(this.data.partnerRoundStartedAt, maxSec, now)) return;
      this.setData({
        partnerRoundStartedAt: null,
        roundTimerVisible: false,
        roundTimerReady: false,
        roundTimerElapsedRatio: 0,
        roundTimerRemainingSec: maxSec
      });
      this._stopRoundTimer();
      return;
    }

    const current = Number(this.data.partnerRoundStartedAt) || 0;
    const pending = Number(this._pendingRoundStartedAt) || 0;

    // 禁止更旧戳覆盖（含写库竞态期的服务端旧值）
    if (!force) {
      if (pending > 0 && ts < pending) return;
      if (current > 0 && ts < current) return;
      if (current > 0 && isRoundTimerActive(current, maxSec, now) && !isRoundTimerActive(ts, maxSec, now)) {
        return;
      }
    }

    if (pending > 0 && ts >= pending) {
      this._pendingRoundStartedAt = 0;
    }

    const timerState = getRoundTimerState(ts, maxSec, now);
    this._cacheRoundStartedAt(this.data.roomId, this.data.currentRound, ts);
    this.setData({
      partnerRoundStartedAt: ts,
      roundTimerReady: true,
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
   * 进入 gamepage：先拉服务端 max / startTime，再渲染并启动。
   * 已有活跃计时 → 按墙钟算真实剩余；无活跃计时 → 仅房主开新一轮（从 max 起）。
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
    // 拉取完成前保持占位，禁止用默认值抢跑倒计时
    this.setData({ roundTimerReady: false, roundTimerVisible: false });
    try {
      let serverStartedAt = null;
      let serverTurnStartedAt = null;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId: this.data.roomId }
        });
        const result = (res && res.result) || {};
        this._ingestServerClock(result);
        if (result.ok === true && result.roomState) {
          if (result.isHost === true && this.data.isHost !== true) {
            this.setData({ isHost: true }, () => {
              this._maybeShowHostStatementTip();
            });
          } else if (result.isHost === false && this.data.isHost === true) {
            this.setData({ isHost: false });
          }
          const maxSec = this.data.roundTimerMaxSec || ROUND_DURATION_SEC;
          const now = this._getTimerNow();
          const ts = result.roomState.partnerRoundStartedAt != null
            ? Number(result.roomState.partnerRoundStartedAt)
            : 0;
          if (Number.isFinite(ts) && ts > 0 && isRoundTimerActive(ts, maxSec, now)) {
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

      // 已有活跃计时：中途进入按真实剩余时间，不从 max 重开
      if (serverStartedAt) {
        this._applySharedRoundTimer(serverStartedAt, { force: true, syncTurnAvatar: false });
        this._syncAvatarRoundStartedAt(serverTurnStartedAt || serverStartedAt, { force: true });
        return;
      }

      if (this.data.isHost === true) {
        // 新阶段：用本机墙钟作 startTime（与写库一致），首屏按公式显示 max
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
      this.setData({ roundTimerReady: false });
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
    if (isRoundTimerActive(
      this.data.partnerRoundStartedAt,
      this.data.roundTimerMaxSec || ROUND_DURATION_SEC,
      this._getTimerNow()
    )) return;
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

  _validateSpecialMoveFlag(flag, patch) {
    // 仅当前出牌玩家本人可匹配「本轮已使用」标记
    return !!(
      patch.isCurrentPlayer
      && toPlayerIndex(flag.playerIndex, 0) === toPlayerIndex(patch.currentPlayerIndex, 0)
    );
  },

  _resolveSpecialMoveUsed(patch) {
    // 非当前出牌玩家不展示按钮，也不记已使用
    if (!patch.isCurrentPlayer) {
      return false;
    }
    if (patch.isMasterMode) {
      return true;
    }

    const roomId = this.data.roomId;
    const app = getApp();
    const flag = app.globalData && app.globalData.partnerSpecialMoveUsedTurn;

    if (flag && flag.roomId === roomId && this._validateSpecialMoveFlag(flag, patch)) {
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
    this._ingestServerClock(result);
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
    const me = members.find((m) => m && m.isMe);
    const myPlayerIndex = me ? toPlayerIndex(me.playerIndex, 0) : 0;
    const prevPlayerIndex = toPlayerIndex(this.data.currentPlayerIndex, 0);
    const turnIndexChanged = player.currentPlayerIndex !== prevPlayerIndex;
    const becameMyTurn = hadPriorContext
      && turnIndexChanged
      && myPlayerIndex > 0
      && player.currentPlayerIndex === myPlayerIndex;
    const leftMyTurn = hadPriorContext
      && turnIndexChanged
      && myPlayerIndex > 0
      && prevPlayerIndex === myPlayerIndex
      && player.currentPlayerIndex !== myPlayerIndex;
    const closingStepChanged = isClosingPhase(roomPhase)
      && closingStep !== this.data.closingStep;
    const expressMessages = Array.isArray(roomState.partnerExpressMessages)
      ? roomState.partnerExpressMessages
      : [];
    this._expressMessagesAll = expressMessages;
    const roundSummaries = (Array.isArray(roomState.partnerRoundSummaries)
      ? roomState.partnerRoundSummaries
      : [])
      .slice()
      .sort((a, b) => (a.round || 0) - (b.round || 0))
      .map((item) => {
        const lists = this._buildExpressListsForRound(expressMessages, item.round, currentRound);
        return {
          ...item,
          voiceLines: Array.isArray(item.voiceLines) ? item.voiceLines : [],
          turnRecords: Array.isArray(item.turnRecords) ? item.turnRecords : [],
          expressChatList: lists.expressChatList,
          playExpressChatList: lists.playExpressChatList,
          discussionExpressChatList: lists.discussionExpressChatList
        };
      });
    const roundContent = this._applyRoundContentFromRoom(roomState);
    // 页面级表达列表只服务当前轮卡片；换轮强制重算，避免残留上一轮
    this._ingestExpressMessages(expressMessages, {
      currentRound,
      force: roundChanged || sessionChanged
    });
    const lastExpressId = expressMessages.length
      ? (expressMessages[expressMessages.length - 1].id || '')
      : '';
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
        const timerState = getRoundTimerState(
          partnerRoundStartedAt,
          this.data.roundTimerMaxSec || ROUND_DURATION_SEC,
          this._getTimerNow()
        );
        return {
          roundTimerReady: true,
          roundTimerElapsedRatio: timerState.elapsedRatio,
          roundTimerRemainingSec: timerState.remainingSec
        };
      })()
      : { roundTimerElapsedRatio: 0, roundTimerReady: false };
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
      isCurrentPlayer: !!player.isCurrentPlayer,
      // 出牌阶段：轮到谁，谁显示「特殊行动」（含房主本人出牌）
      showSpecialMoveBtn: !!player.isCurrentPlayer
        && !isDiscussionPhase(roomPhase)
        && !isClosingPhase(roomPhase),
      gamepagePhase: roomPhase,
      expressCanSend: this._computeExpressCanSend(player.isCurrentPlayer, roomPhase),
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
      playHistory: roundContent.playHistory,
      discussionNotes: roundContent.discussionNotes,
      playImages: roundContent.playImages,
      discussionImages: roundContent.discussionImages,
      playBlocks: roundContent.playBlocks,
      discussionBlocks: roundContent.discussionBlocks,
      ...timerPatch,
      displayRoundSummaries: paginationState.displayRoundSummaries,
      cardCount: paginationState.cardCount,
      paginationDots: paginationState.paginationDots,
      cardIndex: paginationState.cardIndex,
      selectedPlayerIndex: paginationState.selectedPlayerIndex,
      indicatorPlayerIndex: paginationState.indicatorPlayerIndex,
      isPlayerFilterActive: paginationState.isPlayerFilterActive
    };

    // 出牌解释/疑问讨论取房间共享态；换轮时清空内联输入草稿
    if (roundChanged || sessionChanged) {
      // 作废进行中的内容同步，防止上一轮纪要写进新一轮
      this._roundContentSyncToken = (this._roundContentSyncToken || 0) + 1;
      patch.cardInlineEditTarget = '';
      patch.cardInlineEditText = '';
      patch.cardInlineEditFocus = false;
      patch.playDraftText = '';
      patch.playDraftFocused = false;
      patch.discussionDraftText = '';
      patch.discussionDraftFocused = false;
      patch.cardDraftText = '';
      patch.cardDraftPhotos = [];
      patch.cardDraftHasText = false;
      this._clearRoundStartedAtCache();
      const serverTs = roomState.partnerRoundStartedAt != null
        ? Number(roomState.partnerRoundStartedAt)
        : 0;
      // 过期戳不得写入 UI，否则进页会覆盖新计时并误触发到期震动
      patch.partnerRoundStartedAt = (serverTs > 0 && isRoundTimerActive(
        serverTs,
        this.data.roundTimerMaxSec || ROUND_DURATION_SEC,
        this._getTimerNow()
      ))
        ? serverTs
        : null;
    }

    if (playerChanged || phaseChanged || roundChanged || sessionChanged || options.resetTurnUi) {
      patch.selectedScore = null;
      patch.canStartStatement = false;
      patch.scoredCount = 0;
      patch.scorePanelExpanded = false;
      patch.scoreSheetTranslateY = this.data.scoreSheetMaxTranslateY || 120;
      patch.scoreSheetVisiblePx = this.data.scoreSheetCollapsedPx || 72;
      patch.scoreSheetAnimating = false;
      patch.expressComposerOpen = false;
      patch.expressDraftText = '';
      patch.expressHasText = false;
      if (playerChanged || roundChanged || sessionChanged || options.resetTurnUi) {
        patch.expressChatPanelVisible = false;
      }
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
        patch.paginationDots = resetCardState.paginationDots;
        patch.cardIndex = resetCardState.cardIndex;
        patch.selectedPlayerIndex = resetCardState.selectedPlayerIndex;
        patch.indicatorPlayerIndex = resetCardState.indicatorPlayerIndex;
        patch.isPlayerFilterActive = false;
      }
    }

    if (playerChanged || roundChanged || sessionChanged) {
      patch.specialMoveUsedThisTurn = false;
      clearPartnerSpecialMoveUsedFlag(this.data.roomId);
    } else {
      patch.specialMoveUsedThisTurn = this._resolveSpecialMoveUsed(patch);
    }

    if (closingStepChanged || (phaseChanged && isClosingPhase(roomPhase))) {
      patch.cardIndex = closingStep === CLOSING_STEP_REVIEW ? 1 : 0;
      patch.paginationDots = buildPaginationDots(
        patch.cardIndex,
        patch.cardCount != null ? patch.cardCount : this.data.cardCount
      );
    }

    if (isClosingPhase(roomPhase)) {
      patch.closingReviewRounds = this._buildClosingReviewRounds({
        roomId: this.data.roomId,
        brainstormSessionSeq,
        currentRound,
        playHistory: patch.playHistory,
        discussionNotes: patch.discussionNotes,
        playImages: patch.playImages,
        discussionImages: patch.discussionImages,
        playBlocks: patch.playBlocks,
        discussionBlocks: patch.discussionBlocks
      });
      const closingCreative = normalizeContentBlocks(
        roomState.partnerClosingCreativePoints
          && roomState.partnerClosingCreativePoints.blocks,
        roomState.partnerClosingCreativePoints
          && roomState.partnerClosingCreativePoints.texts,
        roomState.partnerClosingCreativePoints
          && roomState.partnerClosingCreativePoints.images
      );
      // 编辑中不打断本地输入框
      if (!this.data.closingCreativeEditFocus && !this.data.closingCreativeSaving) {
        patch.closingCreativeBlocks = closingCreative;
        Object.assign(patch, this._closingDeckImagePatch(closingCreative));
      }
    } else if (phaseChanged) {
      patch.closingReviewRounds = [];
      patch.closingCreativeBlocks = [];
      patch.closingHasDeckImage = false;
      patch.closingCreativeEditText = '';
      patch.closingCreativeEditFocus = false;
      patch.playDraftText = '';
      patch.playDraftFocused = false;
      patch.discussionDraftText = '';
      patch.discussionDraftFocused = false;
    }

    const contextFingerprint = [
      player.currentPlayerIndex,
      roomPhase,
      currentRound,
      brainstormSessionSeq,
      closingStep,
      partnerRoundStartedAt || 0,
      avatarRoundStartedAt || 0,
      members.map((m) => `${m.userId || m.playerIndex}:${getMemberAvatarFingerprint(m)}:${m.nickName || ''}`).join('|'),
      roundSummaries.length,
      roundContent.voiceLines.length,
      roundContent.turnRecords.length,
      // 内容指纹：避免同长度改文案时轮询不刷新
      (roundContent.playHistory || []).join('\u0001'),
      (roundContent.discussionNotes || []).join('\u0001'),
      (roundContent.playImages || []).join('|'),
      (roundContent.discussionImages || []).join('|'),
      (roundContent.playBlocks || []).map((b) => `${b.type}:${b.text || b.url || ''}`).join('\u0001'),
      (roundContent.discussionBlocks || []).map((b) => `${b.type}:${b.text || b.url || ''}`).join('\u0001'),
      ((roomState.partnerClosingCreativePoints
        && roomState.partnerClosingCreativePoints.blocks) || [])
        .map((b) => `${b.type}:${b.text || b.url || ''}`).join('\u0001'),
      lastExpressId,
      paginationState.cardIndex,
      paginationState.cardCount,
      !!patch.specialMoveUsedThisTurn,
      options.resetTurnUi ? 1 : 0
    ].join('#');
    const forcePatch = !!(
      options.resetTurnUi
      || playerChanged
      || phaseChanged
      || roundChanged
      || sessionChanged
      || closingStepChanged
      || becameMyTurn
      || leftMyTurn
    );
    if (!forcePatch && contextFingerprint === this._roomContextFingerprint) {
      return { playerChanged, phaseChanged, roundChanged, members, player, roomPhase };
    }
    this._roomContextFingerprint = contextFingerprint;

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
      // 非出牌玩家：测量打分抽屉可拖动行程（不挤压聊天区）
      if (!patch.isCurrentPlayer) {
        setTimeout(() => this._measureScoreSheetHeights(), 40);
      }
    });
    return { playerChanged, phaseChanged, roundChanged, members, player, roomPhase };
  },

  async loadRoomData() {
    const roomId = this.data.roomId;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId, full: true }
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
        selectedProblemText,
        problemExpanded: false,
        problemTextOverflow: false
      }, () => {
        this._checkProblemTextOverflow();
        this._maybeShowHostStatementTip();
      });

      this._startStatePolling();
      this.refreshScoreStatus();
      this._startScorePolling();
      this._roomLoaded = true;
      // 房主重开并广播；其他端跟随同一时间戳显示倒计时
      await this._ensureSharedRoundTimerOnEnter();
      await this._syncRoundSpeech();
      await this._syncRoundContentToRoom();
      await this._refreshInspirationCount();
    } catch (e) {
      console.error('partner gamepage loadRoomData', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async refreshScoreStatus() {
    const { roomId, isHost, gamepagePhase } = this.data;
    if (!roomId || isClosingPhase(gamepagePhase) || this._pageVisible === false) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getGameScoreStatus',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true || this._pageVisible === false) return;

      const scoredCount = result.scoredCount || 0;
      const totalRequired = result.totalRequired != null
        ? result.totalRequired
        : this.data.totalRequired;
      const canStartStatement = isHost
        && !isDiscussionPhase(gamepagePhase)
        && !isClosingPhase(gamepagePhase)
        && totalRequired > 0
        && scoredCount >= totalRequired;

      try {
        this.setData({
          scoredCount,
          totalRequired,
          canStartStatement
        });
      } catch (e) {
        // ignore
      }
    } catch (e) {
      console.warn('refreshScoreStatus', e);
    }
  },

  _startScorePolling() {
    this._stopScorePolling();
    this._scorePollTimer = setInterval(() => {
      if (this._pageVisible === false) return;
      this.refreshScoreStatus();
    }, 3000);
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
      if (this._pageVisible === false) return;
      const roomId = this.data.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId, full: true }
        });
        if (this._pageVisible === false) return;
        const result = (res && res.result) || {};
        followSubScreenRoomPoll(result, roomId, {
          beforeNavigate: (pollResult, page) => {
            // 模式已清除：房主/成员均回房间等待页
            if (pollResult.hasSelectedMode !== true) {
              try {
                clearLocalBrainstormProgress(roomId);
                clearPartnerSpecialMoveUsedFlag(roomId);
              } catch (e) {
                // ignore
              }
              safeOpenUrl(`/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`, {
                immediate: true
              });
              return true;
            }
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
              // 灵感输入聚焦时跳过整页 setData，避免键盘顶起 + 轮询互相拉扯卡死
              if (
                this.data.inspirationInputFocused
                || this.data.inspirationHoldKeyboard
                || this._inspirationNativeFocused
              ) {
                return true;
              }
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
              // 仅主屏进选择页；副屏进等待表态页
              const isHost = pollResult.isHost === true || this.data.isHost === true;
              safeOpenUrl(buildStatementUrl(roomId, idx, playerName, {
                isSubScreen: !isHost,
                isWaiting: !isHost
              }), { immediate: true });
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
      paginationDots: buildPaginationDots(cardIndex, this.data.cardCount),
      indicatorPlayerIndex: this._resolveIndicatorPlayerIndex(cardIndex)
    });
    // 历史纪要卡自带 play/discussionExpressChatList；页面级列表始终对应当前轮，
    // 切卡时不得改写，否则滑动预览当前卡会短暂串出上一轮聊天记录。
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
    const existing = loadPrivateRoundNote(
      this.data.roomId,
      this.data.brainstormSessionSeq,
      round
    );
    savePrivateRoundNote(
      this.data.roomId,
      this.data.brainstormSessionSeq,
      round,
      {
        ...existing,
        ...(note || {})
      }
    );
    this.setData({
      [`displayRoundSummaries[${idx}].privateNote`]: loadPrivateRoundNote(
        this.data.roomId,
        this.data.brainstormSessionSeq,
        round
      )
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
    const note = item && item.privateNote;
    const urls = note
      ? [].concat(note.playImages || [], note.discussionImages || [], note.images || [], note.photos || []).filter(Boolean)
      : [url];
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] });
  },

  onRoundPrivateInsertPreview(e) {
    this.onRoundPrivateNotePreview(e);
  },

  async _uploadRoundNotePhotos(paths) {
    const roomId = this.data.roomId || 'room';
    const round = this.data.currentRound || 0;
    const list = Array.isArray(paths) ? paths : [];
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const filePath = list[i];
      try {
        const cloudPath = `partnerNotes/${roomId}/r${round}/${Date.now()}_${i}.jpg`;
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
        if (uploadRes && uploadRes.fileID) {
          results.push(uploadRes.fileID);
          continue;
        }
      } catch (e) {
        console.warn('_uploadRoundNotePhotos cloud fail', e);
      }
      results.push(await persistTempPhoto(filePath));
    }
    return results;
  },

  async _appendSharedSectionContent(target, options = {}) {
    if (!this._canEditSharedSection(target)) return false;
    const scope = target === 'play' ? 'play' : 'discussion';
    const text = typeof options.text === 'string' ? options.text : '';
    const photos = Array.isArray(options.photos) ? options.photos : [];
    const segments = splitRecordSegments(text);
    if (!segments.length && !photos.length) return false;

    // 绑定写入时的轮次，异步上传后若已换轮则中止，避免串轮
    const contentRound = Number(this.data.currentRound);
    if (!Number.isFinite(contentRound) || contentRound <= 0) return false;

    let uploaded = [];
    if (photos.length) {
      uploaded = await this._uploadRoundNotePhotos(photos);
      if (!uploaded.length && !segments.length) {
        wx.showToast({ title: '图片上传失败', icon: 'none' });
        return false;
      }
    }

    if (Number(this.data.currentRound) !== contentRound) {
      wx.showToast({ title: '已换轮，请重新记录', icon: 'none' });
      return false;
    }
    if (!this._canEditSharedSection(target)) return false;

    const blockField = scope === 'play' ? 'playBlocks' : 'discussionBlocks';
    let nextBlocks = (this.data[blockField] || []).slice();
    if (uploaded.length) nextBlocks = appendImageBlocks(nextBlocks, uploaded);
    if (segments.length) nextBlocks = appendTextSegments(nextBlocks, text);
    const derived = deriveListsFromBlocks(nextBlocks);

    const nextPlayBlocks = scope === 'play' ? nextBlocks : (this.data.playBlocks || []);
    const nextDiscussionBlocks = scope === 'play'
      ? (this.data.discussionBlocks || [])
      : nextBlocks;
    const nextPlayHistory = scope === 'play'
      ? derived.texts
      : (this.data.playHistory || []);
    const nextDiscussionNotes = scope === 'play'
      ? (this.data.discussionNotes || [])
      : derived.texts;
    const nextPlayImages = scope === 'play'
      ? derived.images
      : (this.data.playImages || []);
    const nextDiscussionImages = scope === 'play'
      ? (this.data.discussionImages || [])
      : derived.images;

    this.setData({
      playHistory: nextPlayHistory,
      discussionNotes: nextDiscussionNotes,
      playImages: nextPlayImages,
      discussionImages: nextDiscussionImages,
      playBlocks: nextPlayBlocks,
      discussionBlocks: nextDiscussionBlocks
    });

    const ok = await this._syncRoundContentToRoom({
      contentRound,
      playHistory: nextPlayHistory,
      discussionNotes: nextDiscussionNotes,
      playImages: nextPlayImages,
      discussionImages: nextDiscussionImages,
      playBlocks: nextPlayBlocks,
      discussionBlocks: nextDiscussionBlocks
    });
    if (!ok) {
      if (Number(this.data.currentRound) !== contentRound) {
        wx.showToast({ title: '已换轮，请重新记录', icon: 'none' });
      } else {
        wx.showToast({ title: '同步失败', icon: 'none' });
      }
    }
    return ok;
  },

  onCardSectionTitleTap(e) {
    const target = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.target
      : '';
    this._focusSectionDraft(target);
  },

  _focusSectionDraft(target) {
    // 常驻 textarea 由用户点击原生聚焦；此处仅更新样式态
    if (!this._canEditSharedSection(target)) return;
    if (target === 'play') {
      this.setData({ playDraftFocused: true, discussionDraftFocused: false });
    } else if (target === 'discussion') {
      this.setData({ discussionDraftFocused: true, playDraftFocused: false });
    }
  },

  onSectionDraftFocus(e) {
    const target = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.target
      : '';
    if (!this._canEditSharedSection(target)) return;
    if (target === 'play') {
      this.setData({ playDraftFocused: true, discussionDraftFocused: false });
    } else if (target === 'discussion') {
      this.setData({ discussionDraftFocused: true, playDraftFocused: false });
    }
  },

  onSectionDraftInput(e) {
    const target = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.target
      : '';
    const text = (e.detail && e.detail.value) || '';
    if (target === 'play') {
      this.setData({ playDraftText: text });
    } else if (target === 'discussion') {
      this.setData({ discussionDraftText: text });
    }
  },

  async onSectionDraftConfirm(e) {
    const target = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.target
      : '';
    await this._commitSectionDraft(target);
  },

  async onSectionDraftBlur(e) {
    const target = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.target
      : '';
    await this._commitSectionDraft(target, { allowEmptyExit: true });
  },

  async _commitSectionDraft(target, options = {}) {
    if (this.data.cardInlineEditSaving) return;
    if (!this._canEditSharedSection(target)) return;
    const raw = target === 'play'
      ? (this.data.playDraftText || '')
      : (this.data.discussionDraftText || '');
    if (!splitRecordSegments(raw).length) {
      if (options.allowEmptyExit) {
        if (target === 'play') {
          this.setData({ playDraftFocused: false });
        } else if (target === 'discussion') {
          this.setData({ discussionDraftFocused: false });
        }
      }
      return;
    }
    this.setData({ cardInlineEditSaving: true });
    try {
      const ok = await this._appendSharedSectionContent(target, { text: raw });
      if (ok) {
        if (target === 'play') {
          this.setData({ playDraftText: '', playDraftFocused: false });
        } else {
          this.setData({ discussionDraftText: '', discussionDraftFocused: false });
        }
      }
    } finally {
      this.setData({ cardInlineEditSaving: false });
    }
  },

  onCardSectionAddImage(e) {
    const target = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.target
      : '';
    if (!this._canEditSharedSection(target)) return;
    const imageField = target === 'play' ? 'playImages' : 'discussionImages';
    const current = this.data[imageField] || [];
    const remain = 9 - current.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多插入 9 张图片', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        wx.chooseImage({
          count: remain,
          sizeType: ['compressed'],
          sourceType,
          success: async (chooseRes) => {
            const paths = chooseRes.tempFilePaths || [];
            if (!paths.length) return;
            wx.showLoading({ title: '上传中…', mask: true });
            try {
              await this._appendSharedSectionContent(target, { photos: paths });
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

  onCardInlineInput(e) {
    this.onSectionDraftInput(e);
  },

  async onCardInlineConfirm(e) {
    await this.onSectionDraftConfirm(e || { currentTarget: { dataset: { target: this.data.cardInlineEditTarget } } });
  },

  async onCardInlineBlur(e) {
    await this.onSectionDraftBlur(e || { currentTarget: { dataset: { target: this.data.cardInlineEditTarget } } });
  },

  async _commitCardInlineEdit(options = {}) {
    const target = this.data.cardInlineEditTarget;
    if (target === 'play' || target === 'discussion') {
      await this._commitSectionDraft(target, options);
    }
  },

  handleInsertImage() {
    const photos = this.data.cardDraftPhotos || [];
    const remain = 9 - photos.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多插入 9 张图片', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        wx.chooseImage({
          count: remain,
          sizeType: ['compressed'],
          sourceType,
          success: (chooseRes) => {
            const paths = chooseRes.tempFilePaths || [];
            if (!paths.length) return;
            this.setData({
              cardDraftPhotos: photos.concat(paths)
            });
          },
          fail: () => {
            wx.showToast({ title: '选择图片失败', icon: 'none' });
          }
        });
      }
    });
  },

  onCardDraftInput(e) {
    const text = (e.detail && e.detail.value) || '';
    this.setData({
      cardDraftText: text,
      cardDraftHasText: !!text.trim()
    });
  },

  onCardDraftRemovePhoto(e) {
    const index = Number(e.currentTarget && e.currentTarget.dataset
      && e.currentTarget.dataset.index);
    if (!Number.isFinite(index)) return;
    const photos = (this.data.cardDraftPhotos || []).slice();
    photos.splice(index, 1);
    this.setData({ cardDraftPhotos: photos });
  },

  onCardImagePreview(e) {
    const dataset = e.currentTarget && e.currentTarget.dataset;
    const url = dataset && dataset.url;
    if (!url) return;
    const scope = dataset && dataset.scope;
    let urls = [url];
    if (scope === 'discussion') {
      urls = this.data.discussionImages || [url];
    } else if (scope === 'play') {
      urls = this.data.playImages || [url];
    } else {
      urls = [].concat(this.data.playImages || [], this.data.discussionImages || []);
    }
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] });
  },

  async onCardDraftSubmit() {
    // 兼容旧调用：改为写入共享态（讨论阶段默认疑问讨论）
    if (!this.data.isHost || this.data.cardDraftSaving) return;
    const text = (this.data.cardDraftText || '').trim();
    const draftPhotos = this.data.cardDraftPhotos || [];
    if (!text && !draftPhotos.length) return;

    this.setData({ cardDraftSaving: true });
    try {
      const target = isDiscussionPhase(this.data.gamepagePhase) ? 'discussion' : 'play';
      const ok = await this._appendSharedSectionContent(target, {
        text,
        photos: draftPhotos
      });
      if (ok) {
        this.setData({
          cardDraftText: '',
          cardDraftPhotos: [],
          cardDraftHasText: false
        });
        wx.showToast({ title: '已插入', icon: 'success' });
      }
    } catch (e) {
      console.warn('onCardDraftSubmit', e);
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      this.setData({ cardDraftSaving: false });
    }
  },

  noop() {},

  /** 点击/拖动分界：约 10rpx 换算为 px */
  _getScoreSheetTapSlopPx() {
    if (this._scoreSheetTapSlopPx != null) return this._scoreSheetTapSlopPx;
    try {
      const sys = wx.getSystemInfoSync();
      const w = (sys && sys.windowWidth) || 375;
      this._scoreSheetTapSlopPx = Math.max(4, (w / 750) * 10);
    } catch (e) {
      this._scoreSheetTapSlopPx = 5;
    }
    return this._scoreSheetTapSlopPx;
  },

  _getScoreSheetDragSlopPx() {
    if (this._scoreSheetDragSlopPx != null) return this._scoreSheetDragSlopPx;
    try {
      const sys = wx.getSystemInfoSync();
      const w = (sys && sys.windowWidth) || 375;
      this._scoreSheetDragSlopPx = Math.max(14, (w / 750) * 28);
    } catch (e) {
      this._scoreSheetDragSlopPx = 14;
    }
    return this._scoreSheetDragSlopPx;
  },

  _isScoreSheetTapGesture() {
    const startAt = this._scoreSheetTouchAt || 0;
    const dt = Date.now() - startAt;
    if (dt > 380) return false;
    const startX = this._scoreSheetTouchStartX;
    const startY = this._scoreSheetTouchStartY;
    if (startX == null || startY == null) return true;
    const lastX = this._scoreSheetLastX != null ? this._scoreSheetLastX : startX;
    const lastY = this._scoreSheetLastY != null ? this._scoreSheetLastY : startY;
    const dragSlop = this._getScoreSheetDragSlopPx();
    return Math.abs(lastX - startX) < dragSlop && Math.abs(lastY - startY) < dragSlop;
  },

  _scoreSheetVisibleFromY(translateY, maxY, collapsedPx) {
    const y = Math.max(0, Math.min(maxY, translateY));
    // 可见高度 = 头部保留高度 + 仍未移出裁剪窗的按钮区高度
    return Math.max(collapsedPx, Math.round(collapsedPx + (maxY - y)));
  },

  _measureScoreSheetHeights(done) {
    const query = wx.createSelectorQuery().in(this);
    query.select('.score-sheet').boundingClientRect();
    query.select('.score-sheet-header').boundingClientRect();
    query.select('.score-buttons').boundingClientRect();
    query.exec((rects) => {
      const sheet = rects && rects[0];
      const header = rects && rects[1];
      const buttons = rects && rects[2];
      if (!sheet || !sheet.height) {
        if (typeof done === 'function') done();
        return;
      }

      // 头部保留高度：面板顶 → 按钮顶（含顶部 padding / 拖拽条 / 状态行 / 间距）
      let headerH = 0;
      if (buttons && Number.isFinite(buttons.top) && Number.isFinite(sheet.top)) {
        headerH = Math.max(0, Math.floor(buttons.top - sheet.top));
      } else if (header && header.height) {
        // 回退：实测 header + 面板顶部 padding 近似
        headerH = Math.max(0, Math.floor(header.height + 6));
      }
      if (headerH < 40) headerH = 56;

      // 收起位移 = 按钮区顶 → 面板底（含按钮、间距、底部 padding），向上取整避免露边
      let maxY = 0;
      if (buttons && Number.isFinite(buttons.top) && Number.isFinite(sheet.bottom)) {
        maxY = Math.max(0, Math.ceil(sheet.bottom - buttons.top));
      } else {
        maxY = Math.max(0, Math.ceil(sheet.height - headerH));
      }

      this._scoreSheetMaxY = maxY;
      const expanded = this.data.scorePanelExpanded === true;
      const translateY = expanded ? 0 : maxY;
      // 测量中途不打断吸附动画
      if (this.data.scoreSheetAnimating) {
        this.setData({
          scoreSheetCollapsedPx: headerH,
          scoreSheetMaxTranslateY: maxY
        });
      } else {
        this.setData({
          scoreSheetCollapsedPx: headerH,
          scoreSheetMaxTranslateY: maxY,
          scoreSheetTranslateY: translateY,
          scoreSheetVisiblePx: this._scoreSheetVisibleFromY(translateY, maxY, headerH)
        });
      }
      if (typeof done === 'function') done();
    });
  },

  _setScoreSheetExpanded(expanded, options = {}) {
    const maxY = this._scoreSheetMaxY != null
      ? this._scoreSheetMaxY
      : (this.data.scoreSheetMaxTranslateY || 120);
    const collapsed = this.data.scoreSheetCollapsedPx || 72;
    const targetY = expanded ? 0 : maxY;
    const targetVisible = this._scoreSheetVisibleFromY(targetY, maxY, collapsed);
    const animate = options.animate !== false;
    if (!animate) {
      this.setData({
        scorePanelExpanded: !!expanded,
        scoreSheetAnimating: false,
        scoreSheetTranslateY: targetY,
        scoreSheetVisiblePx: targetVisible
      });
      return;
    }
    this.setData({
      scorePanelExpanded: !!expanded,
      scoreSheetAnimating: true,
      scoreSheetTranslateY: targetY,
      scoreSheetVisiblePx: targetVisible
    });
    clearTimeout(this._scoreSheetAnimTimer);
    this._scoreSheetAnimTimer = setTimeout(() => {
      if (!this.data.scoreSheetAnimating) return;
      // 动画结束后再精确对齐一次，并挂上 collapsed 类彻底藏住按钮
      this.setData({
        scoreSheetAnimating: false,
        scoreSheetTranslateY: targetY,
        scoreSheetVisiblePx: targetVisible
      });
      if (!expanded) {
        // 收起后复测，防止字体/安全区变化导致露边
        this._measureScoreSheetHeights();
      }
    }, 260);
  },

  /** 评分 / 表达等可操作控件：不触发面板展开收起 */
  onScoreInteractiveTouchStart() {
    this._scoreSheetInteractive = true;
  },

  toggleScorePanel() {
    // 真拖拽中不切换；轻触即使误标 DidDrag 也允许（由 tap 手势判定）
    if (this._scoreSheetDragging && !this._isScoreSheetTapGesture()) return;
    if (this._scoreSheetInteractive && this._scoreSheetFromButtons) return;
    this._scoreSheetDidDrag = false;
    this._setScoreSheetExpanded(!this.data.scorePanelExpanded, { animate: true });
  },

  onScoreSheetTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this._scoreSheetTouchStartX = t.clientX;
    this._scoreSheetTouchStartY = t.clientY;
    this._scoreSheetTouchY = t.clientY;
    this._scoreSheetTouchAt = Date.now();
    this._scoreSheetDidDrag = false;
    this._scoreSheetDragging = false;
    this._scoreSheetAxis = '';
    this._scoreSheetInteractive = false;
    this._scoreSheetFromButtons = false;
    this._pendingScoreTap = null;
    this._scoreSheetBaseY = this.data.scoreSheetTranslateY || 0;
    this._scoreSheetLastX = t.clientX;
    this._scoreSheetLastY = t.clientY;
    this._scoreSheetLastAt = Date.now();
    // 拖动开始前关掉过渡，保证跟手
    if (this.data.scoreSheetAnimating) {
      this.setData({ scoreSheetAnimating: false });
    }
  },

  onScoreBtnTouchStart(e) {
    const score = parseInt(e.currentTarget.dataset.score, 10);
    this._pendingScoreTap = Number.isFinite(score) ? score : null;
  },

  onScoreButtonsTouchStart(e) {
    // 子按钮 bindtouchstart 可能已写入待选分；sheet start 会清空，这里先保住
    const keptScore = this._pendingScoreTap;
    this.onScoreSheetTouchStart(e);
    // 评分按钮：默认按「可操作控件」处理；纵向拖够阈值后才改为拖面板
    this._scoreSheetFromButtons = true;
    this._scoreSheetInteractive = true;
    this._pendingScoreTap = keptScore;
    if (this._pendingScoreTap == null) {
      const score = parseInt(
        (e.target && e.target.dataset && e.target.dataset.score),
        10
      );
      if (Number.isFinite(score)) this._pendingScoreTap = score;
    }
  },

  onScoreButtonsTouchMove(e) {
    const t = e.touches && e.touches[0];
    if (!t || this._scoreSheetTouchStartY == null) return;
    this._scoreSheetLastX = t.clientX;
    this._scoreSheetLastY = t.clientY;
    this._scoreSheetLastAt = Date.now();
    const dx = Math.abs(t.clientX - (this._scoreSheetTouchStartX || 0));
    const dy = Math.abs(t.clientY - (this._scoreSheetTouchStartY || 0));
    const dragSlop = this._getScoreSheetDragSlopPx();
    // 横向为主：只选分，不拖面板
    if (!this._scoreSheetDragging && dx > dy && dx > dragSlop) {
      this._scoreSheetAxis = 'x';
      this._scoreSheetInteractive = true;
      return;
    }
    if (this._scoreSheetAxis === 'x') return;
    // 纵向超过拖动阈值：改拖面板
    if (dy > dragSlop && dy > dx) {
      this._scoreSheetInteractive = false;
      this._scoreSheetAxis = 'y';
      this.onScoreSheetTouchMove(e);
    }
  },

  onScoreButtonsTouchEnd(e) {
    const pending = this._pendingScoreTap;
    this._pendingScoreTap = null;

    // 轻触被误判为拖动时，仍按选分处理
    if (this._scoreSheetDragging && !this._isScoreSheetTapGesture()) {
      this.onScoreSheetTouchEnd(e);
      return;
    }

    this._scoreSheetDragging = false;
    this._scoreSheetDidDrag = false;
    this._scoreSheetTouchStartY = null;
    this._scoreSheetFromButtons = false;

    // catchtouchmove 在真机上常取消 tap：touchend 直接提交
    if (pending != null) {
      this._applyScoreTap(pending);
    }

    setTimeout(() => {
      this._scoreSheetDidDrag = false;
      this._scoreSheetInteractive = false;
    }, 80);
  },

  onScoreSheetTouchMove(e) {
    const t = e.touches && e.touches[0];
    if (!t || this._scoreSheetTouchStartY == null) return;

    const dx = Math.abs(t.clientX - (this._scoreSheetTouchStartX || 0));
    const dyFromStart = t.clientY - this._scoreSheetTouchStartY;
    const dragSlop = this._getScoreSheetDragSlopPx();

    this._scoreSheetLastX = t.clientX;
    this._scoreSheetLastY = t.clientY;
    this._scoreSheetLastAt = Date.now();

    if (!this._scoreSheetDragging) {
      if (Math.abs(dyFromStart) < dragSlop && dx < dragSlop) return;
      // 明显纵向才进入拖拽；横向轻微滑动忽略
      if (Math.abs(dyFromStart) <= dx) return;
      this._scoreSheetDragging = true;
      this._scoreSheetDidDrag = true;
      this._scoreSheetAxis = 'y';
      this._scoreSheetInteractive = false;
    }

    const maxY = this._scoreSheetMaxY != null
      ? this._scoreSheetMaxY
      : (this.data.scoreSheetMaxTranslateY || 120);
    const collapsed = this.data.scoreSheetCollapsedPx || 72;
    // 下拖增大 translateY（收起），上拖减小（展开）
    let nextY = this._scoreSheetBaseY + dyFromStart;
    if (nextY < 0) nextY = 0;
    if (nextY > maxY) nextY = maxY;

    this.setData({
      scoreSheetAnimating: false,
      scoreSheetTranslateY: nextY,
      scoreSheetVisiblePx: this._scoreSheetVisibleFromY(nextY, maxY, collapsed)
    });
  },

  onScoreSheetTouchEnd() {
    const maxY = this._scoreSheetMaxY != null
      ? this._scoreSheetMaxY
      : (this.data.scoreSheetMaxTranslateY || 120);
    const currentY = this.data.scoreSheetTranslateY || 0;
    const interactive = this._scoreSheetInteractive === true;
    const dragSlop = this._getScoreSheetDragSlopPx();
    // 位移很小 / 时间很短：按点击展开收起，避免 5px 抖动导致「点了没反应」
    const wasDragging = this._scoreSheetDragging === true && !this._isScoreSheetTapGesture();

    if (!wasDragging) {
      this._scoreSheetTouchStartY = null;
      this._scoreSheetFromButtons = false;
      this._scoreSheetDragging = false;
      this._scoreSheetDidDrag = false;
      // 可操作控件上的点击：不切换面板
      if (!interactive) {
        this._setScoreSheetExpanded(!this.data.scorePanelExpanded, { animate: true });
      }
      setTimeout(() => {
        this._scoreSheetDidDrag = false;
        this._scoreSheetInteractive = false;
      }, 80);
      return;
    }

    const totalDy = (this._scoreSheetLastY != null && this._scoreSheetTouchStartY != null)
      ? (this._scoreSheetLastY - this._scoreSheetTouchStartY)
      : 0;

    let expand = this.data.scorePanelExpanded;
    // 达到拖动阈值后：上滑展开、下滑收起
    if (totalDy <= -dragSlop) {
      expand = true;
    } else if (totalDy >= dragSlop) {
      expand = false;
    } else {
      expand = currentY < maxY / 2;
    }

    this._scoreSheetDragging = false;
    this._scoreSheetTouchStartY = null;
    this._scoreSheetFromButtons = false;
    this._scoreSheetInteractive = false;
    this._setScoreSheetExpanded(expand, { animate: true });
    setTimeout(() => {
      this._scoreSheetDidDrag = false;
    }, 80);
  },

  onScoreTap(e) {
    // 评分只选分，不联动面板；真实拖动手势忽略
    this._scoreSheetInteractive = false;
    if (this._scoreSheetDragging && !this._isScoreSheetTapGesture()) return;
    if (this._scoreSheetDidDrag && !this._isScoreSheetTapGesture()) return;
    const score = parseInt(e.currentTarget.dataset.score, 10);
    if (!Number.isFinite(score)) return;
    this._applyScoreTap(score);
  },

  async _applyScoreTap(score) {
    if (!Number.isFinite(score)) return;
    // 防止 touchend 兜底与 tap 双发
    if (this._scoreTapLockScore === score && Date.now() - (this._scoreTapLockAt || 0) < 400) {
      return;
    }
    this._scoreTapLockScore = score;
    this._scoreTapLockAt = Date.now();
    this._scoreSheetDidDrag = false;

    if (this.data.isCurrentPlayer) {
      wx.showToast({ title: '当前出牌玩家无需打分', icon: 'none' });
      return;
    }

    this._scoreSubmitLock = true;
    this._scoreSheetInteractive = false;
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
    } finally {
      setTimeout(() => {
        this._scoreSubmitLock = false;
      }, 300);
    }
  },

  openExpressComposer() {
    if (isClosingPhase(this.data.gamepagePhase)) {
      wx.showToast({ title: '当前阶段不可表达', icon: 'none' });
      return;
    }
    this.setData({
      expressComposerOpen: true,
      expressDraftText: '',
      expressHasText: false
    });
  },

  closeExpressComposer() {
    if (this.data.expressSending) return;
    this.setData({
      expressComposerOpen: false,
      expressDraftText: '',
      expressHasText: false
    });
  },

  onExpressComposerBlur() {
    // 无内容时失焦收起，避免挡聊天区
    if (this.data.expressSending) return;
    if ((this.data.expressDraftText || '').trim()) return;
    this.setData({ expressComposerOpen: false });
  },

  /** 出牌玩家：表态结束后（进入讨论）才可发送；讨论阶段全员可发；旁观出牌阶段可发 */
  _computeExpressCanSend(isCurrentPlayer, phase) {
    if (isClosingPhase(phase)) return false;
    if (isDiscussionPhase(phase)) return true;
    return !isCurrentPlayer;
  },

  openExpressChatPanel() {
    this.toggleExpressChatInCard();
  },

  /** 出牌玩家：点击表达仅切换卡内内容（行动规则 ↔ 匿名聊天） */
  toggleExpressChatInCard() {
    if (isClosingPhase(this.data.gamepagePhase)) {
      wx.showToast({ title: '当前阶段不可查看', icon: 'none' });
      return;
    }
    if (this.data.expressChatPanelVisible) {
      this.closeExpressChatPanel();
      return;
    }
    const canSend = this._computeExpressCanSend(
      this.data.isCurrentPlayer,
      this.data.gamepagePhase
    );
    this.setData({
      expressChatPanelVisible: true,
      expressCanSend: canSend,
      expressDraftText: '',
      expressHasText: false,
      expressChatAnchor: this.data.expressChatList.length ? 'express-chat-bottom' : ''
    });
  },

  closeExpressChatPanel() {
    if (this.data.expressSending) return;
    this.setData({
      expressChatPanelVisible: false,
      expressDraftText: '',
      expressHasText: false
    });
  },

  openExpressModal() {
    // 出牌玩家进聊天面板；非出牌走卡内输入条
    if (!this.data.isCurrentPlayer) {
      this.openExpressComposer();
      return;
    }
    this.openExpressChatPanel();
  },

  closeExpressModal() {
    this.closeExpressChatPanel();
  },

  onExpressInput(e) {
    const text = (e.detail && e.detail.value) || '';
    this.setData({
      expressDraftText: text,
      expressHasText: !!text.trim()
    });
  },

  async submitExpress() {
    if (this.data.expressSending) return;
    const canSend = this._computeExpressCanSend(
      this.data.isCurrentPlayer,
      this.data.gamepagePhase
    );
    if (!canSend) {
      wx.showToast({ title: '本轮表态结束后可发送', icon: 'none' });
      return;
    }
    const text = (this.data.expressDraftText || '').trim();
    if (!text) return;
    const roomId = this.data.roomId;
    if (!roomId) return;

    const phase = isDiscussionPhase(this.data.gamepagePhase) ? 'discussion' : 'play';
    this.setData({ expressSending: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'postPartnerExpress',
        data: {
          roomId,
          text,
          round: this.data.currentRound,
          phase
        }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '发送失败', icon: 'none' });
        return;
      }
      // 发送方本地预展示；用独立入口，避免「首次同步吞历史」把刚发的也吞掉，同时按 id 去重
      if (result.message) {
        this._showExpressMessage(result.message);
      }
      this.setData({
        expressModalVisible: false,
        expressComposerOpen: false,
        expressDraftText: '',
        expressHasText: false
      });
    } catch (e) {
      console.warn('submitExpress', e);
      wx.showToast({ title: '发送失败', icon: 'none' });
    } finally {
      this.setData({ expressSending: false });
    }
  },

  /** 匿名表达色点：同 anonKey 固定同色（按房间内首次出现顺序分配） */
  _expressDotColors() {
    return [
      '#FF6B6B',
      '#4ECDC4',
      '#FFB020',
      '#6C8CFF',
      '#C084FC',
      '#34D399',
      '#F97316',
      '#F472B6'
    ];
  },

  _expressAvatarKey(msg) {
    if (!msg) return '';
    if (msg.anonKey) return String(msg.anonKey);
    // 兼容：id 形如 anonKey_timestamp_random
    const id = String(msg.id || '');
    const m = id.match(/^([a-f0-9]{16})_/i);
    if (m) return m[1];
    return '';
  },

  _seedExpressAnonColors(messages) {
    if (!this._expressAnonColorMap) this._expressAnonColorMap = Object.create(null);
    const colors = this._expressDotColors();
    (messages || []).forEach((msg) => {
      const key = this._expressAvatarKey(msg);
      if (!key || this._expressAnonColorMap[key]) return;
      const idx = Object.keys(this._expressAnonColorMap).length % colors.length;
      this._expressAnonColorMap[key] = colors[idx];
    });
  },

  _resolveExpressDotColor(msg) {
    const key = this._expressAvatarKey(msg);
    if (!key) return '#B0B0B0';
    if (!this._expressAnonColorMap) this._expressAnonColorMap = Object.create(null);
    if (!this._expressAnonColorMap[key]) {
      this._seedExpressAnonColors([msg]);
    }
    return this._expressAnonColorMap[key] || '#B0B0B0';
  },

  _mapExpressChatItem(msg) {
    if (!msg || !msg.id) return null;
    const dotColor = this._resolveExpressDotColor(msg);
    return {
      id: msg.id,
      text: msg.text || '',
      round: msg.round != null ? Number(msg.round) : null,
      phase: msg.phase === 'discussion' ? 'discussion' : 'play',
      // 统一灰色默认头，不区分玩家
      avatar: EXPRESS_ANON_AVATAR,
      dotColor,
      avatarDotStyle: `background-color:${dotColor};`
    };
  },

  /**
   * 页面级表达列表对应的轮次：始终为当前进行中的轮次。
   * 历史纪要卡使用 item.*ExpressChatList，不复用页面级字段（避免 swiper 预览串台）。
   */
  _getExpressViewRound(currentRoundOverride) {
    const cr = currentRoundOverride != null
      ? Number(currentRoundOverride)
      : Number(this.data.currentRound);
    return Number.isFinite(cr) ? cr : 0;
  },

  /** 旧消息无 phase 时归入出牌阶段 */
  _normalizeExpressPhase(msg) {
    return msg && msg.phase === 'discussion' ? 'discussion' : 'play';
  },

  _filterExpressMessagesByRound(messages, round, currentRoundOverride) {
    const list = Array.isArray(messages) ? messages : [];
    const r = Number(round);
    if (!Number.isFinite(r)) return [];
    const currentRound = currentRoundOverride != null
      ? Number(currentRoundOverride)
      : (Number(this.data.currentRound) || 0);
    return list.filter((msg) => {
      if (!msg || !msg.id) return false;
      if (msg.round == null || msg.round === '') {
        // 旧数据无 round：仅挂在当前轮，避免历史卡串台
        return r === currentRound;
      }
      return Number(msg.round) === r;
    });
  },

  _filterExpressMessagesByRoundAndPhase(messages, round, phase, currentRoundOverride) {
    const want = phase === 'discussion' ? 'discussion' : 'play';
    return this._filterExpressMessagesByRound(messages, round, currentRoundOverride)
      .filter((msg) => this._normalizeExpressPhase(msg) === want);
  },

  _mapExpressChatList(messages) {
    const list = Array.isArray(messages) ? messages : [];
    // 先用全量消息播种，保证跨轮次 / 分段列表同人同色
    this._seedExpressAnonColors(this._expressMessagesAll || []);
    this._seedExpressAnonColors(list);
    return list
      .slice(-40)
      .map((msg) => this._mapExpressChatItem(msg))
      .filter(Boolean);
  },

  _buildExpressListsForRound(messages, round, currentRoundOverride) {
    const playList = this._mapExpressChatList(
      this._filterExpressMessagesByRoundAndPhase(messages, round, 'play', currentRoundOverride)
    );
    const discussionList = this._mapExpressChatList(
      this._filterExpressMessagesByRoundAndPhase(messages, round, 'discussion', currentRoundOverride)
    );
    return {
      // 出牌卡仍用 expressChatList：只看出牌阶段
      expressChatList: playList,
      playExpressChatList: playList,
      discussionExpressChatList: discussionList
    };
  },

  _syncExpressChatList(messages, options = {}) {
    if (Array.isArray(messages)) {
      this._expressMessagesAll = messages;
    }
    const all = this._expressMessagesAll || [];
    // 页面级列表只绑定当前轮卡片，与 swiper cardIndex 无关
    const viewRound = options.viewRound != null
      ? Number(options.viewRound)
      : this._getExpressViewRound(options.currentRound);
    const lists = this._buildExpressListsForRound(all, viewRound, options.currentRound);
    const prevPlay = this.data.playExpressChatList || [];
    const prevDiscussion = this.data.discussionExpressChatList || [];
    const playTail = lists.playExpressChatList.length
      ? lists.playExpressChatList[lists.playExpressChatList.length - 1].id
      : '';
    const discussionTail = lists.discussionExpressChatList.length
      ? lists.discussionExpressChatList[lists.discussionExpressChatList.length - 1].id
      : '';
    const prevPlayTail = prevPlay.length ? prevPlay[prevPlay.length - 1].id : '';
    const prevDiscussionTail = prevDiscussion.length
      ? prevDiscussion[prevDiscussion.length - 1].id
      : '';
    const changed = prevPlay.length !== lists.playExpressChatList.length
      || prevDiscussion.length !== lists.discussionExpressChatList.length
      || prevPlayTail !== playTail
      || prevDiscussionTail !== discussionTail
      || this.data.expressViewRound !== viewRound;
    if (!changed && !options.force) return;
    const patch = {
      expressChatList: lists.expressChatList,
      playExpressChatList: lists.playExpressChatList,
      discussionExpressChatList: lists.discussionExpressChatList,
      expressViewRound: viewRound
    };
    if (options.scrollBottom !== false) {
      if (lists.playExpressChatList.length) {
        patch.expressChatAnchor = 'express-chat-bottom';
      }
      if (lists.discussionExpressChatList.length) {
        patch.discussionExpressChatAnchor = 'discussion-express-chat-bottom';
      }
    }
    this.setData(patch);
  },

  _showExpressMessage(msg) {
    if (!msg || !msg.id || !msg.text) return;
    if (!this._seenExpressIds) this._seenExpressIds = {};
    if (this._seenExpressIds[msg.id]) return;
    this._seenExpressIds[msg.id] = true;
    this._expressReady = true;

    const all = (this._expressMessagesAll || []).concat([msg]).slice(-40);
    this._expressMessagesAll = all;

    const currentRound = this._getExpressViewRound();
    const msgRound = msg.round != null
      ? Number(msg.round)
      : currentRound;
    if (msgRound === currentRound) {
      this._syncExpressChatList(all, { force: true, viewRound: currentRound });
    }
    this._refreshSummaryExpressLists(all);
  },

  _refreshSummaryExpressLists(messages) {
    const all = Array.isArray(messages) ? messages : (this._expressMessagesAll || []);
    const patchList = (list) => (list || []).map((item) => {
      const lists = this._buildExpressListsForRound(all, item.round);
      return {
        ...item,
        expressChatList: lists.expressChatList,
        playExpressChatList: lists.playExpressChatList,
        discussionExpressChatList: lists.discussionExpressChatList
      };
    });
    const roundSummaries = this.data.roundSummaries || [];
    const displayRoundSummaries = this.data.displayRoundSummaries || [];
    if (!roundSummaries.length && !displayRoundSummaries.length) return;
    this.setData({
      roundSummaries: patchList(roundSummaries),
      displayRoundSummaries: patchList(displayRoundSummaries)
    });
  },

  _ingestExpressMessages(messages, options = {}) {
    if (!this._seenExpressIds) this._seenExpressIds = {};
    const list = Array.isArray(messages) ? messages : [];
    this._expressMessagesAll = list;

    if (!this._expressReady) {
      list.forEach((msg) => {
        if (msg && msg.id) this._seenExpressIds[msg.id] = true;
      });
      this._expressReady = true;
      this._syncExpressChatList(list, {
        force: true,
        scrollBottom: true,
        currentRound: options.currentRound
      });
      // roundSummaries 已在 _applyRoomContext 里带上 expressChatList
      return;
    }

    list.forEach((msg) => {
      if (msg && msg.id) this._seenExpressIds[msg.id] = true;
    });
    this._syncExpressChatList(list, {
      force: options.force === true,
      currentRound: options.currentRound
    });
  },

  onTapSpecialMove() {
    // 仅当前出牌轮次玩家可进入；房主不可代操作
    const canSpecial = this.data.showSpecialMoveBtn
      || (
        !!this.data.isCurrentPlayer
        && !isDiscussionPhase(this.data.gamepagePhase)
        && !isClosingPhase(this.data.gamepagePhase)
      );
    if (!canSpecial) {
      wx.showToast({ title: '请等待您的轮次', icon: 'none' });
      return;
    }
    if (this.data.isMasterMode || this.data.specialMoveUsedThisTurn) {
      wx.showToast({ title: '本轮特殊行动已使用', icon: 'none' });
      return;
    }
    const roomId = this.data.roomId;
    const currentPlayerIndex = this.data.currentPlayerIndex != null
      ? this.data.currentPlayerIndex
      : 1;
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }
    // 先停轮询，避免 navigate 过程中被房间态打回 gamepage
    this._stopStatePolling();
    this._stopRoundTimerBurstPoll();
    const url = buildSpecialMoveUrl(roomId, currentPlayerIndex);
    const opened = openPartnerPage(url);
    if (!opened) {
      wx.navigateTo({
        url,
        fail: (err) => {
          console.warn('navigateTo specialMove fail', err);
          // 栈满或并发冲突时降级 redirect
          wx.redirectTo({
            url,
            fail: (err2) => {
              console.warn('redirectTo specialMove fail', err2);
              this._startStatePolling();
              wx.showToast({ title: '打开特殊行动失败', icon: 'none' });
            }
          });
        }
      });
    }
  },

  handleSpecialMove() {
    this.onTapSpecialMove();
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

    const amCurrentAfterPass = !!(members.find(
      (m) => m && m.isMe && toPlayerIndex(m.playerIndex, 0) === toPlayerIndex(nextIndex, 0)
    ));
    if (incrementRound) {
      this._roundContentSyncToken = (this._roundContentSyncToken || 0) + 1;
    }
    this.setData({
      currentPlayerIndex: nextIndex,
      currentPlayerName: nextName,
      gamepagePhase: PHASE_PLAY,
      isMasterMode: false,
      selectedScore: null,
      canStartStatement: false,
      scoredCount: 0,
      scorePanelExpanded: false,
      scoreSheetTranslateY: this.data.scoreSheetMaxTranslateY || 120,
      scoreSheetVisiblePx: this.data.scoreSheetCollapsedPx || 72,
      scoreSheetAnimating: false,
      specialMoveUsedThisTurn: false,
      isCurrentPlayer: amCurrentAfterPass,
      showSpecialMoveBtn: amCurrentAfterPass,
      playHistory: incrementRound ? [] : this.data.playHistory,
      discussionNotes: incrementRound ? [] : this.data.discussionNotes,
      playImages: incrementRound ? [] : this.data.playImages,
      discussionImages: incrementRound ? [] : this.data.discussionImages,
      playBlocks: incrementRound ? [] : this.data.playBlocks,
      discussionBlocks: incrementRound ? [] : this.data.discussionBlocks,
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

  handleToggleProblemExpand() {
    const text = this.data.selectedProblemText;
    if (!text) return;
    if (!this.data.problemExpanded && !this.data.problemTextOverflow) return;
    const next = !this.data.problemExpanded;
    this.setData({ problemExpanded: next }, () => {
      if (!next) this._checkProblemTextOverflow();
    });
  },

  _checkProblemTextOverflow() {
    if (!this.data.selectedProblemText || this.data.problemExpanded) {
      if (this.data.problemTextOverflow) {
        this.setData({ problemTextOverflow: false });
      }
      return;
    }
    const run = () => {
      this.createSelectorQuery()
        .select('#problemText')
        .boundingClientRect()
        .select('#problemTextMeasure')
        .boundingClientRect()
        .exec((res) => {
          const clamped = res && res[0];
          const full = res && res[1];
          if (!clamped || !full || !full.height) return;
          const overflow = full.height > clamped.height + 1;
          if (overflow !== this.data.problemTextOverflow) {
            this.setData({ problemTextOverflow: overflow });
          }
        });
    };
    if (typeof wx.nextTick === 'function') wx.nextTick(run);
    else setTimeout(run, 50);
  },

  async _refreshInspirationCount() {
    const { roomId } = this.data;
    if (!roomId) return;
    try {
      const inspirationCount = await countSessionInspirations(roomId);
      if (inspirationCount !== this.data.inspirationCount) {
        this.setData({ inspirationCount });
      }
    } catch (e) {
      console.warn('_refreshInspirationCount', e);
    }
  },

  /**
   * 灵感输入稳定策略（模拟器 + 真机）：
   * 1) 栏体始终在文档流；icon / 输入框同高 92rpx
   * 2) 不绑 focus 属性（真机 focus=false 会锁死输入法）；点击交给 input 原生聚焦
   * 3) bindfocus 内禁止立刻 setData（Android 会打断键盘）；延后标记 focused
   * 4) 真机用 transform 上移（键盘高 - 底栏高），底栏留在键盘下；devtools 忽略高度
   */
  _isDevtools() {
    if (this._isDevtoolsCached != null) return this._isDevtoolsCached;
    try {
      const sys = wx.getSystemInfoSync();
      this._isDevtoolsCached = !!(sys && sys.platform === 'devtools');
    } catch (e) {
      this._isDevtoolsCached = false;
    }
    return this._isDevtoolsCached;
  },

  _measureInspirationFooterClearance() {
    // 只缓存高度，禁止 setData，避免进页闪一下
    setTimeout(() => {
      wx.createSelectorQuery()
        .in(this)
        .select('.page-footer')
        .boundingClientRect((rect) => {
          this._inspirationFooterClearancePx = rect && rect.height
            ? Math.ceil(rect.height)
            : 0;
        })
        .exec();
    }, 64);
  },

  _buildInspirationLiftStyle(keyboardHeight) {
    const kh = Math.max(0, Number(keyboardHeight) || 0);
    if (kh <= 0) return '';
    // 栏在底栏上方：上移 (键盘高 - 底栏高) 后贴齐输入法顶边
    const footer = Math.max(0, this._inspirationFooterClearancePx || 0);
    const dy = Math.max(0, kh - footer);
    return dy > 0 ? `transform:translateY(-${dy}px)` : '';
  },

  _resetInspirationKeyboardUi() {
    return {
      inspirationKeyboardHeight: 0,
      inspirationLiftStyle: ''
    };
  },

  _setInspirationKeyboardHeight(height) {
    const next = this._isDevtools() ? 0 : Math.max(0, Number(height) || 0);
    const style = this._buildInspirationLiftStyle(next);
    if (
      next === this.data.inspirationKeyboardHeight
      && style === this.data.inspirationLiftStyle
    ) {
      return;
    }
    this.setData({
      inspirationKeyboardHeight: next,
      inspirationLiftStyle: style
    });
  },

  onInspirationFocus() {
    if (this._inspirationBlurTimer) {
      clearTimeout(this._inspirationBlurTimer);
      this._inspirationBlurTimer = null;
    }
    this._inspirationNativeFocused = true;
    // 延后标记，避开 Android「聚焦瞬间 setData 打掉输入法」
    if (this._inspirationFocusUiTimer) clearTimeout(this._inspirationFocusUiTimer);
    this._inspirationFocusUiTimer = setTimeout(() => {
      this._inspirationFocusUiTimer = null;
      if (!this._inspirationNativeFocused) return;
      if (!this.data.inspirationInputFocused) {
        this.setData({ inspirationInputFocused: true });
      }
    }, 280);
  },

  onInspirationBlur() {
    this._inspirationNativeFocused = false;
    if (this._inspirationFocusUiTimer) {
      clearTimeout(this._inspirationFocusUiTimer);
      this._inspirationFocusUiTimer = null;
    }
    if (this._inspirationBlurTimer) clearTimeout(this._inspirationBlurTimer);
    this._inspirationBlurTimer = setTimeout(() => {
      if (this._inspirationPickingImage) return;
      if (this._inspirationNativeFocused) return;
      this.setData({
        inspirationInputFocused: false,
        inspirationHoldKeyboard: false,
        ...this._resetInspirationKeyboardUi()
      });
    }, 180);
  },

  onInspirationKeyboardHeightChange(e) {
    const height = (e && e.detail && e.detail.height) || (e && e.height) || 0;
    const active = this.data.inspirationInputFocused || this._inspirationNativeFocused;
    if (!active && height > 0) return;
    if (!active && height <= 0) {
      this._setInspirationKeyboardHeight(0);
      return;
    }
    this._setInspirationKeyboardHeight(height);
  },

  _bindInspirationKeyboard() {
    if (this._inspirationKeyboardBound) return;
    this._inspirationKeyboardBound = true;
    this._onInspirationKeyboardHeightChange = this.onInspirationKeyboardHeightChange.bind(this);
    if (typeof wx.onKeyboardHeightChange === 'function') {
      wx.onKeyboardHeightChange(this._onInspirationKeyboardHeightChange);
    }
  },

  _unbindInspirationKeyboard() {
    if (!this._inspirationKeyboardBound) return;
    this._inspirationKeyboardBound = false;
    if (
      typeof wx.offKeyboardHeightChange === 'function'
      && this._onInspirationKeyboardHeightChange
    ) {
      wx.offKeyboardHeightChange(this._onInspirationKeyboardHeightChange);
    }
    this._onInspirationKeyboardHeightChange = null;
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
    const hasPhotos = (this.data.inspirationDraftPhotos || []).length > 0;
    // 加号：选图加入灵感草稿；上箭头：保存到灵感空间
    if (!this.data.inspirationHasText && !hasPhotos) {
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
    this._inspirationPickingImage = true;
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
            this._inspirationPickingImage = false;
            if (!paths.length) {
              this.setData({ inspirationHoldKeyboard: false });
              return;
            }
            this.setData({
              inspirationDraftPhotos: photos.concat(paths),
              inspirationInputFocused: true,
              inspirationHoldKeyboard: false
            });
          },
          fail: () => {
            this._inspirationPickingImage = false;
            this.setData({
              inspirationHoldKeyboard: false,
              inspirationInputFocused: false
            });
          }
        });
      },
      fail: () => {
        this._inspirationPickingImage = false;
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
        inspirationHoldKeyboard: false,
        ...this._resetInspirationKeyboardUi()
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
    const seq = this.data.brainstormSessionSeq != null ? this.data.brainstormSessionSeq : 0;
    // scope=workshop：列出本人在本房间的全部灵感（与灯泡角标一致）
    let url = '/pages/inspiration/index?scope=workshop';
    if (roomId) {
      url += `&roomId=${encodeURIComponent(roomId)}&brainstormSessionSeq=${seq}`;
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
      cardIndex: 1,
      paginationDots: buildPaginationDots(1, this.data.cardCount),
      closingReviewRounds: this._buildClosingReviewRounds({
        roomId: this.data.roomId,
        brainstormSessionSeq: this.data.brainstormSessionSeq,
        currentRound: this.data.currentRound,
        playHistory: this.data.playHistory,
        discussionNotes: this.data.discussionNotes,
        playImages: this.data.playImages,
        discussionImages: this.data.discussionImages,
        playBlocks: this.data.playBlocks,
        discussionBlocks: this.data.discussionBlocks
      })
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

  onClosingCreativeTitleTap() {
    // 已改为常驻 textarea，点击即原生聚焦
  },

  onClosingCreativeFocus() {
    this.setData({ closingCreativeEditFocus: true });
  },

  onClosingCreativeInput(e) {
    this.setData({
      closingCreativeEditText: (e.detail && e.detail.value) || ''
    });
  },

  async onClosingCreativeConfirm() {
    await this._commitClosingCreativeEdit();
  },

  async onClosingCreativeBlur() {
    await this._commitClosingCreativeEdit({ allowEmptyExit: true });
  },

  async _commitClosingCreativeEdit(options = {}) {
    if (this.data.closingCreativeSaving) return;
    const raw = this.data.closingCreativeEditText || '';
    if (!splitRecordSegments(raw).length) {
      if (options.allowEmptyExit) {
        this.setData({
          closingCreativeEditFocus: false
        });
      }
      return;
    }
    this.setData({ closingCreativeSaving: true });
    try {
      const ok = await this._appendClosingCreativeContent({ text: raw });
      if (ok) {
        this.setData({
          closingCreativeEditText: '',
          closingCreativeEditFocus: false
        });
      }
    } finally {
      this.setData({ closingCreativeSaving: false });
    }
  },

  onClosingCreativeAddImage() {
    if (this.data.gamepagePhase !== PHASE_CLOSING
      || this.data.closingStep !== CLOSING_STEP_REVIEW) {
      return;
    }
    const imageCount = (this.data.closingCreativeBlocks || []).filter(
      (b) => b && b.type === 'image'
    ).length;
    const remain = 9 - imageCount;
    if (remain <= 0) {
      wx.showToast({ title: '最多插入 9 张图片', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        wx.chooseImage({
          count: remain,
          sizeType: ['compressed'],
          sourceType,
          success: async (chooseRes) => {
            const paths = chooseRes.tempFilePaths || [];
            if (!paths.length) return;
            wx.showLoading({ title: '上传中…', mask: true });
            try {
              await this._appendClosingCreativeContent({ photos: paths });
              this.setData({ closingCreativeEditFocus: true });
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

  onClosingCreativePreview(e) {
    const url = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.url
      : '';
    if (!url) return;
    const urls = (this.data.closingCreativeBlocks || [])
      .filter((b) => b && b.type === 'image' && b.url)
      .map((b) => b.url);
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] });
  },

  async _uploadClosingCreativePhotos(paths) {
    const roomId = this.data.roomId || 'room';
    const list = Array.isArray(paths) ? paths : [];
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const filePath = list[i];
      try {
        const cloudPath = `partnerClosingCreative/${roomId}/${Date.now()}_${i}.jpg`;
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
        if (uploadRes && uploadRes.fileID) {
          results.push(uploadRes.fileID);
          continue;
        }
      } catch (e) {
        console.warn('_uploadClosingCreativePhotos cloud fail', e);
      }
      results.push(await persistTempPhoto(filePath));
    }
    return results;
  },

  async _appendClosingCreativeContent(options = {}) {
    const text = typeof options.text === 'string' ? options.text : '';
    const photos = Array.isArray(options.photos) ? options.photos : [];
    const segments = splitRecordSegments(text);
    if (!segments.length && !photos.length) return false;

    let uploaded = [];
    if (photos.length) {
      uploaded = await this._uploadClosingCreativePhotos(photos);
      if (!uploaded.length && !segments.length) {
        wx.showToast({ title: '图片上传失败', icon: 'none' });
        return false;
      }
    }

    let nextBlocks = (this.data.closingCreativeBlocks || []).slice();
    if (uploaded.length) nextBlocks = appendImageBlocks(nextBlocks, uploaded);
    if (segments.length) nextBlocks = appendTextSegments(nextBlocks, text);
    this.setData({
      closingCreativeBlocks: nextBlocks,
      ...this._closingDeckImagePatch(nextBlocks)
    });

    const ok = await this._syncClosingCreativeToRoom(nextBlocks);
    if (!ok) {
      wx.showToast({ title: '同步失败', icon: 'none' });
    }
    return ok;
  },

  async _syncClosingCreativeToRoom(blocks) {
    const roomId = this.data.roomId;
    if (!roomId) return false;
    const nextBlocks = normalizeContentBlocks(blocks);
    const derived = deriveListsFromBlocks(nextBlocks);
    try {
      const res = await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'gamepage',
          partnerClosingCreativePoints: {
            blocks: nextBlocks,
            texts: derived.texts,
            images: derived.images
          }
        }
      });
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('syncClosingCreativeToRoom', e);
      return false;
    }
  },

  onClosingReviewPreview(e) {
    const url = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url;
    if (!url) return;
    const urls = (this.data.reviewPhotos || []).slice();
    wx.previewImage({
      current: url,
      urls: urls.length ? urls : [url]
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
