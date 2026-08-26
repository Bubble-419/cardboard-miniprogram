/**
 * 脑暴大富翁（partnerMode）- 出牌页
 * 路径：pages/main-pages/partnerMode/gamepage/
 */
const {
  assignAvatarImages,
  preserveMemberAvatars,
  prepareMembersForDisplay,
  memberHasCloudAvatar,
  getMemberAvatarFingerprint,
  getAvatarStableKey
} = require('../../../../utils/avatars');
const { safeNavigateBack } = require('../../../../utils/pageNavigate');
const { resolveRoundContentMedia, resolveCloudDisplayUrls } = require('../../../../utils/cloudDisplayUrl');

/** 匿名表达统一灰色默认头像（不区分玩家） */
const EXPRESS_ANON_AVATAR = '/assets/home/user-avatar-default.png';
const { buildSpecialMoveUrl, buildClosingStatementUrl, buildLeaderboardUrl } = require('../../../../utils/modeRoutes');
const { navigateByRoomState, safeOpenUrl, openPartnerPage } = require('../../../../utils/subAwaitRoutes');
const {
  bindPageToRoomSession,
  unbindPageFromRoomSession,
  getActiveRoomSession
} = require('../../../../modules/room-session/index');
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
  STATEMENT_ALL_PASS,
  STATEMENT_ALL_QUESTION
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
  ROUND_DURATION_SEC
} = require('../../../../utils/partnerRoundTimer');
const {
  normalizePartnerRoundContent,
  normalizeContentBlocks,
  appendTextSegments,
  appendImageBlocks,
  limitImageBlocks,
  deriveListsFromBlocks,
  splitRecordSegments,
  getStatementLabel
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
const { getCapsuleTopBarMetrics } = require('../../../../utils/capsuleTopBar');
const {
  normalizeHalfStarScore,
  clampSelectableScore,
  formatScoreDisplay,
  toHalfSteps
} = require('../../../../utils/halfStarScore');
const {
  buildReviewSnapshot,
  saveReviewSnapshot,
  getReviewSnapshot,
  getHistoryWorkshopByRoomId
} = require('../../../../utils/historyWorkshops');

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
    /** 历史工作坊回顾模式：只看纪要卡片、可记灵感，不推进游戏/轮询 */
    isHistoryReview: false,
    cardIndex: 0,
    playImages: [],
    discussionImages: [],
    playBlocks: [],
    discussionBlocks: [],
    scoreOptions: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
    selectedScore: null,
    selectedScoreText: '',
    scoredCount: 0,
    innerScrollLocked: false,
    starRatingCollapsed: false,
    starRatingGesturing: false,
    scoreSubmitting: false,
    /** 打分抽屉：translateY=0 全展开；=max 仅露头部 */
    scorePanelExpanded: false,
    scoreSheetTranslateY: 120,
    scoreSheetCollapsedPx: 72,
    scoreSheetMaxTranslateY: 120,
    /** 裁剪可见高度 = collapsed + (maxY - translateY)，与 transform 同步 */
    scoreSheetVisiblePx: 72,
    scoreSheetAnimating: false,
    totalRequired: 0,
    scoreTurnKey: '',
    isMasterMode: false,
    closingStep: CLOSING_STEP_RUNE,
    closingQuestionPlayers: [],
    reviewPhotos: [],
    closingReviewRounds: [],
    closingCreativeBlocks: [],
    closingHasDeckImage: false,
    closingDeckImageUrl: '',
    closingCreativeEditText: '',
    closingCreativeHasText: false,
    closingCreativeEditFocus: false,
    closingCreativeWantFocus: false,
    closingKeyboardHeight: 0,
    closingCreativeSaving: false,
    /** 正在输入态编辑的文字块 key；清空并失焦即删除 */
    closingCreativeEditingKey: '',
    /** 长按图片后显示删除叉的 block key */
    closingImageDeleteKey: '',
    playDraftText: '',
    playDraftFocused: false,
    discussionDraftText: '',
    discussionDraftFocused: false,
    canStartStatement: false,
    /** 打分交互中锁定 swiper，避免 setData 重建纪要卡导致横跳 */
    scoreSwipeLocked: false,
    specialMoveUsedThisTurn: false,
    currentRound: 1,
    brainstormSessionSeq: 0,
    roundSummaries: [],
    displayRoundSummaries: [],
    filteredPlayerIndex: null,
    isPlayerFilterActive: false,
    /** 仅看此人时：非当前出牌人则隐藏出牌卡 */
    showCurrentActionCard: true,
    cardIndexBeforeFilter: 0,
    partnerRoundStartedAt: null,
    /** 当前行动玩家本轮首次倒计时起点；卡片循环重启不更新，供头像框同步 */
    avatarRoundStartedAt: null,
    roundTimerVisible: false,
    /** 已拿到有效共享锚点；与 roundTimerVisible 共同决定卡片框/头像框是否绘制倒计时 */
    roundTimerReady: false,
    roundTimerElapsedRatio: 0,
    roundTimerRemainingSec: 30,
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
    /** 与微信胶囊垂直对齐 */
    topBarPadTop: 20,
    topBarHeight: 32,
    topBarIconSize: 32,
    topBarPaddingRight: 12,
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
    /** 仅打开瞬间为 true，避免 focus 常驻导致每次 setData 重聚焦/收键盘 */
    expressComposerNeedFocus: false,
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
    hostStatementTipTextStyle: '',
    /** 表态并讨论：同步中禁止连点，避免未写完房间态被轮询打回出牌页 */
    statementSwitching: false,
    discussionSwitching: false,
    discussionSwitchAction: ''
  },

  _applyTopBarSafeInset() {
    try {
      const metrics = getCapsuleTopBarMetrics({ minBarPx: 36 });
      // 设计问题 chip 约 74rpx，取与胶囊行高的较大值，保证垂直中心仍对齐胶囊
      const sys = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const windowWidth = (sys && sys.windowWidth) || 375;
      const chipNeedPx = Math.ceil((74 * windowWidth) / 750);
      const barHeight = Math.max(metrics.barHeight, chipNeedPx);
      const capsuleCenter = metrics.padTop + metrics.barHeight / 2;
      // 按更大的 barHeight 重新算 padTop，使整行与胶囊中心齐平
      const padTop = Math.max(0, Math.round(capsuleCenter - barHeight / 2));
      this.setData({
        topBarPadTop: padTop,
        topBarHeight: barHeight,
        topBarIconSize: Math.min(barHeight, Math.max(metrics.iconSize, chipNeedPx)),
        topBarPaddingRight: Math.max(8, metrics.padRightPx + 8)
      });
    } catch (e) {
      this.setData({
        topBarPadTop: 48,
        topBarHeight: 40,
        topBarIconSize: 40,
        topBarPaddingRight: 100
      });
    }
  },

  onLoad(options) {
    this._playerFilterIndex = null;
    this._expressAnonColorMap = Object.create(null);
    this._expressMessagesAll = [];
    this._seenExpressIds = {};
    this._expressReady = false;
    this._cardSwipeBusy = false;
    this._scoreUiBusy = false;
    this._scoreUiBusyTimer = null;
    this._starRatingPinnedOpen = false;
    this._scoreSubmitting = false;
    this._lastSubmittedScore = null;
    this._scoreFingerprint = '';
    this._pendingRoomContext = null;
    this._roomDataReady = false;
    this._cloudAvatarResolving = false;
    // 仅用于“服务端缺字段时的临时兜底”；新页面实例必须从空开始，避免带入旧会话纪要
    this._lastRawRoundSummaries = [];
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
    const isHistoryReview = !!(options && (options.mode === 'review' || options.from === 'history'));
    // 从 URL 读取 currentRound，避免 discussion 重进时 loadRoomData 完成前本地值为初始的 1
    const initialRound = options && options.currentRound != null
      ? parseInt(options.currentRound, 10) || 1
      : 1;
    this._isHistoryReview = isHistoryReview;
    const fromStatement = !!(options && (options.fromStatement === '1' || options.fromStatement === 1));
    // 从表态页回来后，短时间内忽略过期的 currentPage=statement，防止闪回后再点一次
    this._suppressStatementFollowUntil = fromStatement ? Date.now() + 12000 : 0;

    this.setData({
      roomId,
      currentPlayerIndex,
      currentRound: initialRound,
      gamepagePhase: initialPhase,
      closingStep: initialClosingStep,
      cardIndex: initialPhase === PHASE_CLOSING && initialClosingStep === CLOSING_STEP_REVIEW ? 1 : 0,
      specialMoveUsedThisTurn: !!specialMoveUsedFromUrl,
      isHistoryReview
    });

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
      ? '请其他玩家打分，完成后点击表态并讨论'
      : '已采用卡组，请其他玩家打分';
    wx.showToast({ title, icon: 'none', duration: 2500 });
  },

  /** 房主首次进入出牌页：轻量提示「开始表态」需全员打分后才亮起 */
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
        let windowHeight = 667;
        try {
          const sys = typeof wx.getWindowInfo === 'function'
            ? wx.getWindowInfo()
            : wx.getSystemInfoSync();
          windowHeight = (sys && sys.windowHeight) || windowHeight;
        } catch (e) {
          // keep default
        }
        const tipBottomGap = 12;
        this.setData({
          hostStatementTipReady: true,
          hostStatementTipSpotStyle: '',
          hostStatementTipTextStyle:
            `bottom:${Math.max(12, windowHeight - rect.top + tipBottomGap)}px;`
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

  onInnerScrollTouchStart() {
    if (this._innerScrollUnlockTimer) {
      clearTimeout(this._innerScrollUnlockTimer);
      this._innerScrollUnlockTimer = null;
    }
    if (!this.data.innerScrollLocked) {
      this.setData({ innerScrollLocked: true });
    }
  },

  onInnerScrollTouchEnd() {
    if (this._innerScrollUnlockTimer) clearTimeout(this._innerScrollUnlockTimer);
    this._innerScrollUnlockTimer = setTimeout(() => {
      this._innerScrollUnlockTimer = null;
      if (this.data.innerScrollLocked) {
        this.setData({ innerScrollLocked: false });
      }
    }, 80);
  },

  /** iOS：scroll-into-view 若一直停在目标 id，原生列表会锁死无法手势滚动 */
  _clearExpressChatAnchorSoon() {
    if (this._expressAnchorClearTimer) clearTimeout(this._expressAnchorClearTimer);
    this._expressAnchorClearTimer = setTimeout(() => {
      this._expressAnchorClearTimer = null;
      if (!this.data.expressChatAnchor && !this.data.discussionExpressChatAnchor) return;
      this.setData({
        expressChatAnchor: '',
        discussionExpressChatAnchor: ''
      });
    }, 160);
  },

  onShow() {
    this._pageVisible = true;
    this._bindInspirationKeyboard();
    if (this.data.isHistoryReview) {
      // 历史回顾：只刷新灵感角标，不轮询房间状态/计时器
      this._refreshInspirationCount();
      return;
    }
    this._applyPendingSpecialMoveUsed();
    if (this.data.roomId) {
      this._startStatePolling();
      this._startScorePolling();
      // 角标独立刷新，不依赖倒计时同步链路
      this._refreshInspirationCount();
    }
    // 进入页：同步房间倒计时（房主负责重开并广播，其他人跟随）
    this._ensureSharedRoundTimerOnEnter().then(() => {
      this._applyPendingSpecialMoveUsed();
      this._applyAdoptDeckHint();
      // 等 loadRoomData 钉好 currentPlayerIndex 后再拉分，避免 URL 脏座位读到上一回合满分
      if (this._roomDataReady) {
        this.refreshScoreStatus();
      }
      this._syncRoundSpeech();
      this._refreshInspirationCount();
      this._measureInspirationFooterClearance();
    }).catch((e) => {
      console.warn('gamepage onShow timer sync', e);
      this._refreshInspirationCount();
      this._measureInspirationFooterClearance();
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
    this._persistHistoryReviewSnapshot(true);
    this._closingPickingImage = false;
    if (this._closingBlurTimer) {
      clearTimeout(this._closingBlurTimer);
      this._closingBlurTimer = null;
    }
    // 离开时不改 roundTimerVisible：避免卡片框从 timer→idle 布局突变导致转场卡顿
    if (this.data.inspirationKeyboardHeight || this.data.inspirationLiftStyle) {
      this.setData({
        inspirationKeyboardHeight: 0,
        inspirationLiftStyle: ''
      });
    }
    this._stopRoundSpeech();
    this._stopScorePolling();
    this._stopStatePolling();
    this._stopRoundTimerBurstPoll();
    this._stopRoundTimer();
    // 云同步延后，避免与页面转场抢同一帧
    setTimeout(() => {
      if (this._pageVisible) return;
      this._syncRoundContentToRoom();
    }, 0);
  },

  /** 主动跳转前静默停计时/轮询/录音，避免 onHide 叠加重活导致卡片框卡顿 */
  _prepareLeavePage() {
    this._pageVisible = false;
    this._stopRoundSpeech();
    this._stopStatePolling();
    this._stopScorePolling();
    this._stopRoundTimerBurstPoll();
    this._stopRoundTimer();
  },

  onUnload() {
    this._persistHistoryReviewSnapshot(true);
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
    if (this._cardSwipeBusyTimer) {
      clearTimeout(this._cardSwipeBusyTimer);
      this._cardSwipeBusyTimer = null;
    }
    if (this._scoreUiBusyTimer) {
      clearTimeout(this._scoreUiBusyTimer);
      this._scoreUiBusyTimer = null;
    }
    this._cardSwipeBusy = false;
    this._scoreUiBusy = false;
    this._pendingRoomContext = null;
    if (this._expressAnchorClearTimer) {
      clearTimeout(this._expressAnchorClearTimer);
      this._expressAnchorClearTimer = null;
    }
    if (this._innerScrollUnlockTimer) {
      clearTimeout(this._innerScrollUnlockTimer);
      this._innerScrollUnlockTimer = null;
    }
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
      playerIndex: this.data.currentPlayerIndex,
      playerName: this.data.currentPlayerName || `玩家${this.data.currentPlayerIndex || ''}`,
      voiceLines: this.data.voiceLines || [],
      turnRecords: this.data.turnRecords || [],
      aiSummary: { status: 'pending' }
    };
  },

  _shouldRunRoundSpeech() {
    return this.data.isHost
      && this._pageVisible
      && this._roomLoaded
      && !this.data.isHistoryReview
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
      brainstormSessionSeq,
      historyReview
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
    const isReview = historyReview === true
      || this.data.isHistoryReview
      || this._isHistoryReview;
    // 仅看此人：只保留该玩家的纪要卡；若他正好是当前出牌人，才附带出牌卡
    const showCurrentActionCard = !isReview && (
      !filterActive
      || isSamePlayerIndex(filteredPlayerIndex, currentPlayerIndex)
    );
    const cardCount = showCurrentActionCard
      ? Math.max(1, summaryCount + 1)
      : Math.max(1, summaryCount);
    const actionCardIndex = summaryCount;
    const defaultIndex = showCurrentActionCard ? actionCardIndex : Math.max(0, summaryCount - 1);
    const cardIndex = preferredCardIndex != null
      ? Math.min(Math.max(0, preferredCardIndex), cardCount - 1)
      : defaultIndex;
    const indicatorPlayerIndex = cardIndex < summaryCount && displayRoundSummaries[cardIndex]
      ? displayRoundSummaries[cardIndex].playerIndex
      : currentPlayerIndex;

    return {
      displayRoundSummaries,
      cardCount,
      paginationDots: buildPaginationDots(cardIndex, cardCount),
      cardIndex,
      showCurrentActionCard,
      isPlayerFilterActive: filterActive,
      selectedPlayerIndex: filterActive
        ? filteredPlayerIndex
        : currentPlayerIndex,
      indicatorPlayerIndex
    };
  },

  /** 把当前设计问题 / 头像 / 轮次纪要写入本地历史，供回顾页使用 */
  _persistHistoryReviewSnapshot(force) {
    if (this.data.isHistoryReview || this._isHistoryReview) return;
    const roomId = this.data.roomId;
    if (!roomId) return;
    const summaries = this.data.roundSummaries || [];
    // 尚无纪要时也至少落一版（设计问题+头像），方便空房也能回看结构
    if (!force && !summaries.length && !(this.data.selectedProblemText || '').trim()) {
      return;
    }
    const now = Date.now();
    if (!force && this._lastHistorySnapshotAt && now - this._lastHistorySnapshotAt < 2500) {
      return;
    }
    this._lastHistorySnapshotAt = now;
    try {
      const app = getApp();
      const snapshot = buildReviewSnapshot({
        selectedProblemText: this.data.selectedProblemText,
        selectedDesignProblem: (app.globalData && app.globalData.selectedProblem)
          || { text: this.data.selectedProblemText },
        members: this.data.members,
        roundSummaries: summaries,
        expressMessages: this._expressMessagesAll || [],
        currentRound: this.data.currentRound,
        brainstormSessionSeq: this.data.brainstormSessionSeq,
        currentPlayerIndex: this.data.currentPlayerIndex,
        isMasterMode: this.data.isMasterMode,
        workshopName: (app.globalData && app.globalData.workshopName) || ''
      });
      saveReviewSnapshot(roomId, snapshot, {
        name: snapshot.workshopName
      });
    } catch (e) {
      console.warn('persist history review snapshot', e);
    }
  },

  _buildFakeRoomResultFromSnapshot(snapshot) {
    if (!snapshot) return null;
    const members = Array.isArray(snapshot.members) ? snapshot.members.slice() : [];
    if (!members.length) return null;
    // 回顾态不强调「我是谁」，统一关掉 isMe / 出牌态
    const normalizedMembers = members.map((m) => ({
      ...m,
      isMe: false
    }));
    const roomState = Object.assign({}, snapshot.roomState || {}, {
      partnerGamePhase: PHASE_PLAY,
      currentPlayerIndex: 0
    });
    return {
      ok: true,
      members: assignAvatarImages(normalizedMembers),
      isHost: false,
      selectedDesignProblem: snapshot.selectedDesignProblem
        || (snapshot.selectedProblemText
          ? { id: '', text: snapshot.selectedProblemText }
          : null),
      roomState
    };
  },

  _finalizeHistoryReviewUi(selectedProblemText) {
    this._roomLoaded = true;
    this._roomDataReady = true;
    const summaryCount = (this.data.displayRoundSummaries || []).length;
    const cardCount = Math.max(1, summaryCount);
    this.setData({
      isHost: false,
      isCurrentPlayer: false,
      showSpecialMoveBtn: false,
      selectedProblemText: selectedProblemText || this.data.selectedProblemText || '',
      problemExpanded: false,
      problemTextOverflow: false,
      gamepagePhase: PHASE_PLAY,
      closingStep: CLOSING_STEP_RUNE,
      roundTimerVisible: false,
      roundTimerReady: false,
      partnerRoundStartedAt: null,
      avatarRoundStartedAt: null,
      cardIndex: 0,
      cardCount,
      showCurrentActionCard: false,
      paginationDots: buildPaginationDots(0, cardCount),
      indicatorPlayerIndex: summaryCount && this.data.displayRoundSummaries[0]
        ? this.data.displayRoundSummaries[0].playerIndex
        : 0,
      selectedPlayerIndex: summaryCount && this.data.displayRoundSummaries[0]
        ? this.data.displayRoundSummaries[0].playerIndex
        : 0
    }, () => {
      this._checkProblemTextOverflow();
    });
    this._refreshInspirationCount();
    if (!summaryCount) {
      wx.showToast({ title: '暂无纪要卡片', icon: 'none' });
    }
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

  _syncTimerFromStartedAt() {
    const { partnerRoundStartedAt, gamepagePhase } = this.data;
    if (isClosingPhase(gamepagePhase) || !partnerRoundStartedAt) {
      this._roundTimerRemainingSec = 0;
      this._roundTimerElapsedRatio = 0;
      return;
    }
    const timerState = getRoundTimerState(partnerRoundStartedAt);
    this._roundTimerElapsedRatio = timerState.elapsedRatio;
    this._roundTimerRemainingSec = timerState.remainingSec;
  },

  _restartRoundTimer() {
    this._stopRoundTimer();
    const { partnerRoundStartedAt, gamepagePhase } = this.data;
    if (isClosingPhase(gamepagePhase) || !partnerRoundStartedAt) return;

    const tick = () => {
      // 输入灵感时避免高频逻辑干扰
      if (
        this.data.inspirationInputFocused
        || this.data.inspirationHoldKeyboard
        || this._inspirationNativeFocused
      ) return;
      const startedAt = this.data.partnerRoundStartedAt;
      if (!startedAt) return;
      const timerState = getRoundTimerState(startedAt);
      // WXML 未绑定这两个字段；头像倒计时由组件 canvas 绘制，禁止 Page 级 250ms setData
      this._roundTimerElapsedRatio = timerState.elapsedRatio;
      this._roundTimerRemainingSec = timerState.remainingSec;
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
   * 倒计时到期后加速校准（优先 RoomSession.refresh，避免并行直打云函数）
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
        const session = this._boundRoomSession || getActiveRoomSession();
        let roomState = null;
        if (session && typeof session.refresh === 'function') {
          const snap = await session.refresh();
          roomState = snap && snap.ok && snap.raw && snap.raw.roomState
            ? snap.raw.roomState
            : null;
        } else {
          const res = await wx.cloud.callFunction({
            name: 'getAddPlayerData',
            data: { roomId: this.data.roomId }
          });
          roomState = ((res && res.result) || {}).roomState || null;
        }
        const next = roomState && roomState.partnerRoundStartedAt != null
          ? Number(roomState.partnerRoundStartedAt)
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

  _canEditPlayNotes() {
    return !!this.data.isHost || !!this.data.isCurrentPlayer;
  },

  _canEditDiscussionNotes() {
    return !!this.data.isHost;
  },

  _closingDeckImagePatch(blocks) {
    const list = blocks != null ? blocks : (this.data.closingCreativeBlocks || []);
    const first = list.find((b) => b && b.type === 'image' && b.url);
    return {
      closingHasDeckImage: !!first,
      closingDeckImageUrl: first ? first.url : ''
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
        roundTimerReady: false,
        roundTimerElapsedRatio: 0
      });
      this._avatarTimerTurnKey = '';
      this._stopRoundTimer();
      return;
    }

    // 已过期的服务端戳只清空，绝不点亮倒计时（避免进主流程立刻震动）
    if (!isRoundTimerActive(ts)) {
      if (isRoundTimerActive(this.data.partnerRoundStartedAt)) return;
      this.setData({
        partnerRoundStartedAt: null,
        roundTimerVisible: false,
        roundTimerReady: false,
        roundTimerElapsedRatio: 0
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
      roundTimerReady: true,
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
    if (this.data.isHistoryReview) return;
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
            this.setData({ isHost: true }, () => {
              this._maybeShowHostStatementTip();
            });
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
            // 只同步计时锚点，勿回写 phase，避免结束讨论后被旧态写回 discussion
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
    const hasAnchor = !!(partnerRoundStartedAt && !isClosingPhase(this.data.gamepagePhase));
    const visible = !!(this._pageVisible !== false && hasAnchor);
    const patch = {};
    if (visible !== this.data.roundTimerVisible) patch.roundTimerVisible = visible;
    if (hasAnchor !== this.data.roundTimerReady) patch.roundTimerReady = hasAnchor;
    if (Object.keys(patch).length) {
      this.setData(patch);
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

  _pickScoreProgressPatch(patch) {
    const narrow = {};
    if (!patch || typeof patch !== 'object') return narrow;
    if (patch.scoredCount != null) narrow.scoredCount = patch.scoredCount;
    if (patch.totalRequired != null) narrow.totalRequired = patch.totalRequired;
    if (Object.prototype.hasOwnProperty.call(patch, 'canStartStatement')) {
      narrow.canStartStatement = !!patch.canStartStatement;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'selectedScore')) {
      narrow.selectedScore = patch.selectedScore;
      narrow.selectedScoreText = patch.selectedScore != null
        ? formatScoreDisplay(patch.selectedScore)
        : '';
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'starRatingCollapsed')) {
      narrow.starRatingCollapsed = !!patch.starRatingCollapsed;
    }
    if (patch.scoreTurnKey != null) narrow.scoreTurnKey = patch.scoreTurnKey;
    return narrow;
  },

  _decorateTurnRecords(records, members) {
    const list = Array.isArray(records) ? records : [];
    const memberList = Array.isArray(members) && members.length
      ? members
      : (this.data.members || []);
    return list.map((turn) => {
      if (!turn || typeof turn !== 'object') return turn;
      const idx = turn.playerIndex;
      const member = memberList.find((m) => m && Number(m.playerIndex) === Number(idx));
      const playerLabel = turn.playerName
        || (member && (member.nickName || member.playerName))
        || (idx != null ? `玩家${idx}` : '玩家');
      const avg = turn.avgScore != null ? Number(turn.avgScore) : null;
      return {
        ...turn,
        playerLabel,
        avgScoreText: Number.isFinite(avg) ? formatScoreDisplay(avg) : ''
      };
    });
  },

  _scoreFields(score) {
    const normalized = score == null ? null : normalizeHalfStarScore(score);
    return {
      selectedScore: normalized,
      selectedScoreText: formatScoreDisplay(normalized)
    };
  },

  _applyScoreProgressPatch(patch) {
    if (this._isLocalInputGuarding()) return;
    const narrow = this._pickScoreProgressPatch(patch);
    if (!Object.keys(narrow).length) return;
    const scoreFingerprint = [
      narrow.scoredCount != null ? narrow.scoredCount : '',
      narrow.totalRequired != null ? narrow.totalRequired : '',
      narrow.canStartStatement ? 1 : 0,
      narrow.selectedScore != null ? narrow.selectedScore : '',
      narrow.scoreTurnKey || ''
    ].join('#');
    if (scoreFingerprint === this._scoreFingerprint) return;
    this._scoreFingerprint = scoreFingerprint;
    this.setData(narrow);
  },

  _markScoreUiBusy() {
    this._scoreUiBusy = true;
    if (this._scoreUiBusyTimer) {
      clearTimeout(this._scoreUiBusyTimer);
      this._scoreUiBusyTimer = null;
    }
    if (!this.data.scoreSwipeLocked) {
      this.setData({ scoreSwipeLocked: true });
    }
  },

  _releaseScoreUiBusy(delayMs) {
    const delay = delayMs != null ? delayMs : 360;
    if (this._scoreUiBusyTimer) clearTimeout(this._scoreUiBusyTimer);
    this._scoreUiBusyTimer = setTimeout(() => {
      this._scoreUiBusyTimer = null;
      this._scoreUiBusy = false;
      if (this.data.scoreSwipeLocked) {
        this.setData({ scoreSwipeLocked: false });
      }
      this._flushPendingRoomContextIfIdle();
    }, delay);
  },

  _flushPendingRoomContextIfIdle() {
    if (this._cardSwipeBusy || this._scoreUiBusy) return;
    if (this._isLocalInputGuarding()) return;
    if (!this._pendingRoomContext) return;
    const pending = this._pendingRoomContext;
    this._pendingRoomContext = null;
    this._applyRoomContext(pending.result, pending.options || {});
  },

  /** 本地输入法打开时禁止轮询 setData，否则真机约 1 秒后键盘被整页重绘打掉 */
  _isLocalInputGuarding() {
    return !!(
      this._closingNativeFocused
      || this.data.closingCreativeEditFocus
      || this.data.closingCreativeSaving
      || this.data.expressComposerOpen
      || this.data.expressSending
      || this._inspirationNativeFocused
      || this.data.inspirationInputFocused
      || this.data.inspirationHoldKeyboard
    );
  },

  _hydrateCloudRoundMedia(roundContent, displaySummaries, closingBlocks) {
    const token = (this._cloudMediaToken || 0) + 1;
    this._cloudMediaToken = token;
    const summaries = Array.isArray(displaySummaries) ? displaySummaries : [];
    const closing = Array.isArray(closingBlocks) ? closingBlocks : [];
    Promise.all([
      resolveRoundContentMedia(roundContent || {}),
      Promise.all(summaries.map((item) => resolveRoundContentMedia(item || {}))),
      closing.length
        ? resolveRoundContentMedia({ playBlocks: closing })
        : Promise.resolve(null)
    ]).then(([content, resolvedSummaries, closingResolved]) => {
      if (this._cloudMediaToken !== token || this._pageVisible === false) return;
      const mediaPatch = {
        playImages: content.playImages,
        discussionImages: content.discussionImages,
        playBlocks: content.playBlocks,
        discussionBlocks: content.discussionBlocks
      };
      if (resolvedSummaries.length) {
        const current = this.data.displayRoundSummaries || [];
        mediaPatch.displayRoundSummaries = current.map((row, i) => {
          const next = resolvedSummaries[i];
          if (!next) return row;
          const note = next.privateNote || row.privateNote || {};
          return {
            ...row,
            playImages: next.playImages,
            discussionImages: next.discussionImages,
            playBlocks: next.playBlocks,
            discussionBlocks: next.discussionBlocks,
            privateNote: note
          };
        });
      }
      if (closingResolved && closingResolved.playBlocks) {
        mediaPatch.closingCreativeBlocks = closingResolved.playBlocks;
        Object.assign(mediaPatch, this._closingDeckImagePatch(closingResolved.playBlocks));
      }
      this.setData(mediaPatch);
    }).catch((e) => console.warn('_hydrateCloudRoundMedia', e));
  },

  _refreshCloudAvatarsIfNeeded(rawMembers, displayMembers) {
    const list = Array.isArray(rawMembers) ? rawMembers : [];
    if (!list.some(memberHasCloudAvatar)) return;
    if (this._cloudAvatarResolving) return;
    const shown = Array.isArray(displayMembers) && displayMembers.length
      ? displayMembers
      : (this.data.members || []);
    const stillBroken = list.some((m) => {
      if (!memberHasCloudAvatar(m)) return false;
      const current = shown.find((row) => row && String(row.playerIndex) === String(m.playerIndex));
      const img = current && (current.avatarImage || current.avatarUrl);
      return !img || String(img).startsWith('cloud://') || String(img).startsWith('/assets/');
    });
    if (!stillBroken) return;
    this._cloudAvatarResolving = true;
    prepareMembersForDisplay(list)
      .then((prepared) => {
        this._cloudAvatarResolving = false;
        if (this._pageVisible === false) return;
        if (!prepared || !prepared.length) return;
        const members = preserveMemberAvatars(prepared, this.data.members);
        const fp = members
          .map((m) => `${m.userId || m.playerIndex}:${getMemberAvatarFingerprint(m)}`)
          .join('|');
        if (fp && fp === this._avatarOnlyFingerprint) return;
        this._avatarOnlyFingerprint = fp;
        const roomPhase = this.data.gamepagePhase;
        const avatarList = isClosingPhase(roomPhase)
          ? buildPartnerAvatarList(members, this.data.closingQuestionPlayers)
          : buildPartnerAvatarList(members);
        this.setData({ members, avatarList });
      })
      .catch(() => {
        this._cloudAvatarResolving = false;
      });
  },

  _applyRoomContext(result, options = {}) {
    // 滑动/打分交互中勿整页 setData 改写 controlled swiper，否则会顶飞手势并左右晃动
    if ((this._cardSwipeBusy || this._scoreUiBusy) && !options.force && !options.resetTurnUi) {
      this._pendingRoomContext = { result, options };
      return {
        playerChanged: false,
        phaseChanged: false,
        roundChanged: false,
        members: this.data.members,
        player: {
          currentPlayerIndex: this.data.currentPlayerIndex,
          currentPlayerName: this.data.currentPlayerName,
          isCurrentPlayer: this.data.isCurrentPlayer
        },
        roomPhase: this.data.gamepagePhase
      };
    }

    const members = preserveMemberAvatars(
      assignAvatarImages(result.members || this.data.members || []),
      this.data.members
    );
    this._avatarOnlyFingerprint = members
      .map((m) => `${m.userId || m.playerIndex}:${getMemberAvatarFingerprint(m)}`)
      .join('|');
    this._refreshCloudAvatarsIfNeeded(result.members || members, members);
    const roomState = result.roomState || {};
    const player = resolveCurrentPlayerFromRoom(
      members,
      roomState,
      options.fallbackPlayerIndex != null
        ? options.fallbackPlayerIndex
        : this.data.currentPlayerIndex
    );
    let roomPhase = normalizePartnerGamePhase(
      roomState.partnerGamePhase || this.data.gamepagePhase
    );
    if (
      (this.data.statementSwitching || this._startingStatement
        || this.data.discussionSwitching || this._endingDiscussion)
      && !isDiscussionPhase(roomPhase)
      && !isClosingPhase(roomPhase)
    ) {
      roomPhase = this.data.gamepagePhase;
    }
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
    // 服务端 partnerRoundSummaries 缺失时可短暂兜底，但新会话必须清缓存，防止旧纪要串入新局
    if (sessionChanged && !Array.isArray(roomState.partnerRoundSummaries)) {
      this._lastRawRoundSummaries = [];
    }
    if (Array.isArray(roomState.partnerRoundSummaries)) {
      this._lastRawRoundSummaries = roomState.partnerRoundSummaries;
    }
    const rawRoundSummaries = Array.isArray(roomState.partnerRoundSummaries)
      ? roomState.partnerRoundSummaries
      : (sessionChanged ? [] : (this._lastRawRoundSummaries || []));
    let normalizedRawRoundSummaries = Array.isArray(rawRoundSummaries) ? rawRoundSummaries : [];
    // 新局首回合保护：第1轮玩家1出牌时不应出现任何历史纪要，强制忽略旧缓存/旧会话残留
    if (
      !this.data.isHistoryReview
      && normalizePartnerGamePhase(roomPhase) === PHASE_PLAY
      && Number(currentRound) === 1
      && Number(player.currentPlayerIndex) === 1
      && normalizedRawRoundSummaries.length > 0
    ) {
      normalizedRawRoundSummaries = [];
      this._lastRawRoundSummaries = [];
    }
    const roundSummaries = normalizedRawRoundSummaries
      .slice()
      .sort((a, b) => {
        const rd = (a.round || 0) - (b.round || 0);
        if (rd !== 0) return rd;
        return (a.archivedAt || 0) - (b.archivedAt || 0);
      })
      // 只展示“已结束轮次”的纪要：当前轮进行中，不应出现当前/未来轮纪要卡
      .filter((item) => {
        const rd = Number(item && item.round);
        if (!Number.isFinite(rd) || rd <= 0 || rd >= Number(currentRound || 1)) return false;
        // 选定首位玩家时可能误归档一张空纪要：无任何内容则不展示
        const has = (arr) => Array.isArray(arr) && arr.length > 0;
        return has(item.playHistory)
          || has(item.discussionNotes)
          || has(item.playImages)
          || has(item.discussionImages)
          || has(item.playBlocks)
          || has(item.discussionBlocks)
          || has(item.voiceLines)
          || has(item.turnRecords);
      })
      .map((item) => {
        const lists = this._buildExpressListsForRound(expressMessages, item.round, currentRound);
        return {
          ...item,
          voiceLines: Array.isArray(item.voiceLines) ? item.voiceLines : [],
          turnRecords: this._decorateTurnRecords(
            Array.isArray(item.turnRecords) ? item.turnRecords : [],
            members
          ),
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
    if (sessionChanged) {
      this._seenExpressIds = {};
      this._expressReady = false;
      this._expressMessagesAll = Array.isArray(expressMessages) ? expressMessages : [];
      // 重新播种已见 id，避免 toast 风暴；列表按新 session 过滤后自然为空
      (this._expressMessagesAll || []).forEach((msg) => {
        if (msg && msg.id) this._seenExpressIds[msg.id] = true;
      });
      this._expressReady = true;
    }
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
        const timerState = getRoundTimerState(partnerRoundStartedAt);
        return {
          roundTimerReady: true,
          roundTimerElapsedRatio: timerState.elapsedRatio,
          roundTimerRemainingSec: timerState.remainingSec
        };
      })()
      : { roundTimerReady: false, roundTimerElapsedRatio: 0 };
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
      selectedPlayerIndex: paginationState.selectedPlayerIndex,
      indicatorPlayerIndex: paginationState.indicatorPlayerIndex,
      isPlayerFilterActive: paginationState.isPlayerFilterActive
    };
    // 仅在回合/会话重置时回写 cardIndex；日常轮询不得改写，否则 controlled swiper 与手势互抢
    const shouldSyncCardIndex = !!(
      roundChanged
      || sessionChanged
      || options.resetTurnUi
      || closingStepChanged
      || (phaseChanged && isClosingPhase(roomPhase))
    );
    if (shouldSyncCardIndex) {
      patch.cardIndex = paginationState.cardIndex;
      patch.paginationDots = paginationState.paginationDots;
    } else if (paginationState.cardCount !== this.data.cardCount) {
      patch.paginationDots = buildPaginationDots(
        this.data.cardIndex,
        paginationState.cardCount
      );
    }

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
      patch.partnerRoundStartedAt = (serverTs > 0 && isRoundTimerActive(serverTs))
        ? serverTs
        : null;
    }

    // 换人但服务端仍返回同一计时戳：视为脏半程，丢弃并待进页重开
    if (playerChanged || options.resetTurnUi) {
      const prevTs = Number(this.data.partnerRoundStartedAt) || 0;
      const nextTs = Number(
        patch.partnerRoundStartedAt != null
          ? patch.partnerRoundStartedAt
          : partnerRoundStartedAt
      ) || 0;
      if (nextTs > 0 && prevTs > 0 && nextTs === prevTs) {
        patch.partnerRoundStartedAt = null;
        patch.roundTimerElapsedRatio = 0;
        patch.roundTimerVisible = false;
        patch.roundTimerReady = false;
      }
    }

    if (playerChanged || phaseChanged || roundChanged || sessionChanged || options.resetTurnUi) {
      patch.selectedScore = null;
      patch.selectedScoreText = '';
      patch.canStartStatement = false;
      patch.scoredCount = 0;
      patch.scoreTurnKey = `turn_r${currentRound}_s${player.currentPlayerIndex}`;
      this._scoreProgressFromSnapshot = false;
      this._starRatingPinnedOpen = false;
      this._scoreSubmitting = false;
      this._lastSubmittedScore = null;
      patch.starRatingCollapsed = false;
      patch.scoreSubmitting = false;
      patch.scorePanelExpanded = false;
      patch.scoreSheetTranslateY = this.data.scoreSheetMaxTranslateY || 120;
      patch.scoreSheetVisiblePx = this.data.scoreSheetCollapsedPx || 72;
      patch.scoreSheetAnimating = false;
      this._scoreSheetMeasuredOk = false;
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

    // 打分进度：以 getAddPlayerData 已过滤的 scoredCount/totalRequired 为准。
    // 换人/换轮先清零，避免进页瞬间沿用上一回合满分。
    const scoreTurnKey = `turn_r${currentRound}_s${player.currentPlayerIndex}`;
    const turnScoreReset = !!(playerChanged || roundChanged || sessionChanged || options.resetTurnUi);
    if (turnScoreReset) {
      patch.scoredCount = 0;
      patch.canStartStatement = false;
      patch.scoreTurnKey = scoreTurnKey;
      this._scoreProgressFromSnapshot = false;
    }
    if (roomState.scoredCount != null || roomState.totalRequired != null
      || (roomState.progress && roomState.progress.scoredCount != null)) {
      const progress = roomState.progress || null;
      const progressTurnId = progress && progress.turnId ? String(progress.turnId) : '';
      // 必须 turnId 精确匹配；缺 turnId 的旧数据不可信
      const progressFresh = progressTurnId === scoreTurnKey;
      const fromMembers = Math.max(0, members.length - 1);
      let nextScored = 0;
      let nextRequired = fromMembers;
      if (progressFresh) {
        nextScored = roomState.scoredCount != null
          ? Number(roomState.scoredCount) || 0
          : (progress && progress.scoredCount != null ? Number(progress.scoredCount) || 0 : 0);
        const fromProgress = progress && progress.requiredScoreCount != null
          ? Number(progress.requiredScoreCount) || 0
          : 0;
        const fromRoom = roomState.totalRequired != null ? Number(roomState.totalRequired) || 0 : 0;
        nextRequired = Math.max(fromMembers, fromProgress, fromRoom);
      } else if (!turnScoreReset && roomState.scoredCount != null && roomState.totalRequired != null
        && !progressTurnId) {
        // 兼容无 turnId 的极旧快照：仅同回合轮询沿用顶层计数，换轮不用
        nextScored = Number(roomState.scoredCount) || 0;
        nextRequired = Math.max(fromMembers, Number(roomState.totalRequired) || 0);
      }
      patch.scoredCount = nextScored;
      patch.totalRequired = nextRequired;
      patch.scoreTurnKey = scoreTurnKey;
      // 用服务端 myScore 同步「已打分/未打分」；乐观提交中勿被 null 快照打回未打分
      if (Object.prototype.hasOwnProperty.call(roomState, 'myScore')) {
        if (roomState.myScore != null) {
          const restored = normalizeHalfStarScore(roomState.myScore);
          patch.selectedScore = restored;
          patch.selectedScoreText = formatScoreDisplay(restored);
          this._pendingScore = null;
          this._lastSubmittedScore = restored;
          if (!this._starRatingPinnedOpen && !this._scoreSubmitting) {
            patch.starRatingCollapsed = true;
          }
        } else if (this._pendingScore == null && !this.data.starRatingGesturing) {
          // 无本地待提交分时，才接受服务端「未打分」
          patch.selectedScore = null;
          patch.selectedScoreText = '';
          if (!this._starRatingPinnedOpen) {
            patch.starRatingCollapsed = false;
          }
        }
      }
      const phaseForScore = roomPhase || this.data.gamepagePhase;
      const hostFlag = patch.isHost != null ? patch.isHost : this.data.isHost;
      const iAmEligible = !player.isCurrentPlayer;
      const iHaveScored = patch.selectedScore != null;
      // 脏数据自救：本人是合格打分者却仍「未打分」，进度不可能已满
      if (iAmEligible && !iHaveScored && nextRequired > 0 && nextScored >= nextRequired) {
        nextScored = Math.max(0, nextRequired - 1);
        patch.scoredCount = nextScored;
      }
      patch.canStartStatement = hostFlag
        && !isDiscussionPhase(phaseForScore)
        && !isClosingPhase(phaseForScore)
        && nextRequired > 0
        && nextScored >= nextRequired;
      this._scoreProgressFromSnapshot = progressFresh;
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
      const closingCreative = limitImageBlocks(normalizeContentBlocks(
        roomState.partnerClosingCreativePoints
          && roomState.partnerClosingCreativePoints.blocks,
        roomState.partnerClosingCreativePoints
          && roomState.partnerClosingCreativePoints.texts,
        roomState.partnerClosingCreativePoints
          && roomState.partnerClosingCreativePoints.images
      ), 1);
      // 非房主始终同步只读内容；房主编辑/保存中不打断本地输入
      const hostEditingClosing = this.data.isHost
        && (this._closingNativeFocused
          || this.data.closingCreativeEditFocus
          || this.data.closingCreativeSaving
          || !!this.data.closingCreativeEditingKey);
      if (!hostEditingClosing) {
        patch.closingCreativeBlocks = closingCreative;
        Object.assign(patch, this._closingDeckImagePatch(closingCreative));
      }
    } else if (phaseChanged) {
      patch.closingReviewRounds = [];
      patch.closingCreativeBlocks = [];
      patch.closingHasDeckImage = false;
      patch.closingDeckImageUrl = '';
      patch.closingCreativeEditText = '';
      patch.closingCreativeEditFocus = false;
      patch.closingCreativeWantFocus = false;
      patch.closingCreativeEditingKey = '';
      patch.closingImageDeleteKey = '';
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
      // 内容指纹：忽略临时链 query，避免每轮签名变化触发整页 setData（打坏横向头像）
      (roundContent.playHistory || []).join('\u0001'),
      (roundContent.discussionNotes || []).join('\u0001'),
      (roundContent.playImages || []).map((u) => getAvatarStableKey(u)).join('|'),
      (roundContent.discussionImages || []).map((u) => getAvatarStableKey(u)).join('|'),
      (roundContent.playBlocks || []).map((b) => `${b.type}:${b.text || getAvatarStableKey(b.url) || ''}`).join('\u0001'),
      (roundContent.discussionBlocks || []).map((b) => `${b.type}:${b.text || getAvatarStableKey(b.url) || ''}`).join('\u0001'),
      ((roomState.partnerClosingCreativePoints
        && roomState.partnerClosingCreativePoints.blocks) || [])
        .map((b) => `${b.type}:${b.text || getAvatarStableKey(b.url) || ''}`).join('\u0001'),
      lastExpressId,
      // 不含 cardIndex：用户滑动不应因指纹变化触发整页 setData
      paginationState.cardCount,
      !!patch.specialMoveUsedThisTurn,
      // 评分进度单独窄更新，勿并入整页指纹（否则会重建 swiper 导致横跳）
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
    if (this._isLocalInputGuarding() && !forcePatch) {
      this._pendingRoomContext = { result, options };
      return { playerChanged, phaseChanged, roundChanged, members, player, roomPhase };
    }
    if (!forcePatch && contextFingerprint === this._roomContextFingerprint) {
      // 仅评分进度变化：窄 setData，不动 displayRoundSummaries / cardIndex
      this._applyScoreProgressPatch(patch);
      return { playerChanged, phaseChanged, roundChanged, members, player, roomPhase };
    }
    this._roomContextFingerprint = contextFingerprint;
    // 整页补丁会带上评分字段，同步指纹避免紧接着再窄刷一次
    this._scoreFingerprint = [
      patch.scoredCount != null ? patch.scoredCount : '',
      patch.totalRequired != null ? patch.totalRequired : '',
      patch.canStartStatement ? 1 : 0,
      Object.prototype.hasOwnProperty.call(patch, 'selectedScore')
        ? (patch.selectedScore != null ? patch.selectedScore : '')
        : '',
      patch.scoreTurnKey || ''
    ].join('#');

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
      this._hydrateCloudRoundMedia(
        roundContent,
        patch.displayRoundSummaries,
        patch.closingCreativeBlocks
      );
      if (this.data.isHistoryReview) return;
      this._persistHistoryReviewSnapshot(false);
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
      } else if (
        (playerChanged || roundChanged || sessionChanged || options.resetTurnUi)
        && this.data.isHost
        && !patch.partnerRoundStartedAt
      ) {
        // 换人后服务端半程戳已丢弃：房主立即开新一轮计时
        this._ensureSharedRoundTimerOnEnter();
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
    const isHistoryReview = this.data.isHistoryReview || this._isHistoryReview;
    let result = null;

    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId, full: true }
      });
      result = (res && res.result) || {};
    } catch (e) {
      console.error('partner gamepage loadRoomData', e);
      result = null;
    }

    if (!result || result.ok !== true || !result.members || !result.members.length) {
      if (isHistoryReview) {
        const snap = getReviewSnapshot(roomId);
        const fake = this._buildFakeRoomResultFromSnapshot(snap);
        if (fake) {
          const app = getApp();
          const selectedProblem = resolveSelectedDesignProblem(app, fake)
            || (snap && snap.selectedDesignProblem)
            || null;
          const selectedProblemText = (selectedProblem && selectedProblem.text)
            || (snap && snap.selectedProblemText)
            || '';
          if (selectedProblem && app.globalData) {
            app.globalData.selectedProblem = {
              id: selectedProblem.id || '',
              text: selectedProblem.text
            };
          }
          this._applyRoomContext(fake, {
            fallbackPlayerIndex: 0,
            resetTurnUi: true
          });
          this._finalizeHistoryReviewUi(selectedProblemText);
          return;
        }
        const meta = getHistoryWorkshopByRoomId(roomId);
        wx.showToast({
          title: (result && result.errMsg) || (meta ? '暂无纪要快照' : '加载失败'),
          icon: 'none'
        });
        return;
      }
      wx.showToast({ title: (result && result.errMsg) || '加载失败', icon: 'none' });
      return;
    }

    try {
      const app = getApp();
      const selectedProblem = resolveSelectedDesignProblem(app, result);
      const selectedProblemText = selectedProblem && selectedProblem.text
        ? selectedProblem.text
        : '';

      this._applyRoomContext(result, {
        fallbackPlayerIndex: this.data.currentPlayerIndex,
        resetTurnUi: true
      });

      if (isHistoryReview) {
        this._lastHistorySnapshotAt = 0;
        try {
          const snapshot = buildReviewSnapshot({
            selectedProblemText,
            selectedDesignProblem: selectedProblem || { text: selectedProblemText },
            members: result.members,
            roundSummaries: this.data.roundSummaries,
            expressMessages: this._expressMessagesAll || [],
            currentRound: this.data.currentRound,
            brainstormSessionSeq: this.data.brainstormSessionSeq,
            currentPlayerIndex: this.data.currentPlayerIndex,
            isMasterMode: this.data.isMasterMode,
            workshopName: (app.globalData && app.globalData.workshopName) || ''
          });
          saveReviewSnapshot(roomId, snapshot, {
            name: snapshot.workshopName
          });
        } catch (e) {
          console.warn('history review refresh snapshot', e);
        }
        this._finalizeHistoryReviewUi(selectedProblemText);
        return;
      }

      this.setData({
        isHost: result.isHost === true,
        selectedProblemText,
        problemExpanded: false,
        problemTextOverflow: false
      }, () => {
        this._checkProblemTextOverflow();
        this._maybeShowHostStatementTip();
      });

      this._persistHistoryReviewSnapshot(true);

      this._startStatePolling();
      this.refreshScoreStatus();
      this._startScorePolling();
      this._roomLoaded = true;
      await this._ensureSharedRoundTimerOnEnter();
      await this._syncRoundSpeech();
      await this._syncRoundContentToRoom();
      await this._refreshInspirationCount();
      this._roomDataReady = true;
      this.refreshScoreStatus();
    } catch (e) {
      console.error('partner gamepage loadRoomData apply', e);
      if (isHistoryReview) {
        const snap = getReviewSnapshot(roomId);
        const fake = this._buildFakeRoomResultFromSnapshot(snap);
        if (fake) {
          this._applyRoomContext(fake, { fallbackPlayerIndex: 0, resetTurnUi: true });
          this._finalizeHistoryReviewUi((snap && snap.selectedProblemText) || '');
          return;
        }
      }
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async refreshScoreStatus() {
    if (this._isLocalInputGuarding()) return;
    const {
      isHost,
      gamepagePhase,
      roomId,
      members,
      currentPlayerIndex,
      currentRound,
      scoreTurnKey
    } = this.data;
    if (!roomId || isClosingPhase(gamepagePhase)) return;

    const expectedKey = `turn_r${currentRound != null ? currentRound : 1}_s${currentPlayerIndex != null ? currentPlayerIndex : 0}`;
    const membersRequired = Math.max(0, (members || []).length - 1);

    // 本地回合 key 对不上：先清 UI，再拉房间权威进度
    if (!scoreTurnKey || scoreTurnKey !== expectedKey) {
      this._scoreProgressFromSnapshot = false;
      this.setData({
        scoredCount: 0,
        totalRequired: Math.max(Number(this.data.totalRequired) || 0, membersRequired),
        canStartStatement: false,
        scoreTurnKey: expectedKey
      });
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'getGameScoreStatus',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) return;

      // 房间权威座位/轮次必须与当前页一致；不一致说明页状态落后或超前，丢弃，避免脏亮按钮
      if (
        result.currentPlayerIndex != null
        && Number(result.currentPlayerIndex) !== Number(this.data.currentPlayerIndex)
      ) {
        return;
      }
      if (
        result.currentRound != null
        && Number(result.currentRound) !== Number(this.data.currentRound)
      ) {
        return;
      }

      let nextScored = Number(result.scoredCount) || 0;
      const nextRequired = Math.max(
        result.totalRequired != null ? Number(result.totalRequired) || 0 : 0,
        membersRequired
      );
      const myScore = Object.prototype.hasOwnProperty.call(result, 'myScore')
        ? (result.myScore != null ? normalizeHalfStarScore(result.myScore) : null)
        : this.data.selectedScore;
      // 乐观打分未落地前，不要用 null myScore 盖掉本地已选分
      const effectiveMyScore = (myScore == null && this._pendingScore != null)
        ? this._pendingScore
        : myScore;
      if (myScore != null) this._pendingScore = null;
      // 本人是非出牌玩家且未打分时，进度不得显示已满（脏数据自救）
      if (!this.data.isCurrentPlayer && effectiveMyScore == null && nextRequired > 0 && nextScored >= nextRequired) {
        nextScored = Math.max(0, nextRequired - 1);
      }
      const canStartStatement = isHost
        && !isDiscussionPhase(gamepagePhase)
        && !isClosingPhase(gamepagePhase)
        && nextRequired > 0
        && nextScored >= nextRequired;
      this._scoreProgressFromSnapshot = true;
      const patch = {
        scoredCount: nextScored,
        totalRequired: nextRequired,
        canStartStatement,
        scoreTurnKey: expectedKey
      };
      if (Object.prototype.hasOwnProperty.call(result, 'myScore')) {
        if (
          !this.data.starRatingGesturing
          && (myScore != null || this._pendingScore == null)
        ) {
          Object.assign(patch, this._scoreFields(effectiveMyScore));
          if (effectiveMyScore != null && !this._starRatingPinnedOpen && !this._scoreSubmitting) {
            patch.starRatingCollapsed = true;
          }
        }
      }
      this.setData(patch);
    } catch (e) {
      console.warn('refreshScoreStatus', e);
    }
  },

  _startScorePolling() {
    this._stopScorePolling();
    if (this.data.isHistoryReview) return;
    // 进度未达标时始终轮询；达标后再靠快照即可
    this._scorePollTimer = setInterval(() => {
      if (!this._roomDataReady) return;
      if (this._isLocalInputGuarding()) return;
      const membersRequired = Math.max(0, (this.data.members || []).length - 1);
      const req = Math.max(Number(this.data.totalRequired) || 0, membersRequired);
      if (
        this._scoreProgressFromSnapshot
        && req > 0
        && this.data.scoredCount >= req
      ) {
        this._stopScorePolling();
        return;
      }
      this.refreshScoreStatus();
    }, 2000);
  },

  _stopScorePolling() {
    if (this._scorePollTimer) {
      clearInterval(this._scorePollTimer);
      this._scorePollTimer = null;
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    if (this.data.isHistoryReview) return;
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    // emitCurrent:false —— 首屏由 loadRoomData 负责；禁止订阅瞬间同步 setData
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || '',
      intervalMs: 800,
      full: true,
      emitCurrent: false,
      followNavigation: !this.data.isHistoryReview,
      beforeNavigate(pollResult, page) {
        // 已离开本页（灵感空间等叠层）：不要把隐藏页的跟随订阅打回 gamepage
        if (this._pageVisible === false) return true;
        const state = pollResult.roomState || {};
        if (page === 'closingstatement') {
          safeOpenUrl(buildClosingStatementUrl(roomId, {
            closingVoteSessionId: state.closingVoteSessionId || '',
            _t: Date.now()
          }), { immediate: true });
          return true;
        }
        if (page === 'closingend' || page === 'leaderboard') {
          // 结束脑暴后直接进排行榜，不再停在 closingEnd 过渡页
          safeOpenUrl(buildLeaderboardUrl(roomId, {
            from: 'closingEnd',
            isSubScreen: true
          }), { immediate: true });
          return true;
        }
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
          // 快照 progress 未达标时继续轮询 roomScores，避免「已打分但开始表态不亮」
          const membersRequired = Math.max(0, (this.data.members || []).length - 1);
          const scoreReq = Math.max(Number(this.data.totalRequired) || 0, membersRequired);
          if (
            this._scoreProgressFromSnapshot
            && scoreReq > 0
            && this.data.scoredCount >= scoreReq
          ) {
            this._stopScorePolling();
          } else if (!this._scorePollTimer) {
            this._startScorePolling();
          }
          return true;
        }
        if (page === 'statement') {
          if (this._suppressStatementFollowUntil && Date.now() < this._suppressStatementFollowUntil) {
            return true;
          }
          if (!isDiscussionPhase(this.data.gamepagePhase)) {
            this.setData({ gamepagePhase: PHASE_DISCUSSION });
          }
          return true;
        }
        return false;
      }
    }).catch((e) => console.warn('partner gamepage roomSession', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
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
      if (extra && extra.archiveTurn === true) {
        data.archiveTurn = true;
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
      if (extra && extra.skipArchive === true) {
        data.skipArchive = true;
      }
      const res = await wx.cloud.callFunction({ name: 'updateRoomState', data });
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('updateRoomState', e);
      return false;
    }
  },

  /**
   * Partner 流程命令：优先 roomCommand；revision 冲突重试一次；失败回退 updateRoomState。
   */
  async _dispatchPartnerCommand(type, payload) {
    const roomId = this.data.roomId || '';
    if (!roomId || !type) return { ok: false, errMsg: '缺少房间或命令' };
    const session = this._boundRoomSession || getActiveRoomSession();
    const build = () => {
      const expectedRevision = session && typeof session.getAppliedRevision === 'function'
        ? Number(session.getAppliedRevision())
        : 0;
      return {
        protocolVersion: 2,
        commandId: `pg_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        roomId,
        expectedRevision,
        payload: payload || {},
        clientSentAt: Date.now()
      };
    };
    const run = async () => {
      const command = build();
      if (session && typeof session.dispatch === 'function') {
        return session.dispatch(command);
      }
      const res = await wx.cloud.callFunction({ name: 'roomCommand', data: command });
      return (res && res.result) || { ok: false };
    };
    try {
      let result = await run();
      if (!result.ok && result.errCode === 'REVISION_CONFLICT' && session && typeof session.refresh === 'function') {
        await session.refresh();
        result = await run();
      }
      return result || { ok: false };
    } catch (e) {
      console.warn('partner roomCommand', type, e);
      return { ok: false, errMsg: (e && e.errMsg) || (e && e.message) || '命令失败' };
    }
  },

  onCardSwiperTransition() {
    this._cardSwipeBusy = true;
  },

  onCardSwiperAnimationFinish() {
    if (this._cardSwipeBusyTimer) {
      clearTimeout(this._cardSwipeBusyTimer);
      this._cardSwipeBusyTimer = null;
    }
    this._cardSwipeBusy = false;
    this._flushPendingRoomContextIfIdle();
  },

  onCardSwiperChange(e) {
    const source = e.detail && e.detail.source;
    if (source === 'touch') {
      this._cardSwipeBusy = true;
    }
    const index = e.detail && e.detail.current != null ? e.detail.current : 0;
    const maxIndex = Math.max(0, (this.data.cardCount || 1) - 1);
    const cardIndex = Math.min(index, maxIndex);
    this.setData({
      cardIndex,
      paginationDots: buildPaginationDots(cardIndex, this.data.cardCount),
      indicatorPlayerIndex: this._resolveIndicatorPlayerIndex(cardIndex)
    });
    // 历史纪要卡自带 play/discussionExpressChatList；页面级列表始终对应当前轮，
    // 切卡时不得改写，否则滑动预览当前卡会短暂串出上一轮聊天记录。
    // 部分基础库无 animationfinish：短延迟后释放锁并冲刷排队的房间补丁
    if (source === 'touch') {
      if (this._cardSwipeBusyTimer) clearTimeout(this._cardSwipeBusyTimer);
      this._cardSwipeBusyTimer = setTimeout(() => {
        this._cardSwipeBusyTimer = null;
        if (!this._cardSwipeBusy) return;
        this.onCardSwiperAnimationFinish();
      }, 420);
    }
  },

  handleAvatarFilterToggle() {
    if (isClosingPhase(this.data.gamepagePhase) || this.data.isHistoryReview) return;
    if (this.data.isPlayerFilterActive) {
      this._clearPlayerAvatarFilter();
      return;
    }
    wx.showToast({ title: '请点击头像查看该玩家纪要', icon: 'none' });
  },

  _resolveCardIndexAfterClearFilter() {
    const {
      cardIndex,
      displayRoundSummaries,
      showCurrentActionCard,
      roundSummaries,
      members
    } = this.data;
    const filteredSummaries = displayRoundSummaries || [];
    const fullSummaries = buildDisplaySummaries(
      roundSummaries,
      members,
      null,
      false
    );
    const onActionCard = !!showCurrentActionCard && cardIndex >= filteredSummaries.length;
    if (onActionCard) {
      return fullSummaries.length;
    }
    const current = filteredSummaries[cardIndex];
    if (!current || current.round == null) {
      return fullSummaries.length;
    }
    const idx = fullSummaries.findIndex(
      (item) => item && parseInt(item.round, 10) === parseInt(current.round, 10)
    );
    return idx >= 0 ? idx : fullSummaries.length;
  },

  _clearPlayerAvatarFilter() {
    const {
      members,
      roundSummaries,
      currentPlayerIndex
    } = this.data;
    const preferredCardIndex = this._resolveCardIndexAfterClearFilter();
    this._playerFilterIndex = null;
    const cardState = this._buildDisplayCardState({
      roundSummaries,
      members,
      filteredPlayerIndex: null,
      isPlayerFilterActive: false,
      currentPlayerIndex,
      preferredCardIndex
    });
    this.setData({
      filteredPlayerIndex: null,
      isPlayerFilterActive: false,
      cardIndexBeforeFilter: 0,
      ...cardState
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
      cardIndex
    } = this.data;
    const memberCount = (members || []).length;
    const activeFilter = this._resolveActivePlayerFilter();

    if (isPlayerFilterActive && isSamePlayerIndex(activeFilter, playerIndex)) {
      this._clearPlayerAvatarFilter();
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
    return Math.max(collapsedPx, collapsedPx + (maxY - y));
  },

  _measureScoreSheetHeights(done, retry) {
    const attempt = retry || 0;
    const query = wx.createSelectorQuery().in(this);
    query.select('.score-sheet').boundingClientRect();
    query.select('.score-sheet-handle-wrap').boundingClientRect();
    query.select('.score-sheet-head').boundingClientRect();
    query.select('.score-buttons').boundingClientRect();
    query.exec((rects) => {
      const sheet = rects && rects[0];
      const handle = rects && rects[1];
      const head = rects && rects[2];
      const buttons = rects && rects[3];
      if (!sheet || !sheet.height) {
        if (attempt < 5) {
          setTimeout(() => this._measureScoreSheetHeights(done, attempt + 1), 60);
          return;
        }
        this._scoreSheetMeasuredOk = false;
        if (typeof done === 'function') done();
        return;
      }
      const headerH = Math.max(
        56,
        Math.round(((handle && handle.height) || 0) + ((head && head.height) || 0) + 12)
      );
      // 收起时露出头部；按钮区高度即最大 translateY
      const buttonsH = Math.max(
        48,
        Math.round((buttons && buttons.height) || (sheet.height - headerH))
      );
      const maxY = Math.max(0, buttonsH);
      this._scoreSheetMaxY = maxY;
      this._scoreSheetMeasuredOk = true;
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
      if (this.data.scoreSheetAnimating) {
        this.setData({ scoreSheetAnimating: false });
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

  onScoreSheetBackdropTap() {
    if (!this.data.scorePanelExpanded) return;
    if (this._scoreSheetDragging && !this._isScoreSheetTapGesture()) return;
    this._setScoreSheetExpanded(false, { animate: true });
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
    const score = clampSelectableScore(e.currentTarget.dataset.score);
    this._pendingScoreTap = score;
  },

  onScoreButtonsTouchStart(e) {
    this._markScoreUiBusy();
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
      this._releaseScoreUiBusy(200);
      return;
    }

    this._scoreSheetDragging = false;
    this._scoreSheetDidDrag = false;
    this._scoreSheetTouchStartY = null;
    this._scoreSheetFromButtons = false;

    // catchtouchmove 在真机上常取消 tap：touchend 直接提交
    if (pending != null) {
      this._applyScoreTap(pending);
    } else {
      this._releaseScoreUiBusy(200);
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

  onStarGestureStart() {
    this._markScoreUiBusy();
    if (!this.data.starRatingGesturing) {
      this.setData({ starRatingGesturing: true });
    }
  },

  onStarGestureEnd() {
    if (this.data.starRatingGesturing) {
      this.setData({ starRatingGesturing: false });
    }
    if (!this._scoreSubmitting) {
      this._releaseScoreUiBusy(80);
    }
  },

  onStarRatingPreview(e) {
    const score = e && e.detail ? clampSelectableScore(e.detail.score) : null;
    if (score == null) return;
    this.setData(this._scoreFields(score));
  },

  onStarRatingConfirm(e) {
    const score = e && e.detail ? clampSelectableScore(e.detail.score) : null;
    if (score == null) return;
    this._applyScoreTap(score);
  },

  onStarRatingChipTap() {
    if (this.data.isCurrentPlayer) {
      wx.showToast({ title: '当前出牌玩家无需打分', icon: 'none' });
      return;
    }
    if (this.data.scoreSubmitting) return;
    this._starRatingPinnedOpen = true;
    this.setData({ starRatingCollapsed: false });
  },

  onScoreTap(e) {
    const score = clampSelectableScore(e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.score
      : null);
    if (score == null) return;
    this._applyScoreTap(score);
  },

  async _applyScoreTap(rawScore) {
    const score = clampSelectableScore(rawScore);
    if (score == null) return;
    if (this._scoreSubmitting) return;
    this._markScoreUiBusy();

    if (this.data.isCurrentPlayer) {
      this._releaseScoreUiBusy(120);
      wx.showToast({ title: '当前出牌玩家无需打分', icon: 'none' });
      return;
    }

    if (toHalfSteps(this._lastSubmittedScore) === toHalfSteps(score)) {
      this._starRatingPinnedOpen = false;
      this._scoreSubmitting = false;
      this.setData({
        ...this._scoreFields(score),
        scoreSubmitting: false,
        starRatingCollapsed: true
      });
      this._releaseScoreUiBusy(120);
      return;
    }

    this._scoreSubmitting = true;
    this._pendingScore = score;
    this.setData({
      ...this._scoreFields(score),
      scoreSubmitting: true
    });

    const { roomId, currentPlayerIndex } = this.data;
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitGameScore',
        data: {
          roomId,
          currentPlayerIndex,
          score,
          scoreHalfSteps: toHalfSteps(score)
        }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) {
        this._pendingScore = null;
        this._scoreSubmitting = false;
        this._starRatingPinnedOpen = true;
        this.setData({
          ...this._scoreFields(score),
          scoreSubmitting: false,
          starRatingCollapsed: false
        });
        this._releaseScoreUiBusy(200);
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
        return;
      }
      const scoredCount = result.scoredCount || 0;
      const totalRequired = Math.max(
        result.totalRequired != null ? Number(result.totalRequired) || 0 : 0,
        Math.max(0, (this.data.members || []).length - 1)
      );
      this._starRatingPinnedOpen = false;
      this._scoreSubmitting = false;
      const savedScore = result.myScore != null
        ? (normalizeHalfStarScore(result.myScore) != null
          ? normalizeHalfStarScore(result.myScore)
          : score)
        : score;
      this._lastSubmittedScore = savedScore;
      const scorePatch = {
        ...this._scoreFields(savedScore),
        scoredCount,
        totalRequired,
        scoreSubmitting: false,
        starRatingCollapsed: true,
        canStartStatement: this.data.isHost
          && !isDiscussionPhase(this.data.gamepagePhase)
          && totalRequired > 0
          && scoredCount >= totalRequired,
        scoreTurnKey: `turn_r${this.data.currentRound != null ? this.data.currentRound : 1}_s${currentPlayerIndex}`
      };
      this._scoreFingerprint = [
        scorePatch.scoredCount,
        scorePatch.totalRequired,
        scorePatch.canStartStatement ? 1 : 0,
        scorePatch.selectedScore,
        scorePatch.scoreTurnKey
      ].join('#');
      this.setData(scorePatch);
      this._releaseScoreUiBusy(420);
    } catch (err) {
      console.warn('submitGameScore', err);
      this._pendingScore = null;
      this._scoreSubmitting = false;
      this._starRatingPinnedOpen = true;
      this.setData({
        ...this._scoreFields(score),
        scoreSubmitting: false,
        starRatingCollapsed: false
      });
      this._releaseScoreUiBusy(200);
      wx.showToast({ title: '提交失败', icon: 'none' });
    }
  },

  openExpressComposer() {
    if (isClosingPhase(this.data.gamepagePhase)) {
      wx.showToast({ title: '当前阶段不可表达', icon: 'none' });
      return;
    }
    this._expressDraftText = '';
    this._expressComposerIgnoreBlurUntil = Date.now() + 1200;
    if (this._expressFocusTimer) {
      clearTimeout(this._expressFocusTimer);
      this._expressFocusTimer = null;
    }
    this.setData({
      expressComposerOpen: true,
      expressComposerNeedFocus: false,
      expressDraftText: '',
      expressHasText: false
    });
    // 等 input 挂载后再拉键盘；同一拍 wx:if + focus=true 在真机上经常立刻失焦
    const focusLater = () => {
      this._expressFocusTimer = null;
      if (!this.data.expressComposerOpen) return;
      this._expressComposerIgnoreBlurUntil = Date.now() + 800;
      this.setData({ expressComposerNeedFocus: true });
    };
    if (typeof wx.nextTick === 'function') {
      wx.nextTick(() => {
        this._expressFocusTimer = setTimeout(focusLater, 64);
      });
    } else {
      this._expressFocusTimer = setTimeout(focusLater, 80);
    }
  },

  closeExpressComposer() {
    if (this.data.expressSending) return;
    if (this._expressBlurTimer) {
      clearTimeout(this._expressBlurTimer);
      this._expressBlurTimer = null;
    }
    if (this._expressFocusTimer) {
      clearTimeout(this._expressFocusTimer);
      this._expressFocusTimer = null;
    }
    this._expressDraftText = '';
    this.setData({
      expressComposerOpen: false,
      expressComposerNeedFocus: false,
      expressDraftText: '',
      expressHasText: false
    });
    this._flushPendingRoomContextIfIdle();
  },

  onExpressComposerFocus() {
    this._expressComposerIgnoreBlurUntil = Date.now() + 400;
    // 聚焦中禁止立刻 setData(focus=false)，真机会把输入法打掉
  },

  onExpressComposerBlur() {
    if (this.data.expressSending) return;
    if (Date.now() < (this._expressComposerIgnoreBlurUntil || 0)) return;
    if (this._expressBlurTimer) clearTimeout(this._expressBlurTimer);
    this._expressBlurTimer = setTimeout(() => {
      this._expressBlurTimer = null;
      if (this.data.expressSending) return;
      if (Date.now() < (this._expressComposerIgnoreBlurUntil || 0)) return;
      const draft = (this._expressDraftText || this.data.expressDraftText || '').trim();
      if (draft) return;
      this.closeExpressComposer();
    }, 200);
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
    this._clearExpressChatAnchorSoon();
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
    this._expressDraftText = text;
    const hasText = !!text.trim();
    // 输入中尽量少 setData，避免受控 value + focus 重绘把键盘顶掉
    if (hasText !== this.data.expressHasText) {
      this.setData({ expressHasText: hasText });
    }
  },

  onExpressFormSubmit(e) {
    this._beginExpressSubmitGuard();
    this.submitExpress(e);
  },

  onExpressConfirm(e) {
    this._beginExpressSubmitGuard();
    this.submitExpress(e);
  },

  _beginExpressSubmitGuard() {
    this._expressComposerIgnoreBlurUntil = Date.now() + 1200;
    if (this._expressBlurTimer) {
      clearTimeout(this._expressBlurTimer);
      this._expressBlurTimer = null;
    }
  },

  onExpressSendTap(e) {
    if (this._expressSubmitLock || this.data.expressSending) return;
    this._expressComposerIgnoreBlurUntil = Date.now() + 800;
    if (this._expressBlurTimer) {
      clearTimeout(this._expressBlurTimer);
      this._expressBlurTimer = null;
    }
    this.submitExpress(e);
  },

  async submitExpress(e) {
    if (this._expressSubmitLock) return;
    if (this.data.expressSending) return;
    const canSend = this._computeExpressCanSend(
      this.data.isCurrentPlayer,
      this.data.gamepagePhase
    );
    if (!canSend) {
      wx.showToast({ title: '本轮表态结束后可发送', icon: 'none' });
      return;
    }
    const formVal = e && e.detail && e.detail.value && e.detail.value.expressText;
    const fromForm = typeof formVal === 'string' ? formVal.trim() : '';
    const fromEvent = e && e.detail && typeof e.detail.value === 'string'
      ? String(e.detail.value).trim()
      : '';
    const text = fromForm
      || fromEvent
      || (this._expressDraftText || '').trim()
      || (this.data.expressDraftText || '').trim();
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }
    this._expressSubmitLock = true;
    if (this._expressBlurTimer) {
      clearTimeout(this._expressBlurTimer);
      this._expressBlurTimer = null;
    }
    const roomId = this.data.roomId;
    if (!roomId) {
      this._expressSubmitLock = false;
      return;
    }

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
      this._expressDraftText = '';
      this.setData({
        expressModalVisible: false,
        expressComposerOpen: false,
        expressComposerNeedFocus: false,
        expressDraftText: '',
        expressHasText: false
      });
    } catch (e) {
      console.warn('submitExpress', e);
      wx.showToast({ title: '发送失败', icon: 'none' });
    } finally {
      this._expressSubmitLock = false;
      this.setData({ expressSending: false });
      this._flushPendingRoomContextIfIdle();
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
    const sessionSeq = Number(this.data.brainstormSessionSeq);
    const hasSession = Number.isFinite(sessionSeq);
    return list.filter((msg) => {
      if (!msg || !msg.id) return false;
      // 有 session 字段的消息必须匹配当前脑暴会话；无字段的旧消息仅在当前轮兜底
      if (hasSession && msg.brainstormSessionSeq != null) {
        if (Number(msg.brainstormSessionSeq) !== sessionSeq) return false;
      } else if (hasSession && sessionSeq > 0 && msg.brainstormSessionSeq == null) {
        // 再来一轮后：丢弃无 session 的历史消息，避免 round 复用串台
        return false;
      }
      if (msg.round == null || msg.round === '') {
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
    if (patch.expressChatAnchor || patch.discussionExpressChatAnchor) {
      this._clearExpressChatAnchorSoon();
    }
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
    const opened = safeOpenUrl(url, { preferNavigate: true, immediate: true });
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
    if (this.data.statementSwitching || this._startingStatement) return;
    this._startingStatement = true;
    this.setData({ statementSwitching: true, canStartStatement: false });

    this._stopRoundSpeech();
    this._stopStatePolling();
    this._stopRoundTimerBurstPoll();
    this._syncRoundContentToRoom();

    const { currentPlayerIndex, currentPlayerName } = this.data;
    try {
      const ok = await this._updateRoomState('gamepage', currentPlayerIndex, currentPlayerName, {
        partnerGamePhase: PHASE_DISCUSSION,
        partnerMasterMode: false,
        skipArchive: true,
        partnerRoundStartedAt: Date.now(),
        syncPartnerTurnTimer: true
      });
      if (!ok) {
        this.setData({
          statementSwitching: false,
          canStartStatement: true
        });
        wx.showToast({ title: '状态同步失败', icon: 'none' });
        this._startStatePolling();
        return;
      }
      this.setData({
        gamepagePhase: PHASE_DISCUSSION,
        statementSwitching: false,
        canStartStatement: false
      });
      this._startStatePolling();
    } finally {
      this._startingStatement = false;
      if (this.data.statementSwitching) {
        this.setData({ statementSwitching: false });
      }
    }
  },

  _mergeStatementTurnRecord(result) {
    const idx = this.data.currentPlayerIndex;
    const record = {
      statementResult: result,
      statementLabel: getStatementLabel(result),
      recordedAt: Date.now(),
      playerIndex: idx
    };
    const prev = Array.isArray(this.data.turnRecords) ? this.data.turnRecords.slice() : [];
    const found = prev.findIndex((item) => item && item.playerIndex === idx);
    if (found >= 0) prev[found] = { ...prev[found], ...record };
    else prev.push(record);
    this.setData({ turnRecords: prev });
    return prev;
  },

  handleAllPassFromDiscussion() {
    this.handleEndDiscussion({ statementResult: STATEMENT_ALL_PASS });
  },

  async handleEndDiscussion(options) {
    if (!this.data.isHost) {
      wx.showToast({ title: '请等待房主结束讨论', icon: 'none' });
      return;
    }
    if (this.data.discussionSwitching || this._endingDiscussion) return;
    this._endingDiscussion = true;

    const statementResult = (options && options.statementResult) || STATEMENT_ALL_QUESTION;
    const action = statementResult === STATEMENT_ALL_PASS ? 'allPass' : 'end';
    this.setData({
      discussionSwitching: true,
      discussionSwitchAction: action
    });
    this._stopStatePolling();
    this._stopRoundTimerBurstPoll();

    try {
      const { roomId, members, currentPlayerIndex, currentPlayerName } = this.data;
      let { nextIndex, nextName, incrementRound } = getNextPlayerTurn(members, currentPlayerIndex);
      const turnRecords = this._mergeStatementTurnRecord(statementResult);
      const extra = {
        partnerGamePhase: PHASE_PLAY,
        partnerMasterMode: false,
        incrementRound
      };
      const ctx = await this._syncRoomContext();
      const roundContent = ctx && ctx.roundContent;
      extra.roundSummary = {
        ...this._buildRoundSummaryPayload(),
        voiceLines: (roundContent && roundContent.voiceLines.length)
          ? roundContent.voiceLines
          : (this.data.voiceLines || []),
        turnRecords: turnRecords.length
          ? turnRecords
          : ((roundContent && roundContent.turnRecords.length)
            ? roundContent.turnRecords
            : (this.data.turnRecords || []))
      };

      if (roomId) {
        try {
          await wx.cloud.callFunction({
            name: 'finalizePartnerTurnRecord',
            data: {
              roomId,
              playerIndex: currentPlayerIndex,
              playerName: currentPlayerName,
              statementResult
            }
          });
        } catch (err) {
          console.warn('finalizePartnerTurnRecord', err);
        }
      }

      let ok = false;
      let cmd = null;
      cmd = await this._dispatchPartnerCommand('ADVANCE_TURN', {
        incrementRound: !!incrementRound,
        roundSummary: extra.roundSummary || null
      });
      if (cmd && cmd.ok === true) {
        ok = true;
        const effects = cmd.effects || {};
        if (effects.activeSeatNo != null) {
          nextIndex = toPlayerIndex(effects.activeSeatNo, nextIndex);
          const seatMember = (members || []).find(
            (m) => m && toPlayerIndex(m.playerIndex, 0) === toPlayerIndex(nextIndex, 0)
          );
          nextName = (seatMember && (seatMember.nickName || seatMember.name)) || `玩家${nextIndex}`;
        }
        if (effects.incrementRound != null) {
          incrementRound = !!effects.incrementRound;
        }
      } else {
        ok = await this._updateRoomState('gamepage', nextIndex, nextName, extra);
      }
      if (!ok) {
        this.setData({
          discussionSwitching: false,
          discussionSwitchAction: ''
        });
        wx.showToast({ title: (cmd && cmd.errMsg) || '状态同步失败', icon: 'none' });
        this._startStatePolling();
        return;
      }

      // 作废进行中的内容同步，防止旧轮纪要/旧座位写回
      this._roundContentSyncToken = (this._roundContentSyncToken || 0) + 1;

      const amCurrentAfterPass = !!(members.find(
        (m) => m && m.isMe && toPlayerIndex(m.playerIndex, 0) === toPlayerIndex(nextIndex, 0)
      ));
      // 优先用 room-domain 返回的权威轮次（effects.roundNo），避免 discussion gamepage
      // 初始 currentRound=1 的 stale 值导致轮次显示错误
      const cmdRoundNo = cmd && cmd.effects && cmd.effects.roundNo != null
        ? Number(cmd.effects.roundNo)
        : null;
      const nextRound = cmdRoundNo != null
        ? cmdRoundNo
        : (incrementRound
          ? (Number(this.data.currentRound) || 1) + 1
          : (this.data.currentRound != null ? this.data.currentRound : 1));
      this._scoreProgressFromSnapshot = false;
      this._starRatingPinnedOpen = false;
      this._scoreSubmitting = false;
      this._lastSubmittedScore = null;
      this.setData({
        currentPlayerIndex: nextIndex,
        currentPlayerName: nextName,
        currentRound: nextRound,
        gamepagePhase: PHASE_PLAY,
        isMasterMode: false,
        selectedScore: null,
        selectedScoreText: '',
        canStartStatement: false,
        scoredCount: 0,
        scoreTurnKey: `turn_r${nextRound}_s${nextIndex}`,
        scorePanelExpanded: false,
        starRatingCollapsed: false,
        scoreSubmitting: false,
        scoreSheetTranslateY: this.data.scoreSheetMaxTranslateY || 120,
        scoreSheetVisiblePx: this.data.scoreSheetCollapsedPx || 72,
        scoreSheetAnimating: false,
        specialMoveUsedThisTurn: false,
        isCurrentPlayer: amCurrentAfterPass,
        showSpecialMoveBtn: amCurrentAfterPass,
        // 换人即换手：本地当前手内容一律清空，避免继承上一位玩家的纪要
        playHistory: [],
        discussionNotes: [],
        playImages: [],
        discussionImages: [],
        playBlocks: [],
        discussionBlocks: [],
        voiceLines: [],
        turnRecords: [],
        discussionSwitching: false,
        discussionSwitchAction: ''
      }, () => {
        this._roundSpeech && this._roundSpeech.stop();
        this._syncRoundSpeech();
        if (!incrementRound) {
          this.refreshScoreStatus();
        }
        // 换人后由房主重开共享计时
        if (this.data.isHost) {
          this._ensureSharedRoundTimerOnEnter();
        }
      });

      // 后台拉齐快照；若读到滞后座位则忽略，避免把 UI 打回讨论中的当前玩家
      const session = this._boundRoomSession || getActiveRoomSession();
      if (session && typeof session.refresh === 'function') {
        try {
          await session.refresh({ force: true });
          const snap = typeof session.getSnapshot === 'function' ? session.getSnapshot() : null;
          const snapIdx = snap && snap.raw && snap.raw.roomState
            ? toPlayerIndex(snap.raw.roomState.currentPlayerIndex, 0)
            : 0;
          if (
            snap
            && snap.ok === true
            && snap.raw
            && snapIdx > 0
            && snapIdx === toPlayerIndex(nextIndex, 0)
          ) {
            this._applyRoomContext(snap.raw, { resetTurnUi: true });
          }
        } catch (e) {
          console.warn('endDiscussion force refresh', e);
        }
      }
      this._startStatePolling();
    } catch (err) {
      console.warn('handleEndDiscussion', err);
      this.setData({
        discussionSwitching: false,
        discussionSwitchAction: ''
      });
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      this._startStatePolling();
    } finally {
      this._endingDiscussion = false;
      if (this.data.discussionSwitching) {
        this.setData({
          discussionSwitching: false,
          discussionSwitchAction: ''
        });
      }
    }
  },

  handleGoRoom() {
    this._prepareLeavePage();
    if (this.data.isHistoryReview) {
      wx.reLaunch({ url: '/pages/main-pages/aaa/index' });
      return;
    }
    goRoomPage(this.data.roomId);
  },

  /** 点击设计问题：回看情境详情（confirmBG），navigateTo 保留本页实例与进度 */
  handleViewSituation() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }
    // 仅暂停本页轮询/本地计时展示；房间锚点 partnerRoundStartedAt 保留，返回后 onShow 续上
    this._prepareLeavePage();
    const problemText = (this.data.selectedProblemText || '').trim();
    const app = getApp();
    if (problemText && app.globalData) {
      const prev = app.globalData.selectedProblem || {};
      app.globalData.selectedProblem = {
        id: prev.id || '',
        text: problemText
      };
    }
    let url = `/pages/main-pages/partnerMode/confirmBG/index?roomId=${encodeURIComponent(roomId)}&from=game`;
    if (problemText) {
      url += `&problemText=${encodeURIComponent(problemText)}`;
    }
    wx.navigateTo({
      url,
      success: (res) => {
        try {
          const ec = res && res.eventChannel;
          if (ec && typeof ec.emit === 'function') {
            ec.emit('initGameDetail', {
              problemText,
              problemId: (app.globalData.selectedProblem && app.globalData.selectedProblem.id) || '',
              selectedBG: app.globalData.selectedBG || null
            });
          }
        } catch (e) {
          console.warn('emit initGameDetail', e);
        }
      },
      fail: () => {
        this._pageVisible = true;
        this._startStatePolling();
        if (!this._scoreProgressFromSnapshot) {
          this._startScorePolling();
        }
        this._syncRoundSpeech();
      }
    });
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
    const run = () => {
      wx.createSelectorQuery()
        .in(this)
        .select('.inspiration-bar')
        .boundingClientRect((rect) => {
          if (!rect) {
            this._inspirationFooterClearancePx = 0;
            return;
          }
          let windowHeight = 0;
          try {
            windowHeight = (wx.getSystemInfoSync() || {}).windowHeight || 0;
          } catch (e) {
            windowHeight = 0;
          }
          this._inspirationFooterClearancePx = windowHeight
            ? Math.max(0, Math.ceil(windowHeight - rect.bottom))
            : 0;
        })
        .exec();
    };
    if (typeof wx.nextTick === 'function') wx.nextTick(run);
    else setTimeout(run, 64);
  },

  _buildInspirationLiftStyle(keyboardHeight) {
    const h = Math.max(0, Number(keyboardHeight) || 0);
    if (h <= 0) return '';
    // 历史回顾无底部操作栏：用 fixed 贴在键盘上方，避免 overflow:hidden 裁切
    if (this.data.isHistoryReview || this._isHistoryReview) {
      return [
        'position:fixed',
        'left:0',
        'right:0',
        `bottom:${h}px`,
        'margin:0',
        'padding:18rpx 30rpx 18rpx',
        'z-index:80',
        'background:#fafafa',
        'box-sizing:border-box'
      ].join(';');
    }
    // 正常对局：按「键盘高 − 灵感栏距窗底空隙」上移，底栏留在键盘下，避免 adjust-position 把空隙顶出来
    const footer = Math.max(0, this._inspirationFooterClearancePx || 0);
    const dy = Math.max(0, h - footer);
    return dy > 0
      ? `transform:translateY(-${dy}px);background:#fafafa`
      : '';
  },

  _resetInspirationKeyboardUi() {
    return {
      inspirationKeyboardHeight: 0,
      inspirationLiftStyle: ''
    };
  },

  _setInspirationKeyboardHeight(height) {
    const next = this._isDevtools() ? 0 : Math.max(0, Number(height) || 0);
    if (
      next <= 0
      && (this._inspirationNativeFocused || this.data.inspirationInputFocused)
    ) {
      return;
    }
    const lift = this._buildInspirationLiftStyle(next);
    if (
      next === this.data.inspirationKeyboardHeight
      && lift === (this.data.inspirationLiftStyle || '')
    ) {
      return;
    }
    this.setData({
      inspirationKeyboardHeight: next,
      inspirationLiftStyle: lift
    });
  },

  onInspirationFocus() {
    if (this._inspirationBlurTimer) {
      clearTimeout(this._inspirationBlurTimer);
      this._inspirationBlurTimer = null;
    }
    this._inspirationNativeFocused = true;
    this._measureInspirationFooterClearance();
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
    // 仅用 input 的 bindkeyboardheightchange，避免与 wx.onKeyboardHeightChange 双通道抖动
  },

  _unbindInspirationKeyboard() {
    this._inspirationKeyboardBound = false;
    if (
      typeof wx.offKeyboardHeightChange === 'function'
      && this._onInspirationKeyboardHeightChange
    ) {
      wx.offKeyboardHeightChange(this._onInspirationKeyboardHeightChange);
      this._onInspirationKeyboardHeightChange = null;
    }
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
    // 先停轮询，避免 navigate 过程中被房间态打回 gamepage
    this._stopStatePolling();
    this._stopRoundTimerBurstPoll();
    const roomId = this.data.roomId || '';
    const seq = this.data.brainstormSessionSeq != null ? this.data.brainstormSessionSeq : 0;
    // scope=workshop：列出本人在本房间的全部灵感（与灯泡角标一致）
    let url = '/pages/inspiration/index?scope=workshop';
    if (roomId) {
      url += `&roomId=${encodeURIComponent(roomId)}&brainstormSessionSeq=${seq}`;
    }
    const opened = openPartnerPage(url);
    if (!opened) {
      wx.navigateTo({
        url,
        fail: (err) => {
          console.warn('navigateTo inspiration fail', err);
          wx.redirectTo({
            url,
            fail: (err2) => {
              console.warn('redirectTo inspiration fail', err2);
              this._startStatePolling();
              wx.showToast({ title: '打开灵感空间失败', icon: 'none' });
            }
          });
        }
      });
    }
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
    const ok = await this._updateRoomState('leaderboard', currentPlayerIndex, currentPlayerName, {
      partnerGamePhase: PHASE_CLOSING
    });
    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }
    safeOpenUrl(buildLeaderboardUrl(roomId, { from: 'closingEnd' }));
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
    if (!this.data.isHost) return;
    this._closingNativeFocused = true;
    if (this._closingBlurTimer) {
      clearTimeout(this._closingBlurTimer);
      this._closingBlurTimer = null;
    }
    if (this._closingFocusUiTimer) clearTimeout(this._closingFocusUiTimer);
    this._closingFocusUiTimer = setTimeout(() => {
      this._closingFocusUiTimer = null;
      if (!this._closingNativeFocused) return;
      if (!this.data.closingCreativeEditFocus) {
        this.setData({
          closingCreativeEditFocus: true,
          closingImageDeleteKey: ''
        });
      }
    }, 280);
  },

  onClosingCreativeInput(e) {
    if (!this.data.isHost) return;
    const text = (e.detail && e.detail.value) || '';
    this._closingDraftText = text;
    this.setData({
      closingCreativeEditText: text,
      closingCreativeHasText: !!text.trim()
    });
  },

  onClosingCreativeKeyboardHeightChange(e) {
    const height = Number(e && e.detail && e.detail.height) || 0;
    if (height === this.data.closingKeyboardHeight) return;
    this.setData({ closingKeyboardHeight: height });
  },

  onClosingCreativeFormSubmit(e) {
    if (this.data.closingCreativeSaving) return;
    this._closingSaveIgnoreBlurUntil = Date.now() + 800;
    this._closingNativeFocused = true;
    if (this._closingBlurTimer) {
      clearTimeout(this._closingBlurTimer);
      this._closingBlurTimer = null;
    }
    if (this._closingFocusUiTimer) {
      clearTimeout(this._closingFocusUiTimer);
      this._closingFocusUiTimer = null;
    }
    const formVal = e && e.detail && e.detail.value && e.detail.value.closingCreativeText;
    const text = typeof formVal === 'string' ? formVal : undefined;
    this._commitClosingCreativeEdit({ text });
  },

  async onClosingCreativeBlur() {
    if (this._closingPickingImage) return;
    if (Date.now() < (this._closingSaveIgnoreBlurUntil || 0)) return;
    if (this._closingFocusUiTimer) {
      clearTimeout(this._closingFocusUiTimer);
      this._closingFocusUiTimer = null;
    }
    if (this._closingBlurTimer) clearTimeout(this._closingBlurTimer);
    this._closingBlurTimer = setTimeout(() => {
      this._closingBlurTimer = null;
      if (this._closingPickingImage) return;
      if (Date.now() < (this._closingSaveIgnoreBlurUntil || 0)) return;
      this._closingNativeFocused = false;
      this._commitClosingCreativeEdit({ allowEmptyExit: true });
    }, 200);
  },

  /** 点击已记录文字 → 拉回输入态编辑；清空后失焦即删除 */
  async onClosingCreativeTextTap(e) {
    if (!this.data.isHost) return;
    if (this.data.closingCreativeSaving) return;
    const key = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.key
      : '';
    if (!key) return;
    const block = (this.data.closingCreativeBlocks || []).find(
      (b) => b && b.type === 'text' && b.key === key
    );
    if (!block) return;

    // 若正在编辑其他内容，先提交
    const editingOther = this.data.closingCreativeEditingKey
      && this.data.closingCreativeEditingKey !== key;
    const hasDraft = !!(this.data.closingCreativeEditText || '').trim();
    if (editingOther || (hasDraft && this.data.closingCreativeEditingKey !== key)) {
      await this._commitClosingCreativeEdit();
    }

    this.setData({ closingCreativeWantFocus: false }, () => {
      this.setData({
        closingCreativeEditText: block.text || '',
        closingCreativeHasText: !!(block.text || '').trim(),
        closingCreativeEditingKey: key,
        closingCreativeEditFocus: true,
        closingCreativeWantFocus: true,
        closingImageDeleteKey: ''
      });
    });
  },

  async _commitClosingCreativeEdit(options = {}) {
    if (!this.data.isHost) return;
    if (this.data.closingCreativeSaving) return;
    const raw = options.text != null
      ? String(options.text)
      : ((this._closingDraftText != null ? this._closingDraftText : this.data.closingCreativeEditText) || '');
    const editingKey = this.data.closingCreativeEditingKey || '';
    const segments = splitRecordSegments(raw);

    if (!segments.length) {
      if (editingKey) {
        this.setData({ closingCreativeSaving: true });
        try {
          const ok = await this._removeClosingCreativeBlockByKey(editingKey);
          this.setData({
            closingCreativeEditText: '',
            closingCreativeHasText: false,
            closingCreativeEditFocus: false,
            closingCreativeWantFocus: false,
            closingCreativeEditingKey: ok ? '' : editingKey,
            closingKeyboardHeight: 0
          });
        } finally {
          this.setData({ closingCreativeSaving: false });
          this._flushPendingRoomContextIfIdle();
        }
        return;
      }
      if (options.allowEmptyExit) {
        this._closingNativeFocused = false;
        this.setData({
          closingCreativeEditFocus: false,
          closingCreativeWantFocus: false,
          closingKeyboardHeight: 0
        });
        this._flushPendingRoomContextIfIdle();
      } else {
        wx.showToast({ title: '请输入内容', icon: 'none' });
      }
      return;
    }

    this.setData({ closingCreativeSaving: true });
    try {
      let ok = false;
      if (editingKey) {
        ok = await this._replaceClosingCreativeText(editingKey, raw);
      } else {
        ok = await this._appendClosingCreativeContent({ text: raw });
      }
      if (ok) {
        this._closingDraftText = '';
        this._closingNativeFocused = false;
        this.setData({
          closingCreativeEditText: '',
          closingCreativeHasText: false,
          closingCreativeEditFocus: false,
          closingCreativeWantFocus: false,
          closingCreativeEditingKey: '',
          closingKeyboardHeight: 0
        });
      }
    } finally {
      this.setData({ closingCreativeSaving: false });
      this._flushPendingRoomContextIfIdle();
    }
  },

  async _replaceClosingCreativeText(key, raw) {
    if (!this.data.isHost) return false;
    const blocks = (this.data.closingCreativeBlocks || []).slice();
    const idx = blocks.findIndex((b) => b && b.key === key);
    if (idx < 0) {
      return this._appendClosingCreativeContent({ text: raw });
    }
    const inserted = appendTextSegments([], raw);
    if (!inserted.length) {
      return this._removeClosingCreativeBlockByKey(key);
    }
    const nextBlocks = blocks.slice();
    nextBlocks.splice(idx, 1, ...inserted);
    this.setData({
      closingCreativeBlocks: nextBlocks,
      ...this._closingDeckImagePatch(nextBlocks)
    });
    const ok = await this._syncClosingCreativeToRoom(nextBlocks);
    if (!ok) {
      this.setData({
        closingCreativeBlocks: blocks,
        ...this._closingDeckImagePatch(blocks)
      });
      wx.showToast({ title: '同步失败', icon: 'none' });
    }
    return ok;
  },

  async _removeClosingCreativeBlockByKey(key) {
    if (!this.data.isHost || !key) return false;
    const blocks = this.data.closingCreativeBlocks || [];
    if (!blocks.some((b) => b && b.key === key)) return true;
    const nextBlocks = blocks.filter((b) => b && b.key !== key);
    this.setData({
      closingCreativeBlocks: nextBlocks,
      closingImageDeleteKey: '',
      ...this._closingDeckImagePatch(nextBlocks)
    });
    const ok = await this._syncClosingCreativeToRoom(nextBlocks);
    if (!ok) {
      this.setData({
        closingCreativeBlocks: blocks,
        ...this._closingDeckImagePatch(blocks)
      });
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
    return ok;
  },

  onClosingCreativeAddImage() {
    // 创意点复盘拍照仅房主可操作，非房主只读
    if (!this.data.isHost) return;
    if (this.data.gamepagePhase !== PHASE_CLOSING
      || this.data.closingStep !== CLOSING_STEP_REVIEW) {
      return;
    }
    const imageCount = (this.data.closingCreativeBlocks || []).filter(
      (b) => b && b.type === 'image'
    ).length;
    if (imageCount >= 1 || this.data.closingHasDeckImage) {
      wx.showToast({ title: '每张卡片只能上传1张图片', icon: 'none' });
      return;
    }
    this._closingPickingImage = true;
    if (this._closingBlurTimer) {
      clearTimeout(this._closingBlurTimer);
      this._closingBlurTimer = null;
    }
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        wx.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType,
          success: async (chooseRes) => {
            const paths = chooseRes.tempFilePaths || [];
            this._closingPickingImage = false;
            if (!paths.length) {
              this.setData({
                closingCreativeEditFocus: false,
                closingCreativeWantFocus: false,
                closingKeyboardHeight: 0
              });
              return;
            }
            wx.showLoading({ title: '上传中…', mask: true });
            try {
              // 先落盘当前输入态（编辑中的文字/草稿），再插图
              await this._commitClosingCreativeEdit();
              const ok = await this._appendClosingCreativeContent({
                photos: paths.slice(0, 1)
              });
              if (ok) {
                this.setData({
                  closingCreativeEditText: '',
                  closingCreativeHasText: false,
                  closingCreativeEditingKey: '',
                  closingCreativeEditFocus: false,
                  closingCreativeWantFocus: false,
                  closingKeyboardHeight: 0
                });
              }
            } finally {
              wx.hideLoading();
            }
          },
          fail: () => {
            this._closingPickingImage = false;
            this._commitClosingCreativeEdit({ allowEmptyExit: true });
            wx.showToast({ title: '选择图片失败', icon: 'none' });
          }
        });
      },
      fail: () => {
        this._closingPickingImage = false;
        this._commitClosingCreativeEdit({ allowEmptyExit: true });
      }
    });
  },

  async onClosingCreativePreview(e) {
    const url = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.url
      : '';
    if (!url) return;
    const urls = (this.data.closingCreativeBlocks || [])
      .filter((b) => b && b.type === 'image' && b.url)
      .map((b) => b.url);
    const list = urls.length ? urls : [url];
    // wx.previewImage 不支持 cloud:// fileID，需先换成可访问的临时链
    const { list: resolvedList, current: resolvedCurrent } = await this._resolveClosingCreativePreviewUrls(list, url);
    wx.previewImage({ current: resolvedCurrent, urls: resolvedList });
  },

  onClosingCreativeImageLongPress(e) {
    if (!this.data.isHost) return;
    const key = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.key
      : '';
    if (!key) return;
    this.setData({ closingImageDeleteKey: key });
  },

  onClosingCreativeImageTap(e) {
    const key = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.key
      : '';
    // 删除态下再点图片：收起叉叉，不进预览
    if (this.data.closingImageDeleteKey && this.data.closingImageDeleteKey === key) {
      this.setData({ closingImageDeleteKey: '' });
      return;
    }
    if (this.data.closingImageDeleteKey) {
      this.setData({ closingImageDeleteKey: '' });
    }
    this.onClosingCreativePreview(e);
  },

  async onClosingCreativeRemoveBlock(e) {
    if (!this.data.isHost) return;
    if (this.data.closingCreativeSaving) return;
    const key = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.key
      : '';
    if (!key) return;
    const blocks = this.data.closingCreativeBlocks || [];
    const target = blocks.find((b) => b && b.key === key);
    if (!target || target.type !== 'image') return;

    this.setData({ closingCreativeSaving: true });
    try {
      await this._removeClosingCreativeBlockByKey(key);
    } finally {
      this.setData({ closingCreativeSaving: false });
    }
  },

  async _resolveClosingCreativePreviewUrls(list, current) {
    const resolvedList = await resolveCloudDisplayUrls(list || []);
    const idx = (list || []).indexOf(current);
    const resolvedCurrent = idx >= 0
      ? (resolvedList[idx] || resolvedList[0] || current)
      : (resolvedList[0] || current);
    return { list: resolvedList.filter(Boolean), current: resolvedCurrent };
  },

  async _uploadClosingCreativePhotos(paths) {
    const roomId = this.data.roomId || 'room';
    const list = Array.isArray(paths) ? paths : [];
    const results = [];
    let failedCount = 0;
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
      failedCount += 1;
    }
    if (failedCount > 0) {
      wx.showToast({
        title: failedCount === list.length ? '图片上传失败' : `有${failedCount}张图片上传失败`,
        icon: 'none'
      });
    }
    return results;
  },

  async _appendClosingCreativeContent(options = {}) {
    if (!this.data.isHost) return false;
    const text = typeof options.text === 'string' ? options.text : '';
    const photos = Array.isArray(options.photos) ? options.photos : [];
    const segments = splitRecordSegments(text);
    if (!segments.length && !photos.length) return false;

    const existingBlocks = this.data.closingCreativeBlocks || [];
    const hasImage = existingBlocks.some((b) => b && b.type === 'image' && b.url);
    const photosToUpload = hasImage ? [] : photos.slice(0, 1);
    if (photos.length && hasImage) {
      wx.showToast({ title: '每张卡片只能上传1张图片', icon: 'none' });
      if (!segments.length) return false;
    }

    let uploaded = [];
    if (photosToUpload.length) {
      uploaded = await this._uploadClosingCreativePhotos(photosToUpload);
      if (!uploaded.length && !segments.length) {
        wx.showToast({ title: '图片上传失败', icon: 'none' });
        return false;
      }
    }

    let nextBlocks = existingBlocks.slice();
    // 先追加文字、再追加图片，保证插图落在已有文字末尾；之后继续输入的文字会排在图片下方
    if (segments.length) nextBlocks = appendTextSegments(nextBlocks, text);
    if (uploaded.length) nextBlocks = appendImageBlocks(nextBlocks, uploaded.slice(0, 1));
    nextBlocks = limitImageBlocks(nextBlocks, 1);
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
    if (!this.data.isHost) return false;
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
    this._prepareLeavePage();
    const roomId = this.data.roomId || '';
    const fallbackUrl = roomId
      ? `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
      : '/pages/main-pages/aaa/index';
    safeNavigateBack({
      expectedPrev: [
        'pages/main-pages/partnerMode/confirmFirstPlayer/index',
        'pages/main-pages/selectPlayer/index',
        'pages/main-pages/partnerMode/statement/index',
        'pages/main-pages/partnerMode/specialMove/index',
        'pages/main-pages/discussion/index'
      ],
      fallbackUrl
    });
  }
});
