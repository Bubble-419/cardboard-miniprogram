const { assignAvatarImages } = require('../../../../utils/avatars');
const { buildGamepageUrl, buildClosingStatementUrl } = require('../../../../utils/modeRoutes');
const { safeOpenUrl, navigateByRoomState } = require('../../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const { resolveSelectedDesignProblem } = require('../../../../utils/selectedDesignProblem');
const { buildPartnerAvatarList, resolveCurrentPlayerFromRoom } = require('../../../../utils/partnerPlayerTurn');
const { markPartnerSpecialMoveUsed } = require('../../../../utils/partnerSpecialMove');
const { goRoomPage } = require('../../../../utils/goRoomPage');
const { openUrl, openPartnerPage } = require('../../../../utils/pageNavigate');
const { isAiFeatureEnabled } = require('../../../../utils/aiFeature');
const { isRoundTimerActive, buildPaginationDots } = require('../../../../utils/partnerRoundTimer');
const { getCapsuleTopBarMetrics } = require('../../../../utils/capsuleTopBar');
const { getStatementLabel } = require('../../../../utils/partnerRoundContent');
const { buildDisplaySummaries } = require('../../../../utils/partnerRoundNavigation');
const { attachPrivateNotesToSummaries } = require('../../../../utils/partnerRoundPrivateNotes');
const { resolveRoundContentMedia } = require('../../../../utils/cloudDisplayUrl');

// AI_TEMP_DISABLED: 恢复 AI 后改回 label: '求助AI或运气'
const WHEEL_ACTIONS = [
  { id: 'helpLuck', label: isAiFeatureEnabled() ? '求助AI或运气' : '求助运气', zone: 'left' },
  { id: 'silent', label: '全场静默', zone: 'right' },
  { id: 'master', label: 'MASTER', sub: '开启模式', zone: 'top' },
  { id: 'closing', label: '收尾阶段', sub: '进入', zone: 'bottom' }
];

// 非等分扇形：上下各 68°、左右各 112°（分割线偏垂直 ±34°，与 Figma 十字一致）
const WHEEL_PIECES = [
  { id: 'master', zone: 'top' },
  { id: 'silent', zone: 'right' },
  { id: 'closing', zone: 'bottom' },
  { id: 'helpLuck', zone: 'left' }
];

const SUGGESTED_QUESTIONS = ['智能穿戴设备', '如何提升体验'];

const SILENT_DURATION_SEC = 5 * 60;

const SILENT_HINT_LINES = [
  '选择全场静默',
  '将会获得5min的安静思考时间',
  '期间所有玩家需要保持分贝40dB以下'
];

const MASTER_HINT_LINES = [
  '开启master模式后',
  '您将可以无限操作卡牌，不受时间和出牌限制。'
];

const CLOSING_HINT_LINES = [
  '选择进入收尾阶段',
  '若全员表态通过，将进入补全符文',
  '若存在疑问，将回到出牌解释继续'
];

// AI_TEMP_DISABLED: 恢复 AI 时把 outside 选项重新加入列表
const HELP_METHOD_OPTIONS_ALL = [
  { id: 'reverse', title: '反面随机拼', desc: '将卡牌置于反面，随机拼成卡组' },
  { id: 'outside', title: '求助场外', desc: '限时求助场外包括AI' }
];
const HELP_METHOD_OPTIONS = isAiFeatureEnabled()
  ? HELP_METHOD_OPTIONS_ALL
  : HELP_METHOD_OPTIONS_ALL.filter((item) => item.id !== 'outside');

const REVERSE_STEPS = [
  { label: 'step1.将1号覆膜置于桌面' },
  { label: 'Step 2. 背面朝上拼接卡牌至覆膜' },
  { label: 'Step 3. 两张覆膜对齐粘贴' },
  { label: 'step4.通过覆膜垂直翻面卡组' }
];

Page({
  data: {
    roomId: '',
    initiatorPlayerIndex: 1,
    currentPlayerIndex: 1,
    currentRound: 1,
    brainstormSessionSeq: 0,
    avatarList: [],
    selectedProblemText: '',
    problemExpanded: false,
    problemTextOverflow: false,
    viewMode: 'wheel',
    selectedAction: '',
    // AI_TEMP_DISABLED: 无 AI 时默认反面随机拼；恢复后可改回 'outside'
    helpMethod: isAiFeatureEnabled() ? 'outside' : 'reverse',
    aiFeatureEnabled: isAiFeatureEnabled(),
    showChat: false,
    chatInput: '',
    chatMessages: [],
    wheelActions: WHEEL_ACTIONS,
    wheelPieces: WHEEL_PIECES,
    helpMethodOptions: HELP_METHOD_OPTIONS,
    silentHintLines: SILENT_HINT_LINES,
    masterHintLines: MASTER_HINT_LINES,
    closingHintLines: CLOSING_HINT_LINES,
    silentDurationSec: SILENT_DURATION_SEC,
    silentStartedAt: 0,
    silentTimerActive: false,
    isHost: false,
    /** 声贝等级 0~1，房主本地采样或从房间轮询读取 */
    soundLevel: 0,
    inspirationDraftText: '',
    inspirationInputFocused: false,
    inspirationKeyboardHeight: 0,
    inspirationLiftStyle: '',
    inspirationHasText: false,
    suggestedQuestions: SUGGESTED_QUESTIONS,
    reverseSteps: REVERSE_STEPS,
    avatarRoundStartedAt: null,
    roundTimerActive: false,
    roundTimerKey: '',
    displayRoundSummaries: [],
    cardIndex: 0,
    cardCount: 1,
    paginationDots: [{ key: 0, sizeClass: 'dot-lg', active: true }],
    indicatorPlayerIndex: 1,
    innerScrollLocked: false,
    /** 与微信胶囊垂直对齐 */
    topBarPadTop: 20,
    topBarHeight: 32,
    topBarIconSize: 32,
    topBarPaddingRight: 12
  },

  _applyTopBarSafeInset() {
    try {
      const metrics = getCapsuleTopBarMetrics({ minBarPx: 36 });
      const sys = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const windowWidth = (sys && sys.windowWidth) || 375;
      const chipNeedPx = Math.ceil((74 * windowWidth) / 750);
      const barHeight = Math.max(metrics.barHeight, chipNeedPx);
      const capsuleCenter = metrics.padTop + metrics.barHeight / 2;
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
    const opts = options || {};
    const app = getApp();
    const roomId = opts.roomId || (app && app.globalData && app.globalData.roomId) || '';
    const parsedIdx = parseInt(opts.currentPlayerIndex, 10);
    const initiatorPlayerIndex = Number.isFinite(parsedIdx) && parsedIdx > 0 ? parsedIdx : 1;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    getApp().globalData.roomId = roomId;
    this.setData({ roomId, initiatorPlayerIndex, currentPlayerIndex: initiatorPlayerIndex });
    this._applyTopBarSafeInset();
    this.loadRoomData();
  },

  onShow() {
    this._applyTopBarSafeInset();
    this._bindInspirationKeyboard();
    if (this.data.roomId) {
      this._startStatePolling();
    }
    this._measureInspirationFooterClearance();
  },

  onHide() {
    this._unbindInspirationKeyboard();
    this.setData({
      inspirationKeyboardHeight: 0,
      inspirationLiftStyle: ''
    });
    this._stopStatePolling();
    this._stopSoundLevelSampling();
  },

  onUnload() {
    this._unbindInspirationKeyboard();
    this.clearSilentTimer();
    this._stopStatePolling();
    this._stopSoundLevelSampling();
  },

  /** 仅在确认「本人不是当前出牌人」时退出；isMe 未对上时不要踢，避免进页闪退 */
  _shouldLeaveForTurnChange(members, player) {
    const me = (members || []).find((m) => m && m.isMe);
    if (!me || !player) return false;
    return player.isCurrentPlayer !== true;
  },

  _markSpecialMoveUsedForGamepage() {
    // 标记必须挂在当前出牌轮次玩家上，避免误锁下一玩家或房主自身
    const playerIndex = this.data.currentPlayerIndex != null
      ? this.data.currentPlayerIndex
      : this.data.initiatorPlayerIndex;
    markPartnerSpecialMoveUsed(
      this.data.roomId,
      playerIndex,
      this.data.currentRound != null ? this.data.currentRound : 1,
      this.data.brainstormSessionSeq != null ? this.data.brainstormSessionSeq : 0
    );
  },

  _buildGamepageUrlFromRoom(pollResult, options = {}) {
    const state = (pollResult && pollResult.roomState) || {};
    const {
      roomId,
      currentPlayerIndex,
      initiatorPlayerIndex,
      currentRound,
      brainstormSessionSeq
    } = this.data;
    const idx = currentPlayerIndex != null ? currentPlayerIndex : initiatorPlayerIndex;
    const urlOpts = {
      currentRound,
      brainstormSessionSeq
    };
    if (state.partnerGamePhase === 'discussion') {
      urlOpts.phase = 'discussion';
    } else if (state.partnerGamePhase === 'closing') {
      urlOpts.phase = 'closing';
      if (state.partnerClosingStep) urlOpts.closingStep = state.partnerClosingStep;
    }
    if (options.markUsed) {
      urlOpts.specialMoveUsed = true;
    }
    return buildGamepageUrl(roomId, idx, 'partner', urlOpts);
  },

  _redirectToGamepageFromRoom(pollResult, options = {}) {
    const target = this._buildGamepageUrlFromRoom(pollResult, options);

    if (this.data.viewMode === 'silent' || this.data.silentTimerActive) {
      this._stopSilentTimerUi();
    }
    this._stopStatePolling();

    // 讨论/收尾须带 phase，避免 navigateBack 回到旧出牌态
    if (target.indexOf('phase=') >= 0) {
      const opened = openUrl(target, { immediate: true });
      if (opened) return;
      wx.redirectTo({
        url: target,
        fail: () => {
          wx.reLaunch({
            url: target,
            fail: () => {
              this._startStatePolling();
              wx.showToast({ title: '跳转失败，请稍候', icon: 'none' });
            }
          });
        }
      });
      return;
    }

    const { safeNavigateBack } = require('../../../../utils/pageNavigate');
    if (!options.markUsed) {
      safeNavigateBack({
        expectedPrev: 'pages/main-pages/partnerMode/gamepage/index',
        fallbackUrl: target
      });
      return;
    }
    safeOpenUrl(target);
  },

  _returnToGamepage(markUsed = true) {
    this._redirectToGamepageFromRoom({ roomState: {} }, { markUsed });
  },

  formatSilentTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  startSilentTimer(startedAtOverride) {
    this.clearSilentTimer();
    const startedAt = Number(startedAtOverride) > 0 ? Number(startedAtOverride) : Date.now();
    this.setData({
      silentStartedAt: startedAt,
      silentTimerActive: true
    });
    // 发起人采样麦克风分贝并广播；其他人从房间轮询读取
    this._startSoundLevelSampling();
    // 兜底：边框倒计时 + 结束动效之后仍未回调时强制结束
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const remainMs = Math.max(0, SILENT_DURATION_SEC * 1000 - elapsedMs) + 4000;
    this._silentTimer = setTimeout(() => {
      this._silentTimer = null;
      this.handleEndSilent();
    }, remainMs);
  },

  clearSilentTimer() {
    if (this._silentTimer) {
      clearTimeout(this._silentTimer);
      this._silentTimer = null;
    }
    this._stopSoundLevelSampling();
  },

  _stopSilentTimerUi() {
    this.clearSilentTimer();
    if (this.data.silentTimerActive || this.data.silentStartedAt) {
      this.setData({
        silentTimerActive: false,
        silentStartedAt: 0
      });
    }
  },

  handleSilentTimerExpire() {
    this.handleEndSilent();
  },

  handleGoInspirationCenter() {
    // 先停轮询，避免 navigate 过程中被房间态打回 gamepage
    this._stopStatePolling();
    const roomId = this.data.roomId || '';
    const seq = this.data.brainstormSessionSeq != null ? this.data.brainstormSessionSeq : 0;
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
    const footer = Math.max(0, this._inspirationFooterClearancePx || 0);
    const dy = Math.max(0, kh - footer);
    return dy > 0 ? `transform:translateY(-${dy}px)` : '';
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
      if (this._inspirationNativeFocused) return;
      this.setData({
        inspirationInputFocused: false,
        inspirationKeyboardHeight: 0,
        inspirationLiftStyle: ''
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

  onInspirationActionTap() {
    if (this.data.inspirationHasText) {
      wx.showToast({ title: '灵感已记录（本地）', icon: 'none' });
      this.setData({
        inspirationDraftText: '',
        inspirationHasText: false,
        inspirationInputFocused: false,
        inspirationKeyboardHeight: 0,
        inspirationLiftStyle: ''
      });
      return;
    }
    this.handleGoInspirationCenter();
  },

  /** 与 gamepage 同源：头像框只用本回合首次锚点 */
  _resolveAvatarRoundStartedAt(roomState) {
    const turnTs = roomState && roomState.partnerTurnStartedAt != null
      ? Number(roomState.partnerTurnStartedAt)
      : 0;
    const cardTs = roomState && roomState.partnerRoundStartedAt != null
      ? Number(roomState.partnerRoundStartedAt)
      : 0;
    if (Number.isFinite(turnTs) && turnTs > 0) return turnTs;
    if (Number.isFinite(cardTs) && cardTs > 0) return cardTs;
    return null;
  },

  _syncAvatarTimerFromRoom(roomState, currentRound, currentPlayerIndex) {
    const avatarRoundStartedAt = this._resolveAvatarRoundStartedAt(roomState);
    const roundTimerKey = `${currentRound != null ? currentRound : 1}-${currentPlayerIndex != null ? currentPlayerIndex : 1}`;
    const roundTimerActive = !!(avatarRoundStartedAt && isRoundTimerActive(avatarRoundStartedAt));
    const patch = {};
    if (avatarRoundStartedAt !== this.data.avatarRoundStartedAt) {
      patch.avatarRoundStartedAt = avatarRoundStartedAt;
    }
    if (roundTimerActive !== this.data.roundTimerActive) {
      patch.roundTimerActive = roundTimerActive;
    }
    if (roundTimerKey !== this.data.roundTimerKey) {
      patch.roundTimerKey = roundTimerKey;
    }
    if (Object.keys(patch).length) {
      this.setData(patch);
    }
  },

  handleRoundTimerExpire() {
    // 特殊行动期间卡片不 loop；头像到期仅刷新房间态
    if (this.data.roomId) {
      this.loadRoomData();
    }
  },

  _summaryHasContent(item) {
    const has = (arr) => Array.isArray(arr) && arr.length > 0;
    return !!(item && (
      has(item.playHistory)
      || has(item.discussionNotes)
      || has(item.playImages)
      || has(item.discussionImages)
      || has(item.playBlocks)
      || has(item.discussionBlocks)
      || has(item.voiceLines)
      || has(item.turnRecords)
    ));
  },

  _reviewCardKey(item, summaryIdx) {
    if (!item || item.round == null || item.playerIndex == null) {
      return summaryIdx != null ? `i${summaryIdx}` : '';
    }
    const archived = item.archivedAt != null ? Number(item.archivedAt) : 0;
    return `i${summaryIdx}_r${Number(item.round)}_p${Number(item.playerIndex)}_${archived}`;
  },

  _summariesFingerprint(summaries) {
    return (summaries || []).map((s) => [
      s.round,
      s.playerIndex,
      s.archivedAt || 0,
      (s.playHistory || []).length,
      (s.discussionNotes || []).length,
      (s.voiceLines || []).length,
      (s.turnRecords || []).length,
      (s.playBlocks || []).length,
      (s.discussionBlocks || []).length
    ].join(':')).join('|');
  },

  _decorateTurnRecords(records) {
    return (Array.isArray(records) ? records : []).map((turn) => {
      if (!turn || typeof turn !== 'object') return turn;
      return {
        ...turn,
        statementLabel: turn.statementLabel || getStatementLabel(turn.statementResult) || ''
      };
    });
  },

  _normalizeRoundSummaries(roomState, members) {
    const currentRound = roomState && roomState.currentRound != null
      ? Number(roomState.currentRound)
      : Number(this.data.currentRound || 1);
    const raw = Array.isArray(roomState && roomState.partnerRoundSummaries)
      ? roomState.partnerRoundSummaries
      : (this._lastRawRoundSummaries || []);
    if (Array.isArray(roomState && roomState.partnerRoundSummaries)) {
      this._lastRawRoundSummaries = roomState.partnerRoundSummaries;
    }
    const filtered = raw.filter((item) => {
      const rd = Number(item && item.round);
      if (!Number.isFinite(rd) || rd <= 0) return false;
      if (rd >= currentRound) return false;
      return this._summaryHasContent(item);
    }).map((item) => ({
      ...item,
      voiceLines: Array.isArray(item.voiceLines) ? item.voiceLines : [],
      turnRecords: this._decorateTurnRecords(item.turnRecords)
    }));
    return attachPrivateNotesToSummaries(
      buildDisplaySummaries(filtered, members),
      this.data.roomId,
      roomState && roomState.brainstormSessionSeq != null
        ? roomState.brainstormSessionSeq
        : this.data.brainstormSessionSeq
    ).map((item, idx) => ({
      ...item,
      reviewCardKey: this._reviewCardKey(item, idx),
      privateNote: item.privateNote || {
        playHistory: [],
        discussionNotes: [],
        playImages: [],
        discussionImages: [],
        playBlocks: [],
        discussionBlocks: []
      }
    }));
  },

  _applyRoundSummaries(summaries, options) {
    const displayRoundSummaries = Array.isArray(summaries) ? summaries : [];
    const fingerprint = this._summariesFingerprint(displayRoundSummaries);
    const summaryCount = displayRoundSummaries.length;
    const cardCount = summaryCount + 1;
    const jumpToAction = options && options.jumpToAction === true;
    const prevCount = this.data.cardCount || 1;
    const prevIndex = this.data.cardIndex || 0;
    const wasOnAction = prevIndex >= prevCount - 1;
    const cardIndex = (jumpToAction || wasOnAction)
      ? summaryCount
      : Math.min(prevIndex, Math.max(0, cardCount - 1));
    const indicatorPlayerIndex = cardIndex < summaryCount && displayRoundSummaries[cardIndex]
      ? displayRoundSummaries[cardIndex].playerIndex
      : (this.data.currentPlayerIndex || 1);
    const sameList = fingerprint === this._summariesFp
      && cardCount === this.data.cardCount
      && cardIndex === this.data.cardIndex
      && indicatorPlayerIndex === this.data.indicatorPlayerIndex;
    if (sameList && !jumpToAction) return;

    this._summariesFp = fingerprint;
    this.setData({
      displayRoundSummaries,
      cardCount,
      cardIndex,
      paginationDots: buildPaginationDots(cardIndex, cardCount),
      indicatorPlayerIndex
    });
    this._hydrateSummaryMedia(displayRoundSummaries);
  },

  _jumpToActionCard() {
    const summaryCount = (this.data.displayRoundSummaries || []).length;
    const cardCount = Math.max(1, summaryCount + 1);
    const cardIndex = summaryCount;
    this.setData({
      cardCount,
      cardIndex,
      paginationDots: buildPaginationDots(cardIndex, cardCount),
      indicatorPlayerIndex: this.data.currentPlayerIndex
    });
  },

  _hydrateSummaryMedia(summaries) {
    const list = Array.isArray(summaries) ? summaries : [];
    if (!list.length) return;
    const token = (this._cloudMediaToken || 0) + 1;
    this._cloudMediaToken = token;
    Promise.all(list.map((item) => resolveRoundContentMedia(item || {}))).then((resolved) => {
      if (this._cloudMediaToken !== token) return;
      const current = this.data.displayRoundSummaries || [];
      this.setData({
        displayRoundSummaries: current.map((row, i) => {
          const next = resolved[i];
          if (!next) return row;
          return {
            ...row,
            playImages: next.playImages,
            discussionImages: next.discussionImages,
            playBlocks: next.playBlocks,
            discussionBlocks: next.discussionBlocks,
            privateNote: next.privateNote || row.privateNote || {}
          };
        })
      });
    }).catch((e) => console.warn('specialMove hydrate media', e));
  },

  onCardSwiperChange(e) {
    const index = e.detail && e.detail.current != null ? e.detail.current : 0;
    const maxIndex = Math.max(0, (this.data.cardCount || 1) - 1);
    const cardIndex = Math.min(index, maxIndex);
    const summaries = this.data.displayRoundSummaries || [];
    this.setData({
      cardIndex,
      paginationDots: buildPaginationDots(cardIndex, this.data.cardCount),
      indicatorPlayerIndex: cardIndex < summaries.length && summaries[cardIndex]
        ? summaries[cardIndex].playerIndex
        : this.data.currentPlayerIndex
    });
  },

  onInnerScrollTouchStart() {
    if (!this.data.innerScrollLocked) {
      this.setData({ innerScrollLocked: true });
    }
  },

  onInnerScrollTouchEnd() {
    if (this.data.innerScrollLocked) {
      this.setData({ innerScrollLocked: false });
    }
  },

  onRoundHistoryPreview(e) {
    const url = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.url
      : '';
    if (!url) return;
    const idx = this.data.cardIndex || 0;
    const item = (this.data.displayRoundSummaries || [])[idx] || {};
    const note = item.privateNote || {};
    const urls = [].concat(
      note.playImages || [],
      note.discussionImages || [],
      note.images || [],
      item.playImages || [],
      item.discussionImages || []
    ).filter(Boolean);
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] });
  },

  async loadRoomData() {
    const roomId = this.data.roomId;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId, full: true }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.members || !result.members.length) return;

      const members = assignAvatarImages(result.members);
      const player = resolveCurrentPlayerFromRoom(
        members,
        result.roomState,
        this.data.initiatorPlayerIndex
      );
      // 非当前出牌玩家不得停留；本人身份尚未对上时先留在本页
      if (this._shouldLeaveForTurnChange(members, player)) {
        wx.showToast({ title: '请等待您的轮次', icon: 'none' });
        this._returnToGamepage(false);
        return;
      }
      const selectedProblem = resolveSelectedDesignProblem(getApp(), result);
      const roomState = result.roomState || {};
      const currentRound = roomState.currentRound != null ? roomState.currentRound : 1;

      this.setData({
        members,
        avatarList: buildPartnerAvatarList(members),
        // 以房间态当前出牌玩家为准，发起人索引与之对齐
        currentPlayerIndex: player.currentPlayerIndex,
        initiatorPlayerIndex: player.currentPlayerIndex,
        currentRound,
        brainstormSessionSeq: roomState.brainstormSessionSeq != null
          ? roomState.brainstormSessionSeq
          : 0,
        isHost: result.isHost === true,
        selectedProblemText: selectedProblem && selectedProblem.text ? selectedProblem.text : '',
        problemExpanded: false,
        problemTextOverflow: false
      }, () => {
        this._checkProblemTextOverflow();
        this._syncAvatarTimerFromRoom(roomState, currentRound, player.currentPlayerIndex);
        this._applyRoundSummaries(this._normalizeRoundSummaries(roomState, members));
      });
    } catch (e) {
      console.warn('specialMove loadRoomData', e);
    }
  },

  /**
   * 房主采样分贝 → 本地音柱；节流写入房间态供全员同步。
   * 声贝快路径不传 currentPage，避免把其他玩家打回房间页。
   */
  _startSoundLevelSampling() {
    this._stopSoundLevelSampling();

    wx.authorize({ scope: 'scope.record' }).catch(() => {});

    const manager = wx.getRecorderManager();
    this._recorderManager = manager;

    manager.onFrameRecorded((res) => {
      if (!res || !res.frameBuffer) return;
      try {
        const buf = res.frameBuffer;
        const samples = new Int16Array(buf);
        if (!samples.length) return;
        let sumSq = 0;
        for (let i = 0; i < samples.length; i++) {
          sumSq += samples[i] * samples[i];
        }
        const rms = Math.sqrt(sumSq / samples.length);
        const db = rms > 0 ? 20 * Math.log10(rms / 32768) : -100;
        // 映射：-60dB 以下→0，-10dB 以上→1
        const lv = Math.min(1, Math.max(0, (db + 60) / 50));
        this.setData({ soundLevel: lv });
        this._broadcastSilentSoundLevel(lv);
      } catch (e) {
        // ignore PCM parse errors
      }
    });

    manager.onError((err) => {
      console.warn('silent recorder error', err);
      this._stopSoundLevelSampling();
    });

    manager.start({
      duration: (SILENT_DURATION_SEC + 10) * 1000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'pcm',
      frameSize: 1
    });
  },

  _broadcastSilentSoundLevel(level) {
    const roomId = this.data.roomId || '';
    if (!roomId || !this.data.silentTimerActive) return;
    const now = Date.now();
    if (this._lastSoundBroadcastAt && now - this._lastSoundBroadcastAt < 500) return;
    this._lastSoundBroadcastAt = now;
    wx.cloud.callFunction({
      name: 'updateRoomState',
      data: {
        roomId,
        partnerSilentSoundLevel: Math.min(1, Math.max(0, Number(level) || 0))
      }
    }).catch(() => {});
  },

  _stopSoundLevelSampling() {
    if (this._recorderManager) {
      try { this._recorderManager.stop(); } catch (e) { /* ignore */ }
      this._recorderManager = null;
    }
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName, extra) {
    const roomId = this.data.roomId || '';
    if (!roomId) return { ok: false };
    try {
      const data = { roomId, currentPage };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      if (extra && extra.partnerMasterMode != null) {
        data.partnerMasterMode = extra.partnerMasterMode;
      }
      if (extra && extra.partnerSilentMode != null) {
        data.partnerSilentMode = extra.partnerSilentMode;
      }
      if (extra && extra.partnerSilentStartedAt != null) {
        data.partnerSilentStartedAt = extra.partnerSilentStartedAt;
      }
      if (extra && extra.partnerGamePhase != null) {
        data.partnerGamePhase = extra.partnerGamePhase;
      }
      if (extra && extra.resetClosingVotes === true) {
        data.resetClosingVotes = true;
      }
      if (extra && extra.closingVoteInitiatorIndex != null) {
        data.closingVoteInitiatorIndex = extra.closingVoteInitiatorIndex;
      }
      const res = await wx.cloud.callFunction({ name: 'updateRoomState', data });
      const result = (res && res.result) || {};
      return {
        ok: result.ok === true,
        closingVoteSessionId: result.closingVoteSessionId || 0,
        closingVoteSeq: result.closingVoteSeq || 0
      };
    } catch (e) {
      console.warn('updateRoomState', e);
      return { ok: false };
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
        const members = result.members || this.data.members || [];
        const player = resolveCurrentPlayerFromRoom(
          members,
          result.roomState,
          this.data.currentPlayerIndex
        );
        // 轮次已切走：退出特殊行动页
        if (result.ok === true && members.length && this._shouldLeaveForTurnChange(members, player)) {
          this._stopStatePolling();
          wx.showToast({ title: '请等待您的轮次', icon: 'none' });
          this._returnToGamepage(false);
          return;
        }
        followSubScreenRoomPoll(result, roomId, {
          beforeNavigate: (pollResult, page) => {
            const state = pollResult.roomState || {};
            // 房主开始表态：静默/master/求助运气等均须与房主进入同一讨论流程
            if (state.partnerGamePhase === 'discussion') {
              this._redirectToGamepageFromRoom(pollResult);
              return true;
            }
            // 未本地采样时：从房间同步声贝等级到音柱
            if (
              !this._recorderManager
              && this.data.silentTimerActive
              && pollResult.roomState
              && pollResult.roomState.partnerSilentSoundLevel != null
            ) {
              const lv = Math.min(1, Math.max(0, Number(pollResult.roomState.partnerSilentSoundLevel) || 0));
              if (Math.abs(lv - (this.data.soundLevel || 0)) > 0.02) {
                this.setData({ soundLevel: lv });
              }
            }
            if (pollResult.roomState) {
              this._syncAvatarTimerFromRoom(
                pollResult.roomState,
                pollResult.roomState.currentRound != null
                  ? pollResult.roomState.currentRound
                  : this.data.currentRound,
                player.currentPlayerIndex
              );
            }
            // 房间静默已结束（他人清场/换轮）：退出静默视图
            if (
              this.data.viewMode === 'silent'
              && this.data.silentTimerActive
              && state.partnerSilentMode === false
            ) {
              this._redirectToGamepageFromRoom(pollResult);
              return true;
            }
            // 收尾表态：房主/副屏都必须跳（含卡在本页时自救）
            if (page === 'closingstatement') {
              const state = pollResult.roomState || {};
              openUrl(buildClosingStatementUrl(roomId, {
                closingVoteSessionId: state.closingVoteSessionId || '',
                _t: Date.now()
              }), { immediate: true });
              return true;
            }
            // 仍在 gamepage 且非 master：勿被旧 poll 打回 gamepage（防卡顿回跳）
            // 静默中同样留在 specialMove 控制页
            if (
              page === 'gamepage'
              && (pollResult.roomState || {}).partnerMasterMode !== true
            ) {
              return true;
            }
            return false;
          }
        });
      } catch (e) {
        console.warn('specialMove state poll', e);
      }
    };
    poll();
    this._statePollTimer = setInterval(poll, 2000);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
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

  handleGoBack() {
    const { viewMode, showChat } = this.data;
    if (showChat) {
      this.setData({ showChat: false });
      return;
    }
    if (viewMode === 'reverseRandom') {
      this.setData({ viewMode: 'wheel' }, () => this._jumpToActionCard());
      return;
    }
    if (viewMode === 'silent') {
      // 返回转盘即取消静默：清房间态，避免其他人仍显示声贝边框
      this._stopSilentTimerUi();
      this._clearSilentRoomState();
      this.setData({
        viewMode: 'wheel'
      }, () => this._jumpToActionCard());
      return;
    }
    // 转盘选择页：返回脑暴主流程（未确认行动，不标记已使用）
    this._returnToGamepage(false);
  },

  onSelectAction(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;

    const patch = { selectedAction: id };
    if (id === 'helpLuck') {
      patch.helpMethod = this.data.helpMethod || 'outside';
    }
    this.setData(patch);
  },

  onSelectHelpMethod(e) {
    const method = e.currentTarget.dataset.method;
    if (!method) return;
    this.setData({ helpMethod: method });
  },

  handleConfirm() {
    const { viewMode, selectedAction } = this.data;

    if (viewMode === 'reverseRandom') return;

    if (!selectedAction) {
      wx.showToast({ title: '请选择特殊行动', icon: 'none' });
      return;
    }

    if (selectedAction === 'helpLuck') {
      // 默认进入反面随机拼（已去掉求助方式选择区）
      this.setData({ viewMode: 'reverseRandom', helpMethod: 'reverse' }, () => {
        this._jumpToActionCard();
      });
      return;
    }

    if (selectedAction === 'silent') {
      this.activateSilentMode();
      return;
    }

    if (selectedAction === 'master') {
      this.activateMasterMode();
      return;
    }

    if (selectedAction === 'closing') {
      this.activateClosing();
      return;
    }

    wx.showToast({ title: '该特殊行动敬请期待', icon: 'none' });
  },

  async activateClosing() {
    const { roomId } = this.data;
    if (!roomId) return;
    if (this._activatingClosing) return;
    this._activatingClosing = true;

    try {
      const initiatorIdx = this.data.initiatorPlayerIndex != null
        ? this.data.initiatorPlayerIndex
        : this.data.currentPlayerIndex;
      const result = await this._updateRoomState('closingStatement', null, null, {
        partnerGamePhase: 'closing',
        partnerMasterMode: false,
        partnerSilentMode: false,
        resetClosingVotes: true,
        closingVoteInitiatorIndex: initiatorIdx
      });
      if (!result || result.ok !== true) {
        wx.showToast({ title: '状态同步失败', icon: 'none' });
        return;
      }

      const url = buildClosingStatementUrl(roomId, {
        closingVoteSessionId: result.closingVoteSessionId || '',
        isInitiator: true,
        _t: Date.now()
      });
      // 先跳转再停轮询：失败时仍可靠 poll 自救到 closingStatement
      const opened = openUrl(url, { immediate: true });
      if (opened) {
        this._stopStatePolling();
        return;
      }
      // openUrl 防抖/同路由失败时强制 redirectTo，避免卡死在特殊行动页
      wx.redirectTo({
        url,
        success: () => this._stopStatePolling(),
        fail: () => {
          wx.reLaunch({
            url,
            success: () => this._stopStatePolling(),
            fail: () => {
              this._startStatePolling();
              wx.showToast({ title: '跳转失败，请稍候', icon: 'none' });
            }
          });
        }
      });
    } finally {
      this._activatingClosing = false;
    }
  },

  async activateSilentMode() {
    const { roomId, members } = this.data;
    if (!roomId) return;
    if (this._activatingSilent) return;
    this._activatingSilent = true;

    try {
      const turnPlayerIndex = this.data.currentPlayerIndex != null
        ? this.data.currentPlayerIndex
        : this.data.initiatorPlayerIndex;
      const turnPlayer = (members || []).find((m) => m.playerIndex === turnPlayerIndex);
      const turnPlayerName = turnPlayer
        ? (turnPlayer.nickName || `玩家${turnPlayerIndex}`)
        : `玩家${turnPlayerIndex}`;
      const startedAt = Date.now();

      // 写入房间静默态，全员 gamepage 卡片切到声贝边框；保持 currentPage=gamepage 避免踢页
      const result = await this._updateRoomState('gamepage', turnPlayerIndex, turnPlayerName, {
        partnerSilentMode: true,
        partnerSilentStartedAt: startedAt,
        partnerMasterMode: false
      });
      if (!result || result.ok !== true) {
        wx.showToast({ title: '状态同步失败', icon: 'none' });
        return;
      }

      this.setData({ viewMode: 'silent' }, () => this._jumpToActionCard());
      this.startSilentTimer(startedAt);
    } finally {
      this._activatingSilent = false;
    }
  },

  async activateMasterMode() {
    const { roomId, members } = this.data;
    if (!roomId) return;

    // MASTER 仅归属当前出牌玩家本人
    const turnPlayerIndex = this.data.currentPlayerIndex != null
      ? this.data.currentPlayerIndex
      : this.data.initiatorPlayerIndex;
    const turnPlayer = (members || []).find((m) => m.playerIndex === turnPlayerIndex);
    const turnPlayerName = turnPlayer
      ? (turnPlayer.nickName || `玩家${turnPlayerIndex}`)
      : `玩家${turnPlayerIndex}`;

    this._markSpecialMoveUsedForGamepage();

    const result = await this._updateRoomState('gamepage', turnPlayerIndex, turnPlayerName, {
      partnerMasterMode: true,
      partnerSilentMode: false
    });
    if (!result || result.ok !== true) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }

    this._stopStatePolling();
    this._returnToGamepage();
  },

  _clearSilentRoomState() {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    const turnPlayerIndex = this.data.currentPlayerIndex != null
      ? this.data.currentPlayerIndex
      : this.data.initiatorPlayerIndex;
    // 异步清场，不阻塞 UI；失败时依赖换轮 / 下次 poll 兜底
    this._updateRoomState('gamepage', turnPlayerIndex, null, {
      partnerSilentMode: false
    }).catch(() => {});
  },

  async handleCancelAdopt() {
    if (!this.data.roomId) return;
    if (this.data.currentRound == null) {
      await this.loadRoomData();
    }
    // 取消采用：特殊行动仍记为已使用，回 gamepage 继续倒计时
    this._markSpecialMoveUsedForGamepage();
    this._stopStatePolling();
    this._returnToGamepage();
  },

  async handleAdoptDeck() {
    if (!this.data.roomId) return;
    if (this.data.currentRound == null) {
      await this.loadRoomData();
    }
    this._markSpecialMoveUsedForGamepage();
    const app = getApp();
    if (!app.globalData) app.globalData = {};
    app.globalData.partnerAdoptDeckHint = {
      roomId: this.data.roomId,
      at: Date.now()
    };
    this._stopStatePolling();
    this._returnToGamepage();
  },

  async handleEndSilent() {
    if (this._endingSilent) return;
    this._endingSilent = true;
    this._stopSilentTimerUi();
    try {
      if (!this.data.roomId) return;
      if (this.data.currentRound == null) {
        await this.loadRoomData();
      }
      this._markSpecialMoveUsedForGamepage();
      const turnPlayerIndex = this.data.currentPlayerIndex != null
        ? this.data.currentPlayerIndex
        : this.data.initiatorPlayerIndex;
      await this._updateRoomState('gamepage', turnPlayerIndex, null, {
        partnerSilentMode: false
      });
      this._returnToGamepage();
    } finally {
      this._endingSilent = false;
    }
  },

  handleCloseChat() {
    if (!isAiFeatureEnabled()) {
      this.setData({ showChat: false });
      return;
    }
    this._returnToGamepage();
  },

  onChatInput(e) {
    if (!isAiFeatureEnabled()) return;
    this.setData({ chatInput: e.detail.value || '' });
  },

  onTapSuggestion(e) {
    if (!isAiFeatureEnabled()) return;
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    this.setData({ chatInput: text });
  },

  handleSendChat() {
    if (!isAiFeatureEnabled()) {
      wx.showToast({ title: 'AI 功能暂未开放', icon: 'none' });
      return;
    }
    const text = (this.data.chatInput || '').trim();
    if (!text) return;

    const userMsg = {
      id: `u_${Date.now()}`,
      role: 'user',
      text
    };
    const reply = {
      id: `a_${Date.now()}`,
      role: 'assistant',
      text: '已收到您的问题，AI 接入后将在此回复。'
    };

    this.setData({
      chatInput: '',
      chatMessages: [...this.data.chatMessages, userMsg, reply]
    });
  }
});
