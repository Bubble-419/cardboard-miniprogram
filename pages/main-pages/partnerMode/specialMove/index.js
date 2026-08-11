const { assignAvatarImages } = require('../../../../utils/avatars');
const { buildGamepageUrl, buildClosingStatementUrl } = require('../../../../utils/modeRoutes');
const { safeOpenUrl, navigateByRoomState } = require('../../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const { resolveSelectedDesignProblem } = require('../../../../utils/selectedDesignProblem');
const { buildPartnerAvatarList, resolveCurrentPlayerFromRoom } = require('../../../../utils/partnerPlayerTurn');
const { markPartnerSpecialMoveUsed } = require('../../../../utils/partnerSpecialMove');
const { goRoomPage } = require('../../../../utils/goRoomPage');
const { openUrl } = require('../../../../utils/pageNavigate');
const { isAiFeatureEnabled } = require('../../../../utils/aiFeature');

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
    inspirationDraftText: '',
    inspirationInputFocused: false,
    inspirationKeyboardHeight: 0,
    inspirationLiftStyle: '',
    inspirationHasText: false,
    suggestedQuestions: SUGGESTED_QUESTIONS,
    reverseSteps: REVERSE_STEPS
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const initiatorPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10)
      : 1;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    getApp().globalData.roomId = roomId;
    this.setData({ roomId, initiatorPlayerIndex, currentPlayerIndex: initiatorPlayerIndex });
    this.loadRoomData();
  },

  onShow() {
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
  },

  onUnload() {
    this._unbindInspirationKeyboard();
    this.clearSilentTimer();
    this._stopStatePolling();
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

  _returnToGamepage(markUsed = true) {
    const { roomId, currentPlayerIndex, initiatorPlayerIndex } = this.data;
    const idx = currentPlayerIndex != null ? currentPlayerIndex : initiatorPlayerIndex;
    const target = buildGamepageUrl(
      roomId,
      idx,
      'partner',
      markUsed ? { specialMoveUsed: true } : {}
    );
    const { safeNavigateBack } = require('../../../../utils/pageNavigate');
    // 未标记已使用时可安全 pop；带 specialMoveUsed query 时必须 openUrl
    if (!markUsed) {
      safeNavigateBack({
        expectedPrev: 'pages/main-pages/partnerMode/gamepage/index',
        fallbackUrl: target
      });
      return;
    }
    safeOpenUrl(target);
  },

  formatSilentTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  startSilentTimer() {
    this.clearSilentTimer();
    const startedAt = Date.now();
    this.setData({
      silentStartedAt: startedAt,
      silentTimerActive: true
    });
    // 兜底：边框倒计时 + 结束动效之后仍未回调时强制结束
    this._silentTimer = setTimeout(() => {
      this._silentTimer = null;
      this.handleEndSilent();
    }, (SILENT_DURATION_SEC + 4) * 1000);
  },

  clearSilentTimer() {
    if (this._silentTimer) {
      clearTimeout(this._silentTimer);
      this._silentTimer = null;
    }
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
    const roomId = this.data.roomId || '';
    const seq = this.data.brainstormSessionSeq != null ? this.data.brainstormSessionSeq : 0;
    let url = '/pages/inspiration/index?scope=workshop';
    if (roomId) {
      url += `&roomId=${encodeURIComponent(roomId)}&brainstormSessionSeq=${seq}`;
    }
    wx.navigateTo({ url });
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

  async loadRoomData() {
    const roomId = this.data.roomId;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.members || !result.members.length) return;

      const members = assignAvatarImages(result.members);
      const player = resolveCurrentPlayerFromRoom(
        members,
        result.roomState,
        this.data.initiatorPlayerIndex
      );
      // 非当前出牌玩家不得停留在特殊行动页（含房主代进）
      if (!player.isCurrentPlayer) {
        wx.showToast({ title: '请等待您的轮次', icon: 'none' });
        this._returnToGamepage(false);
        return;
      }
      const selectedProblem = resolveSelectedDesignProblem(getApp(), result);

      this.setData({
        members,
        avatarList: buildPartnerAvatarList(members),
        // 以房间态当前出牌玩家为准，发起人索引与之对齐
        currentPlayerIndex: player.currentPlayerIndex,
        initiatorPlayerIndex: player.currentPlayerIndex,
        currentRound: result.roomState && result.roomState.currentRound != null
          ? result.roomState.currentRound
          : 1,
        brainstormSessionSeq: result.roomState && result.roomState.brainstormSessionSeq != null
          ? result.roomState.brainstormSessionSeq
          : 0,
        selectedProblemText: selectedProblem && selectedProblem.text ? selectedProblem.text : '',
        problemExpanded: false,
        problemTextOverflow: false
      }, () => {
        this._checkProblemTextOverflow();
      });
    } catch (e) {
      console.warn('specialMove loadRoomData', e);
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
      if (extra && extra.partnerGamePhase != null) {
        data.partnerGamePhase = extra.partnerGamePhase;
      }
      if (extra && extra.resetClosingVotes === true) {
        data.resetClosingVotes = true;
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
        if (result.ok === true && members.length && !player.isCurrentPlayer) {
          this._stopStatePolling();
          wx.showToast({ title: '请等待您的轮次', icon: 'none' });
          this._returnToGamepage(false);
          return;
        }
        followSubScreenRoomPoll(result, roomId, {
          beforeNavigate: (pollResult, page) => {
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
            if (page === 'gamepage' && pollResult.roomState.partnerMasterMode !== true) {
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
      this.setData({ viewMode: 'wheel' });
      return;
    }
    if (viewMode === 'silent') {
      this._stopSilentTimerUi();
      this.setData({
        viewMode: 'wheel'
      });
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
      this.setData({ viewMode: 'reverseRandom', helpMethod: 'reverse' });
      return;
    }

    if (selectedAction === 'silent') {
      this.setData({ viewMode: 'silent' });
      this.startSilentTimer();
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
      const result = await this._updateRoomState('closingStatement', null, null, {
        partnerGamePhase: 'closing',
        partnerMasterMode: false,
        resetClosingVotes: true
      });
      if (!result || result.ok !== true) {
        wx.showToast({ title: '状态同步失败', icon: 'none' });
        return;
      }

      const url = buildClosingStatementUrl(roomId, {
        closingVoteSessionId: result.closingVoteSessionId || '',
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
      partnerMasterMode: true
    });
    if (!result || result.ok !== true) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }

    this._stopStatePolling();
    this._returnToGamepage();
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
