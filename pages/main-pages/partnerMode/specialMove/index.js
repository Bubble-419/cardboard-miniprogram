const { assignAvatarImages } = require('../../../../utils/avatars');
const { buildGamepageUrl, buildClosingStatementUrl } = require('../../../../utils/modeRoutes');
const { safeOpenUrl, navigateByRoomState } = require('../../../../utils/subAwaitRoutes');
const { resolveSelectedDesignProblem } = require('../../../../utils/selectedDesignProblem');
const { buildPartnerAvatarList, resolveCurrentPlayerFromRoom } = require('../../../../utils/partnerPlayerTurn');

const WHEEL_ACTIONS = [
  { id: 'helpLuck', label: '求助AI或运气', zone: 'left' },
  { id: 'silent', label: '全场静默', zone: 'right' },
  { id: 'master', label: 'MASTER', sub: '开启模式', zone: 'top' },
  { id: 'closing', label: '收尾阶段', sub: '进入', zone: 'bottom' }
];

// 斜向四等分：扇形中心分别朝上 / 右 / 下 / 左（与 Figma 一致）
const WHEEL_PIECES = [
  { id: 'master', rotate: -135 },
  { id: 'silent', rotate: -45 },
  { id: 'closing', rotate: 45 },
  { id: 'helpLuck', rotate: 135 }
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
  '如果所有玩家表态通过，将强制结束游戏'
];

const HELP_METHOD_OPTIONS = [
  { id: 'reverse', title: '反面随机拼', desc: '将卡牌置于反面，随机拼成卡组' },
  { id: 'outside', title: '求助场外', desc: '限时求助场外包括AI' }
];

Page({
  data: {
    roomId: '',
    initiatorPlayerIndex: 1,
    currentPlayerIndex: 1,
    avatarList: [],
    selectedProblemText: '',
    viewMode: 'wheel',
    selectedAction: '',
    helpMethod: 'outside',
    showChat: false,
    chatInput: '',
    chatMessages: [],
    wheelActions: WHEEL_ACTIONS,
    wheelPieces: WHEEL_PIECES,
    helpMethodOptions: HELP_METHOD_OPTIONS,
    silentHintLines: SILENT_HINT_LINES,
    masterHintLines: MASTER_HINT_LINES,
    closingHintLines: CLOSING_HINT_LINES,
    silentRemainingSec: SILENT_DURATION_SEC,
    silentTimerText: '05:00',
    suggestedQuestions: SUGGESTED_QUESTIONS,
    randomDeckCards: [1, 2, 3, 4, 5]
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
    if (this.data.roomId) {
      this._startStatePolling();
    }
  },

  onHide() {
    this._stopStatePolling();
  },

  onUnload() {
    this.clearSilentTimer();
    this._stopStatePolling();
  },

  formatSilentTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  startSilentTimer() {
    this.clearSilentTimer();
    let remaining = SILENT_DURATION_SEC;
    this.setData({
      silentRemainingSec: remaining,
      silentTimerText: this.formatSilentTime(remaining)
    });
    this._silentTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.clearSilentTimer();
        this.handleEndSilent();
        return;
      }
      this.setData({
        silentRemainingSec: remaining,
        silentTimerText: this.formatSilentTime(remaining)
      });
    }, 1000);
  },

  clearSilentTimer() {
    if (this._silentTimer) {
      clearInterval(this._silentTimer);
      this._silentTimer = null;
    }
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
      const selectedProblem = resolveSelectedDesignProblem(getApp(), result);

      this.setData({
        members,
        avatarList: buildPartnerAvatarList(members),
        currentPlayerIndex: player.currentPlayerIndex,
        selectedProblemText: selectedProblem && selectedProblem.text ? selectedProblem.text : ''
      });
    } catch (e) {
      console.warn('specialMove loadRoomData', e);
    }
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName, extra) {
    const roomId = this.data.roomId || '';
    if (!roomId) return false;
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
      return result.ok === true;
    } catch (e) {
      console.warn('updateRoomState', e);
      return false;
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
        if (page === 'gamepage' && result.roomState.partnerMasterMode !== true) {
          return;
        }
        navigateByRoomState(page, result.roomState, roomId);
      } catch (e) {
        console.warn('specialMove state poll', e);
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

  handleGoRoom() {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    wx.navigateTo({
      url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
    });
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
      this.clearSilentTimer();
      this.setData({
        viewMode: 'wheel',
        silentRemainingSec: SILENT_DURATION_SEC,
        silentTimerText: this.formatSilentTime(SILENT_DURATION_SEC)
      });
      return;
    }
    wx.navigateBack();
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
    const { viewMode, selectedAction, helpMethod } = this.data;

    if (viewMode === 'reverseRandom') return;

    if (!selectedAction) {
      wx.showToast({ title: '请选择特殊行动', icon: 'none' });
      return;
    }

    if (selectedAction === 'helpLuck') {
      if (helpMethod === 'reverse') {
        this.setData({ viewMode: 'reverseRandom' });
        return;
      }
      this.setData({
        showChat: true,
        chatMessages: [{
          id: 'welcome',
          role: 'assistant',
          text: '有什么可以帮您？您仅能提问三次（AI 功能即将上线）'
        }]
      });
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

    const ok = await this._updateRoomState('closingStatement', null, null, {
      partnerGamePhase: 'closing',
      partnerMasterMode: false,
      resetClosingVotes: true
    });
    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }

    this._stopStatePolling();
    safeOpenUrl(buildClosingStatementUrl(roomId));
  },

  async activateMasterMode() {
    const { roomId, initiatorPlayerIndex, members } = this.data;
    if (!roomId) return;

    const initiator = (members || []).find((m) => m.playerIndex === initiatorPlayerIndex);
    const initiatorName = initiator
      ? (initiator.nickName || `玩家${initiatorPlayerIndex}`)
      : `玩家${initiatorPlayerIndex}`;

    const ok = await this._updateRoomState('gamepage', initiatorPlayerIndex, initiatorName, {
      partnerMasterMode: true
    });
    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }

    this._stopStatePolling();
    safeOpenUrl(buildGamepageUrl(roomId, initiatorPlayerIndex, 'partner'));
  },

  handleCancelAdopt() {
    this.setData({ viewMode: 'wheel' });
  },

  handleAdoptDeck() {
    const { roomId, currentPlayerIndex } = this.data;
    if (!roomId) return;
    safeOpenUrl(buildGamepageUrl(roomId, currentPlayerIndex, 'partner'));
  },

  handleEndSilent() {
    this.clearSilentTimer();
    const { roomId, currentPlayerIndex } = this.data;
    if (!roomId) return;
    safeOpenUrl(buildGamepageUrl(roomId, currentPlayerIndex, 'partner'));
  },

  handleCloseChat() {
    this.setData({ showChat: false });
  },

  onChatInput(e) {
    this.setData({ chatInput: e.detail.value || '' });
  },

  onTapSuggestion(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    this.setData({ chatInput: text });
  },

  handleSendChat() {
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
