const { assignAvatarImages } = require('../../../../utils/avatars');
const { buildGamepageUrl } = require('../../../../utils/modeRoutes');
const {
  bindPageToRoomSession,
  unbindPageFromRoomSession,
  dispatchRoomCommand,
  getCommittedSnapshotAfterCommand,
  getRoomPageSnapshot,
  getActiveRoomSession,
  getRoomRequestContext
} = require('../../../../modules/room-session/index');
const { resolveSelectedDesignProblem } = require('../utils/selectedDesignProblem');
const { buildPartnerAvatarList, resolveCurrentPlayerFromRoom } = require('../utils/partnerPlayerTurn');
const { goRoomPage } = require('../../../../utils/goRoomPage');
const { openUrl } = require('../../../../utils/pageNavigate');
const { isAiFeatureEnabled } = require('../../../../utils/aiFeature');
const {
  runPageInteraction,
  runPageNavigation,
  waitForPageNavigation,
  withPageInteractionLock
} = require('../../../../utils/pageInteractionLock');
const { isRoundTimerActive, buildPaginationDots } = require('../../../../utils/partnerRoundTimer');
const { getCapsuleTopBarMetrics } = require('../../../../utils/capsuleTopBar');
const { getStatementLabel } = require('../../../../utils/partnerRoundContent');
const { buildDisplaySummaries } = require('../utils/partnerRoundNavigation');
const { attachPrivateNotesToSummaries } = require('../../../../utils/partnerRoundPrivateNotes');
const { resolveRoundContentMedia } = require('../../../../utils/cloudDisplayUrl');
const {
  buildKeyboardLiftStyle,
  keyboardHeightFromEvent
} = require('../../../../utils/keyboardAvoidance');

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

