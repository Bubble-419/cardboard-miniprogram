const { assignAvatarImages } = require('../../../../utils/avatars');
const { buildGamepageUrl } = require('../../../../utils/modeRoutes');
const { safeOpenUrl } = require('../../../../utils/subAwaitRoutes');
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

const HELP_METHOD_OPTIONS = [
  { id: 'reverse', title: '反面随机拼', desc: '将卡牌置于反面，随机拼成卡组' },
  { id: 'outside', title: '求助场外', desc: '限时求助场外包括AI' }
];

Page({
  data: {
    roomId: '',
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
    suggestedQuestions: SUGGESTED_QUESTIONS,
    randomDeckCards: [1, 2, 3, 4, 5]
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
    this.setData({ roomId, currentPlayerIndex });
    this.loadRoomData();
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
        this.data.currentPlayerIndex
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
      this.setData({ viewMode: 'helpLuck' });
      return;
    }
    if (viewMode === 'helpLuck') {
      this.setData({ viewMode: 'wheel' });
      return;
    }
    wx.navigateBack();
  },

  onSelectAction(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;

    const { viewMode } = this.data;
    if (viewMode === 'helpLuck' && id !== 'helpLuck') {
      this.setData({ selectedAction: id, viewMode: 'wheel' });
      return;
    }
    this.setData({ selectedAction: id });
  },

  onSelectHelpMethod(e) {
    const method = e.currentTarget.dataset.method;
    if (!method) return;
    this.setData({ helpMethod: method });
  },

  handleConfirm() {
    const { viewMode, selectedAction, helpMethod } = this.data;

    if (viewMode === 'wheel') {
      if (!selectedAction) {
        wx.showToast({ title: '请选择特殊行动', icon: 'none' });
        return;
      }
      if (selectedAction === 'helpLuck') {
        this.setData({
          viewMode: 'helpLuck',
          helpMethod: 'outside',
          selectedAction: 'helpLuck'
        });
        return;
      }
      wx.showToast({ title: '该特殊行动敬请期待', icon: 'none' });
      return;
    }

    if (viewMode === 'helpLuck') {
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
    }
  },

  handleCancelAdopt() {
    this.setData({ viewMode: 'helpLuck' });
  },

  handleAdoptDeck() {
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