Page(withPageInteractionLock({
  data: {
    roomId: '',
    initiatorPlayerIndex: 1,
    currentPlayerIndex: 1,
    currentRound: 1,
    sessionId: '',
    turnId: '',
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
    chatInputFocused: false,
    chatKeyboardHeight: 0,
    chatInputLiftStyle: '',
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
    isCurrentPlayer: false,
    canEndSilent: false,
    /** 声贝等级 0~1，本机麦克风采样；无麦时回退房主瞬时信号 */
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
    cardSlides: [],
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

    const joinSilent = opts.silent === '1' || opts.silent === true || opts.silent === 'true';
    this._joinSilent = joinSilent;

    getApp().globalData.roomId = roomId;
    this.setData({
      roomId,
      initiatorPlayerIndex,
      currentPlayerIndex: initiatorPlayerIndex,
      viewMode: joinSilent ? 'silent' : 'wheel',
      isCurrentPlayer: !joinSilent,
      canEndSilent: !joinSilent
    });
    this._applyTopBarSafeInset();
    this.loadRoomData();
  },

  onShow() {
    this._applyTopBarSafeInset();
    this._bindInspirationKeyboard();
    this._silentRecordDenied = false;
    if (this.data.roomId) {
      this._startStatePolling();
    }
    if (this.data.silentTimerActive) this._startSoundLevelSampling();
  },

  onHide() {
    this._unbindInspirationKeyboard();
    this._flushInspirationKeyboardZero(true);
    this._chatInputNativeFocused = false;
    if (this._chatKeyboardZeroTimer) {
      clearTimeout(this._chatKeyboardZeroTimer);
      this._chatKeyboardZeroTimer = null;
    }
    this.setData({
      inspirationKeyboardHeight: 0,
      inspirationLiftStyle: '',
      ...this._resetChatKeyboardUi()
    });
    this._stopStatePolling();
    this._stopSoundLevelSampling();
  },

  onUnload() {
    this._unbindInspirationKeyboard();
    if (this._chatKeyboardZeroTimer) {
      clearTimeout(this._chatKeyboardZeroTimer);
      this._chatKeyboardZeroTimer = null;
    }
    this.clearSilentTimer();
    this._stopStatePolling();
    this._stopSoundLevelSampling();
  },

  /** 静默期间全员停留；仅确认「本人不是当前出牌人且未进入静默」时退出 */
  _shouldLeaveForTurnChange(members, player, roomState) {
    if (this.data.viewMode === 'silent' || this.data.silentTimerActive || this._joinSilent) {
      return false;
    }
    if (roomState && roomState.partnerSilentMode === true) return false;
    const me = (members || []).find((m) => m && m.isMe);
    if (!me || !player) return false;
    return player.isCurrentPlayer !== true;
  },

  _buildGamepageUrlFromRoom(pollResult, options = {}) {
    const state = (pollResult && pollResult.roomState) || {};
    const {
      roomId,
      currentPlayerIndex,
      initiatorPlayerIndex,
      currentRound,
      sessionId
    } = this.data;
    const idx = currentPlayerIndex != null ? currentPlayerIndex : initiatorPlayerIndex;
    const urlOpts = {
      currentRound,
      sessionId
    };
    if (state.partnerGamePhase === 'discussion') {
      urlOpts.phase = 'discussion';
    } else if (state.partnerGamePhase === 'closing') {
      urlOpts.phase = 'closing';
      if (state.partnerClosingStep) urlOpts.closingStep = state.partnerClosingStep;
    }
    return buildGamepageUrl(roomId, idx, 'partner', urlOpts);
  },

  _hasUnderlyingGamepage() {
    if (typeof getCurrentPages !== 'function') return false;
    const pages = getCurrentPages();
    const previous = pages.length >= 2 ? pages[pages.length - 2] : null;
    return !!(previous && previous.route === 'pages/main-pages/partnerMode/gamepage/index');
  },

  async _redirectToGamepageFromRoom(pollResult, options = {}) {
    const target = this._buildGamepageUrlFromRoom(pollResult, options);

    if (this.data.viewMode === 'silent' || this.data.silentTimerActive) {
      this._stopSilentTimerUi();
    }
    this._stopStatePolling();

    // specialMove 是 gamepage 的本地叠层。正常路径只关闭叠层，保留下层稳定
    // RoomShell；最新 Snapshot 会在 gamepage.onShow 恢复订阅后原地刷新屏幕。
    if (this._hasUnderlyingGamepage()) {
      const backed = await waitForPageNavigation('navigateBack', { delta: 1 });
      if (backed.ok) return backed;
    }

    // 页面栈异常或被系统回收时才按权威状态 URL 重建；所有导航都有超时，不会永久锁页。
    const redirected = await waitForPageNavigation('redirectTo', { url: target });
    if (redirected.ok) return redirected;
    const relaunched = await waitForPageNavigation('reLaunch', { url: target });
    if (!relaunched.ok) {
      this._startStatePolling();
      wx.showToast({ title: '跳转失败，请稍候', icon: 'none' });
    }
    return relaunched;
  },

  _returnToGamepage(markUsed = true) {
    return this._redirectToGamepageFromRoom({ roomState: {} }, { markUsed });
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
    // 全员本机采麦测 40dB；无麦时再回退到房主广播的瞬时信号
    this._startSoundLevelSampling();
    if (!this._canEndSilent()) return;
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
    if (!this._canEndSilent()) {
      this._stopSilentTimerUi();
      return;
    }
    this.handleEndSilent();
  },

  handleGoInspirationCenter() {
    return runPageNavigation(this, async () => {
      // 先停轮询，避免 navigate 过程中被房间态打回 gamepage
      this._stopStatePolling();
      const roomId = this.data.roomId || '';
      const sessionId = String(this.data.sessionId || '');
      let url = '/pages/inspiration/index?scope=workshop';
      if (roomId) {
        url += `&roomId=${encodeURIComponent(roomId)}&sessionId=${encodeURIComponent(sessionId)}`;
      }
      return { method: 'navigateTo', url };
    }, { loadingText: '正在打开灵感空间…' });
  },

  _resetInspirationKeyboardUi() {
    return {
      inspirationKeyboardHeight: 0,
      inspirationLiftStyle: buildKeyboardLiftStyle(0)
    };
  },

  _commitInspirationKeyboardHeight(next) {
    const height = Math.max(0, Number(next) || 0);
    const inspirationLiftStyle = buildKeyboardLiftStyle(height);
    if (
      height === this.data.inspirationKeyboardHeight
      && inspirationLiftStyle === this.data.inspirationLiftStyle
    ) return;
    this.setData({ inspirationKeyboardHeight: height, inspirationLiftStyle });
  },

  _flushInspirationKeyboardZero(immediate) {
    if (this._inspirationKbZeroTimer) {
      clearTimeout(this._inspirationKbZeroTimer);
      this._inspirationKbZeroTimer = null;
    }
    if (immediate) this._commitInspirationKeyboardHeight(0);
  },

  _setInspirationKeyboardHeight(height) {
    const next = Math.max(0, Number(height) || 0);
    if (next > 0) {
      this._flushInspirationKeyboardZero(false);
      this._commitInspirationKeyboardHeight(next);
      return;
    }
    if (this._inspirationNativeFocused || this.data.inspirationInputFocused) return;
    if (this._inspirationKbZeroTimer) clearTimeout(this._inspirationKbZeroTimer);
    this._inspirationKbZeroTimer = setTimeout(() => {
      this._inspirationKbZeroTimer = null;
      this._commitInspirationKeyboardHeight(0);
    }, 120);
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
        ...this._resetInspirationKeyboardUi()
      });
    }, 180);
  },

  onInspirationKeyboardHeightChange(e) {
    const height = keyboardHeightFromEvent(e);
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
    // 只使用 input 的 bindkeyboardheightchange，避免全局监听与组件事件重复抖动。
  },

  _unbindInspirationKeyboard() {
    if (!this._inspirationKeyboardBound) return;
    this._inspirationKeyboardBound = false;
    this._flushInspirationKeyboardZero(false);
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
    const note = item && item.privateNote;
    return !!(item && (
      has(item.playHistory)
      || has(item.discussionNotes)
      || has(item.playImages)
      || has(item.discussionImages)
      || has(item.playBlocks)
      || has(item.discussionBlocks)
      || has(item.voiceLines)
      || has(item.turnRecords)
      || (note && (
        has(note.playHistory)
        || has(note.discussionNotes)
        || has(note.playImages)
        || has(note.discussionImages)
        || has(note.playBlocks)
        || has(note.discussionBlocks)
      ))
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

  _buildCurrentRoundSummary(roomState, members) {
    const content = roomState && roomState.partnerCurrentRoundContent;
    if (!content || typeof content !== 'object') return null;
    if (!this._summaryHasContent(content)) return null;
    const currentRound = roomState.currentRound != null
      ? Number(roomState.currentRound)
      : Number(this.data.currentRound || 1);
    const playerIndex = this.data.currentPlayerIndex != null
      ? Number(this.data.currentPlayerIndex)
      : 1;
    const player = (members || []).find((m) => Number(m.playerIndex) === playerIndex);
    return {
      round: currentRound,
      playerIndex,
      playerName: (player && (player.nickName || player.userName)) || `玩家${playerIndex}`,
      playHistory: Array.isArray(content.playHistory) ? content.playHistory : [],
      discussionNotes: Array.isArray(content.discussionNotes) ? content.discussionNotes : [],
      playImages: Array.isArray(content.playImages) ? content.playImages : [],
      discussionImages: Array.isArray(content.discussionImages) ? content.discussionImages : [],
      playBlocks: Array.isArray(content.playBlocks) ? content.playBlocks : [],
      discussionBlocks: Array.isArray(content.discussionBlocks) ? content.discussionBlocks : [],
      voiceLines: Array.isArray(content.voiceLines) ? content.voiceLines : [],
      turnRecords: Array.isArray(content.turnRecords) ? content.turnRecords : [],
      archivedAt: 0
    };
  },

  _normalizeRoundSummaries(roomState, members) {
    const currentRound = roomState && roomState.currentRound != null
      ? Number(roomState.currentRound)
      : Number(this.data.currentRound || 1);
    const raw = Array.isArray(roomState && roomState.partnerRoundSummaries)
      ? roomState.partnerRoundSummaries
      : [];
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
    const currentSummary = this._buildCurrentRoundSummary(roomState, members);
    if (currentSummary) {
      const already = filtered.some((item) => (
        Number(item.round) === Number(currentSummary.round)
        && Number(item.playerIndex) === Number(currentSummary.playerIndex)
      ));
      if (!already) {
        filtered.push({
          ...currentSummary,
          turnRecords: this._decorateTurnRecords(currentSummary.turnRecords)
        });
      }
    }
    return attachPrivateNotesToSummaries(
      buildDisplaySummaries(filtered, members),
      this.data.roomId,
      roomState && roomState.sessionId != null
        ? roomState.sessionId
        : this.data.sessionId
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
    })).filter((item) => this._summaryHasContent(item));
  },

  _buildCardSlides(summaries) {
    const list = Array.isArray(summaries) ? summaries : [];
    const slides = list.map((item, idx) => ({
      ...item,
      slideType: 'history',
      slideKey: item.reviewCardKey || this._reviewCardKey(item, idx)
    }));
    if (this.data.viewMode === 'silent') {
      slides.push({ slideType: 'silent', slideKey: 'action-silent' });
    } else if (this.data.viewMode === 'reverseRandom') {
      slides.push({ slideType: 'reverse', slideKey: 'action-reverse' });
    }
    return slides;
  },

  _applyRoundSummaries(summaries, options) {
    const displayRoundSummaries = Array.isArray(summaries) ? summaries : [];
    const fingerprint = this._summariesFingerprint(displayRoundSummaries);
    const cardSlides = this._buildCardSlides(displayRoundSummaries);
    const cardCount = Math.max(1, cardSlides.length);
    const jumpToAction = options && options.jumpToAction === true;
    const prevCount = this.data.cardCount || 1;
    const prevIndex = this.data.cardIndex || 0;
    const wasOnAction = prevIndex >= prevCount - 1;
    const cardIndex = (jumpToAction || wasOnAction)
      ? Math.max(0, cardSlides.length - 1)
      : Math.min(prevIndex, Math.max(0, cardCount - 1));
    const indicatorPlayerIndex = cardIndex < displayRoundSummaries.length
      && displayRoundSummaries[cardIndex]
      ? displayRoundSummaries[cardIndex].playerIndex
      : (this.data.currentPlayerIndex || 1);
    const sameList = fingerprint === this._summariesFp
      && cardCount === this.data.cardCount
      && cardIndex === this.data.cardIndex
      && (this.data.cardSlides || []).length === cardSlides.length
      && indicatorPlayerIndex === this.data.indicatorPlayerIndex;
    if (sameList && !jumpToAction) return;

    this._summariesFp = fingerprint;
    this.setData({
      displayRoundSummaries,
      cardSlides,
      cardCount,
      cardIndex,
      paginationDots: buildPaginationDots(cardIndex, cardCount),
      indicatorPlayerIndex
    });
    this._hydrateSummaryMedia(displayRoundSummaries);
  },

  _jumpToActionCard() {
    const cardSlides = this._buildCardSlides(this.data.displayRoundSummaries || []);
    const cardCount = Math.max(1, cardSlides.length);
    const cardIndex = Math.max(0, cardSlides.length - 1);
    this.setData({
      cardSlides,
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
      const displayRoundSummaries = current.map((row, i) => {
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
      });
      this.setData({
        displayRoundSummaries,
        cardSlides: this._buildCardSlides(displayRoundSummaries)
      });
    }).catch((e) => console.warn('specialMove hydrate media', e));
  },

  onCardSwiperChange(e) {
    const index = e.detail && e.detail.current != null ? e.detail.current : 0;
    const maxIndex = Math.max(0, ((this.data.cardSlides || []).length || this.data.cardCount || 1) - 1);
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
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (result.ok !== true || !result.members || !result.members.length) return;

      const members = assignAvatarImages(result.members);
      const player = resolveCurrentPlayerFromRoom(
        members,
        result.roomState,
        this.data.initiatorPlayerIndex
      );
      // 非当前出牌玩家不得停留；本人身份尚未对上时先留在本页
      if (this._shouldLeaveForTurnChange(members, player, result.roomState)) {
        wx.showToast({ title: '请等待您的轮次', icon: 'none' });
        this._returnToGamepage(false);
        return;
      }
      const selectedProblem = resolveSelectedDesignProblem(getApp(), result);
      const roomState = result.roomState || {};
      const currentRound = roomState.currentRound != null ? roomState.currentRound : 1;
      const sessionId = roomState.sessionId || '';
      const turnId = result.view && result.view.session && result.view.session.activeTurn
        ? result.view.session.activeTurn.turnId
        : '';

      this.setData({
        members,
        avatarList: buildPartnerAvatarList(members),
        // 以房间态当前出牌玩家为准，发起人索引与之对齐
        currentPlayerIndex: player.currentPlayerIndex,
        initiatorPlayerIndex: player.currentPlayerIndex,
        currentRound,
        sessionId,
        turnId,
        isHost: result.isHost === true,
        isCurrentPlayer: !!player.isCurrentPlayer,
        canEndSilent: !!player.isCurrentPlayer,
        selectedProblemText: selectedProblem && selectedProblem.text ? selectedProblem.text : '',
        problemExpanded: false,
        problemTextOverflow: false
      }, () => {
        this._renderedTurnContext = Object.freeze({ sessionId, turnId });
        this._checkProblemTextOverflow();
        this._syncAvatarTimerFromRoom(roomState, currentRound, player.currentPlayerIndex);
        this._applyRoundSummaries(this._normalizeRoundSummaries(roomState, members));
        if (roomState.partnerSilentMode === true || this._joinSilent) {
          const startedAt = roomState.partnerSilentStartedAt || Date.now();
          if (this.data.viewMode !== 'silent') {
            this.setData({ viewMode: 'silent' }, () => this._jumpToActionCard());
          }
          if (!this.data.silentTimerActive) this.startSilentTimer(startedAt);
          else this._startSoundLevelSampling();
        }
      });
    } catch (e) {
      console.warn('specialMove loadRoomData', e);
    }
  },

  _ensureRecordAuth() {
    return new Promise((resolve) => {
      if (this._silentRecordDenied) {
        resolve(false);
        return;
      }
      wx.getSetting({
        success: (res) => {
          if (res.authSetting && res.authSetting['scope.record'] === true) {
            resolve(true);
            return;
          }
          if (res.authSetting && res.authSetting['scope.record'] === false) {
            wx.showModal({
              title: '需要麦克风权限',
              content: '静默模式要用本机麦克风监测是否低于 40dB',
              confirmText: '去设置',
              success: (modal) => {
                if (!modal.confirm) {
                  this._silentRecordDenied = true;
                  resolve(false);
                  return;
                }
                wx.openSetting({
                  success: (settingRes) => {
                    const granted = !!(settingRes.authSetting && settingRes.authSetting['scope.record']);
                    if (!granted) this._silentRecordDenied = true;
                    resolve(granted);
                  },
                  fail: () => {
                    this._silentRecordDenied = true;
                    resolve(false);
                  }
                });
              },
              fail: () => {
                this._silentRecordDenied = true;
                resolve(false);
              }
            });
            return;
          }
          wx.authorize({
            scope: 'scope.record',
            success: () => resolve(true),
            fail: () => {
              this._silentRecordDenied = true;
              resolve(false);
            }
          });
        },
        fail: () => {
          this._silentRecordDenied = true;
          resolve(false);
        }
      });
    });
  },

  /** 全员本机采麦驱动边框；房主额外广播瞬时 signal，给无麦端回退。 */
  async _startSoundLevelSampling() {
    if (this._recorderManager || this._silentRecordStarting) return;
    this._silentRecordStarting = true;
    const token = (this._soundSampleToken = (this._soundSampleToken || 0) + 1);
    try {
      const allowed = await this._ensureRecordAuth();
      if (token !== this._soundSampleToken) return;
      if (!allowed || !this.data.silentTimerActive) return;

      const manager = wx.getRecorderManager();
      this._recorderManager = manager;

      manager.onFrameRecorded((res) => {
        if (this._recorderManager !== manager || !this.data.silentTimerActive) return;
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
          const dbfs = rms > 0 ? 20 * Math.log10(rms / 32768) : -100;
          // 0 dBFS ≈ 94 dB SPL 经验映射，使 40 dB 落在半周中段
          const approxDb = Math.min(90, Math.max(0, dbfs + 94));
          const lv = Math.min(1, approxDb / 80);
          this._soundEma = this._soundEma == null
            ? lv
            : this._soundEma * 0.74 + lv * 0.26;
          const smooth = Math.min(1, Math.max(0, this._soundEma));
          if (Math.abs(smooth - (this.data.soundLevel || 0)) > 0.01) {
            this.setData({ soundLevel: smooth });
          }
          if (this.data.isHost) this._broadcastSilentSoundLevel(smooth);
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
    } finally {
      if (token === this._soundSampleToken) this._silentRecordStarting = false;
    }
  },

  _broadcastSilentSoundLevel(level) {
    const roomId = this.data.roomId || '';
    const sessionId = this.data.sessionId || '';
    const turnId = this.data.turnId || '';
    if (!roomId || !sessionId || !turnId || !this.data.silentTimerActive) return;
    const now = Date.now();
    if (this._lastSoundBroadcastAt && now - this._lastSoundBroadcastAt < 500) return;
    this._lastSoundBroadcastAt = now;
    wx.cloud.callFunction({
      name: 'roomSignal',
      data: { roomId, sessionId, turnId, signalType: 'PARTNER_SILENT_SOUND',
        value: Math.min(1, Math.max(0, Number(level) || 0)),
        clientContext: getRoomRequestContext() }
    }).catch(() => {});
  },

  _stopSoundLevelSampling() {
    this._soundSampleToken = (this._soundSampleToken || 0) + 1;
    this._silentRecordStarting = false;
    this._soundEma = null;
    if (this._recorderManager) {
      try { this._recorderManager.stop(); } catch (e) { /* ignore */ }
      this._recorderManager = null;
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || '',
      followNavigation: true,
      onSnapshot(result) {
        try {
        const members = result.members || this.data.members || [];
        const player = resolveCurrentPlayerFromRoom(
          members,
          result.roomState,
          this.data.currentPlayerIndex
        );
        // 轮次已切走：退出特殊行动页
        if (result.ok === true && members.length && this._shouldLeaveForTurnChange(members, player, result.roomState)) {
          this._stopStatePolling();
          wx.showToast({ title: '请等待您的轮次', icon: 'none' });
          this._returnToGamepage(false);
          return;
        }
            const state = result.roomState || {};
            // 房主开始表态：静默/master/求助运气等均须与房主进入同一讨论流程
            if (state.partnerGamePhase === 'discussion') {
              this._redirectToGamepageFromRoom(result);
              return true;
            }
            // 本机没采上麦时：回退房主广播的瞬时声贝
            if (
              !this._recorderManager
              && this.data.silentTimerActive
              && result.ephemeral && result.ephemeral.signals
              && result.ephemeral.signals.PARTNER_SILENT_SOUND
            ) {
              const lv = Math.min(1, Math.max(0, Number(result.ephemeral.signals.PARTNER_SILENT_SOUND.value) || 0));
              if (Math.abs(lv - (this.data.soundLevel || 0)) > 0.02) {
                this.setData({ soundLevel: lv });
              }
            }
            if (result.roomState) {
              this._syncAvatarTimerFromRoom(
                result.roomState,
                result.roomState.currentRound != null
                  ? result.roomState.currentRound
                  : this.data.currentRound,
                player.currentPlayerIndex
              );
              if (
                this.data.viewMode === 'silent'
                || this.data.viewMode === 'reverseRandom'
              ) {
                this._applyRoundSummaries(
                  this._normalizeRoundSummaries(result.roomState, members)
                );
              }
            }
            // 房间静默已结束（他人清场/换轮）：退出静默视图
            if (
              this.data.viewMode === 'silent'
              && this.data.silentTimerActive
              && state.partnerSilentMode === false
            ) {
              this._redirectToGamepageFromRoom(result);
              return true;
            }
            // 仍在 gamepage 且非 master：勿被旧 poll 打回 gamepage（防卡顿回跳）
            // 静默中同样留在 specialMove 控制页
            if (
              state.currentPage === 'gamepage'
              && state.partnerMasterMode !== true
            ) {
              return true;
            }
            return false;
      } catch (e) {
        console.warn('specialMove state poll', e);
      }
      }
    }).catch((e) => console.warn('specialMove roomSession', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
  },

  handleGoRoom() {
    return runPageInteraction(this, () => goRoomPage(this.data.roomId), {
      loadingText: '正在返回房间…'
    });
  },

  /** 点击设计问题：进入情境详情，navigateTo 保留特殊行动页实例与当前进度。 */
  handleViewSituation() {
    return runPageNavigation(this, async () => {
      const app = getApp();
      const roomId = this.data.roomId || (app.globalData && app.globalData.roomId) || '';
      if (!roomId) {
        wx.showToast({ title: '缺少房间信息', icon: 'none' });
        return null;
      }

      this._stopStatePolling();
      const problemText = (this.data.selectedProblemText || '').trim();
      const roomSession = getActiveRoomSession();
      const view = roomSession && roomSession.getView();
      const setup = view && view.session && view.session.setup;
      const selectedProblem = setup && setup.selectedProblem;
      const selectedBG = setup && setup.scenario;

      if (problemText && app.globalData) {
        app.globalData.selectedProblem = {
          id: selectedProblem && selectedProblem.contributionId || '',
          text: problemText
        };
        app.globalData.selectedBG = selectedBG || null;
      }

      let url = `/pages/main-pages/partnerMode/confirmBG/index?roomId=${encodeURIComponent(roomId)}&from=specialMove`;
      url += `&currentPlayerIndex=${encodeURIComponent(this.data.currentPlayerIndex || 1)}`;
      if (this.data.viewMode === 'silent') url += '&silent=1';
      if (problemText) url += `&problemText=${encodeURIComponent(problemText)}`;
      return {
        method: 'navigateTo',
        url,
        success: (res) => {
          try {
            const eventChannel = res && res.eventChannel;
            if (eventChannel && typeof eventChannel.emit === 'function') {
              eventChannel.emit('initGameDetail', {
                problemText,
                problemId: selectedProblem && selectedProblem.contributionId || '',
                selectedBG: selectedBG || null
              });
            }
          } catch (e) {
            console.warn('emit initGameDetail', e);
          }
        },
        fail: () => this._startStatePolling()
      };
    }, { loadingText: '正在查看设计问题…' });
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
      this._dismissChatKeyboard();
      this.setData({ showChat: false });
      return;
    }
    if (viewMode === 'reverseRandom') {
      this.setData({ viewMode: 'wheel' }, () => this._jumpToActionCard());
      return;
    }
    if (viewMode === 'silent') {
      if (!this._canEndSilent()) {
        return runPageInteraction(this, () => this._returnToGamepage(false), {
          loadingText: '正在返回游戏…'
        });
      }
      // 行动者返回转盘即取消静默：清房间态，避免其他人仍显示声贝边框
      this._stopSilentTimerUi();
      return runPageInteraction(this, async () => {
        await this._clearSilentRoomState();
        this.setData({
          viewMode: 'wheel'
        }, () => this._jumpToActionCard());
      }, { loadingText: '正在结束静默…' });
    }
    // 转盘选择页：返回脑暴主流程（未确认行动，不标记已使用）
    return runPageInteraction(this, () => this._returnToGamepage(false), {
      loadingText: '正在返回游戏…'
    });
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

  _turnContext() {
    const rendered = this._renderedTurnContext;
    return {
      sessionId: rendered && rendered.sessionId || this.data.sessionId || '',
      turnId: rendered && rendered.turnId || this.data.turnId || ''
    };
  },

  _canEndSilent() {
    return this.data.isCurrentPlayer === true;
  },

  handleConfirm() {
    const { viewMode, selectedAction } = this.data;

    if (viewMode === 'reverseRandom') return;

    if (!selectedAction) {
      wx.showToast({ title: '请选择特殊行动', icon: 'none' });
      return;
    }

    if (selectedAction === 'helpLuck') {
      // 预览可以返回转盘；只有确定采用或取消采用时才消耗本轮特殊行动。
      this.setData({ viewMode: 'reverseRandom', helpMethod: 'reverse' }, () => {
        this._jumpToActionCard();
        this.loadRoomData();
      });
      return;
    }

    if (selectedAction === 'silent') {
      return runPageInteraction(this, () => this.activateSilentMode(), {
        loadingText: '正在开启静默模式…'
      });
    }

    if (selectedAction === 'master') {
      return runPageInteraction(this, () => this.activateMasterMode(), {
        loadingText: '正在开启 MASTER 模式…'
      });
    }

    if (selectedAction === 'closing') {
      return runPageInteraction(this, () => this.activateClosing(), {
        loadingText: '正在进入收尾阶段…'
      });
    }

    wx.showToast({ title: '该特殊行动敬请期待', icon: 'none' });
  },

  async activateClosing() {
    const { roomId } = this.data;
    if (!roomId) return;
    if (this._activatingClosing) return;
    this._activatingClosing = true;

    try {
      const result = await dispatchRoomCommand(
        'USE_PARTNER_SPECIAL',
        { kind: 'CLOSING' },
        this._turnContext()
      );
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '状态同步失败', icon: 'none' });
        return;
      }
      const committed = await getCommittedSnapshotAfterCommand(result);
      if (!committed.ok) {
        wx.showToast({ title: '房间状态正在同步，请稍后重试', icon: 'none' });
        return;
      }
      // specialMove 是稳定 gamepage 上的本地叠层；权威 route 已由 Command 提交，
      // 正常页面栈只需关闭叠层，由下层 RoomShell 立即消费当前 Session View。
      await this._redirectToGamepageFromRoom(committed.snapshot);
    } finally {
      this._activatingClosing = false;
    }
  },

  async activateSilentMode() {
    const { roomId } = this.data;
    if (!roomId) return;
    if (this._activatingSilent) return;
    this._activatingSilent = true;

    try {
      const result = await dispatchRoomCommand(
        'USE_PARTNER_SPECIAL',
        { kind: 'SILENT' },
        this._turnContext()
      );
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '状态同步失败', icon: 'none' });
        return;
      }
      const session = getActiveRoomSession();
      const snapshot = session && session.getSnapshot();
      const startedAt = snapshot && snapshot.roomState && snapshot.roomState.partnerSilentStartedAt || Date.now();
      this.setData({ viewMode: 'silent' }, () => this._jumpToActionCard());
      this.startSilentTimer(startedAt);
      this.loadRoomData();
    } finally {
      this._activatingSilent = false;
    }
  },

  async activateMasterMode() {
    const { roomId } = this.data;
    if (!roomId) return;
    const result = await dispatchRoomCommand(
      'USE_PARTNER_SPECIAL',
      { kind: 'MASTER' },
      this._turnContext()
    );
    if (!result || result.ok !== true) {
      wx.showToast({ title: result && result.errMsg || '状态同步失败', icon: 'none' });
      return;
    }
    this._stopStatePolling();
    await this._returnToGamepage();
  },

  _clearSilentRoomState() {
    if (!this._canEndSilent()) return Promise.resolve();
    const roomId = this.data.roomId || '';
    if (!roomId) return Promise.resolve();
    return dispatchRoomCommand('END_PARTNER_SILENT', {}, this._turnContext()).catch(() => {});
  },

  handleCancelAdopt() {
    return runPageInteraction(this, () => this._cancelAdopt(), {
      loadingText: '正在返回游戏…'
    });
  },

  async _consumeHelpLuck() {
    const result = await dispatchRoomCommand(
      'USE_PARTNER_SPECIAL',
      { kind: 'HELP_LUCK' },
      this._turnContext()
    );
    if (!result || result.ok !== true) {
      wx.showToast({ title: result && result.errMsg || '状态同步失败', icon: 'none' });
      return false;
    }
    return true;
  },

  async _cancelAdopt() {
    if (!this.data.roomId) return;
    if (this.data.currentRound == null) {
      await this.loadRoomData();
    }
    // 取消采用：特殊行动仍记为已使用，回 gamepage 继续倒计时
    if (!await this._consumeHelpLuck()) return;
    this._stopStatePolling();
    await this._returnToGamepage();
  },

  handleAdoptDeck() {
    return runPageInteraction(this, () => this._adoptDeck(), {
      loadingText: '正在采用卡组…'
    });
  },

  async _adoptDeck() {
    if (!this.data.roomId) return;
    if (this.data.currentRound == null) {
      await this.loadRoomData();
    }
    if (!await this._consumeHelpLuck()) return;
    const app = getApp();
    if (!app.globalData) app.globalData = {};
    app.globalData.partnerAdoptDeckHint = {
      roomId: this.data.roomId,
      at: Date.now()
    };
    this._stopStatePolling();
    await this._returnToGamepage();
  },

  handleEndSilent() {
    return runPageInteraction(this, () => this._endSilent(), {
      loadingText: '正在结束静默…'
    });
  },

  async _endSilent() {
    if (this._endingSilent) return;
    if (!this._canEndSilent()) {
      this._stopSilentTimerUi();
      await this._returnToGamepage(false);
      return;
    }
    this._endingSilent = true;
    this._stopSilentTimerUi();
    try {
      if (!this.data.roomId) return;
      if (this.data.currentRound == null) {
        await this.loadRoomData();
      }
      await dispatchRoomCommand('END_PARTNER_SILENT', {}, this._turnContext());
      await this._returnToGamepage();
    } finally {
      this._endingSilent = false;
    }
  },

  handleCloseChat() {
    this._dismissChatKeyboard();
    if (!isAiFeatureEnabled()) {
      this.setData({ showChat: false });
      return;
    }
    return runPageInteraction(this, () => this._returnToGamepage(), {
      loadingText: '正在返回游戏…'
    });
  },

  onChatInput(e) {
    if (!isAiFeatureEnabled()) return;
    this.setData({ chatInput: e.detail.value || '' });
  },

  _resetChatKeyboardUi() {
    return {
      chatInputFocused: false,
      chatKeyboardHeight: 0,
      chatInputLiftStyle: ''
    };
  },

  _dismissChatKeyboard() {
    if (this._chatKeyboardZeroTimer) {
      clearTimeout(this._chatKeyboardZeroTimer);
      this._chatKeyboardZeroTimer = null;
    }
    this._chatInputNativeFocused = false;
    this.setData(this._resetChatKeyboardUi());
    if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') {
      wx.hideKeyboard({ fail() {} });
    }
  },

  onChatInputFocus() {
    this._chatInputNativeFocused = true;
    if (this._chatKeyboardZeroTimer) {
      clearTimeout(this._chatKeyboardZeroTimer);
      this._chatKeyboardZeroTimer = null;
    }
  },

  onChatInputBlur() {
    this._chatInputNativeFocused = false;
    if (this._chatKeyboardZeroTimer) clearTimeout(this._chatKeyboardZeroTimer);
    this._chatKeyboardZeroTimer = setTimeout(() => {
      this._chatKeyboardZeroTimer = null;
      if (this._chatInputNativeFocused) return;
      this.setData(this._resetChatKeyboardUi());
    }, 120);
  },

  onChatKeyboardHeightChange(e) {
    const height = keyboardHeightFromEvent(e);
    const active = this._chatInputNativeFocused || this.data.chatInputFocused;
    if (!active && height > 0) return;
    if (height <= 0 && active) return;
    this.setData({
      chatInputFocused: height > 0,
      chatKeyboardHeight: height,
      chatInputLiftStyle: buildKeyboardLiftStyle(height)
    });
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
  },

}, [
  'handleGoRoom',
  'handleViewSituation',
  'handleToggleProblemExpand',
  'handleGoBack',
  'onSelectAction',
  'onSelectHelpMethod',
  'handleRoundTimerExpire',
  'handleConfirm',
  'handleCancelAdopt',
  'handleAdoptDeck',
  'handleEndSilent',
  'handleSilentTimerExpire',
  'handleGoInspirationCenter',
  'onInspirationActionTap',
  'onInspirationInput',
  'onInspirationFocus',
  'onInspirationBlur',
  'onInspirationKeyboardHeightChange',
  'onCardSwiperChange',
  'onInnerScrollTouchStart',
  'onInnerScrollTouchEnd',
  'onRoundHistoryPreview',
  'handleCloseChat',
  'onChatInput',
  'onChatInputFocus',
  'onChatInputBlur',
  'onChatKeyboardHeightChange',
  'onTapSuggestion',
  'handleSendChat'
], {
  passthroughMethods: [
    'onInspirationFocus', 'onInspirationBlur', 'onInspirationKeyboardHeightChange',
    'onChatInputFocus', 'onChatInputBlur', 'onChatKeyboardHeightChange'
  ]
}));
