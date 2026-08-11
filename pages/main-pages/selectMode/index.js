const { resolveSelectedDesignProblem } = require('../../../utils/selectedDesignProblem');
const { buildAvatarList } = require('../../../utils/avatars');
const scenarioCategories = require('../../../utils/scenarioCategories');
const { isAwaitPage } = require('../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');
const { goRoomPage } = require('../../../utils/goRoomPage');
const { safeNavigateBack } = require('../../../utils/pageNavigate');

const {
  DEFAULT_CATEGORIES,
  buildCategoriesFromBG,
  applyBGToApp,
  normalizeBG
} = scenarioCategories;

Page({
  data: {
    roomId: '',
    workshopName: '脑暴工作坊',
    avatarList: [],
    currentUser: null,
    categories: DEFAULT_CATEGORIES,
    selectedProblem: null,
    brainstormModes: [
      {
        id: 1,
        title: '全新创意',
        description: '所有玩家从0开始，共同进行脑暴',
        selected: true,
        disabled: false
      },
      {
        id: 2,
        title: '残局模式',
        description: '在现有方案基础上，共同进行脑暴',
        selected: false,
        disabled: true
      },
      {
        id: 3,
        title: '各自为战',
        description: '每个人先拼出一组表达式（5张牌）',
        selected: false,
        disabled: true
      }
    ],
    selectedModeId: 1,
    goalSliderValue: 0,
    goalLabels: ['数量优先', '质量优先'],
    isHost: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (roomId) {
      getApp().globalData.roomId = roomId;
    }
    this.setData({ roomId });

    const app = getApp();
    if (app.globalData.selectedProblem) {
      this.setData({ selectedProblem: app.globalData.selectedProblem });
    }

    this._syncCategoriesFromBG(normalizeBG(app.globalData.selectedBG));
    this.loadRoomData();
  },

  onShow() {
    if (this.data.roomId) {
      this.loadRoomData();
    }
  },

  onUnload() {
    this._stopStatePolling();
  },

  _syncCategoriesFromBG(bg) {
    const normalized = normalizeBG(bg);
    if (normalized) {
      applyBGToApp(normalized);
    }
    this.setData({ categories: buildCategoriesFromBG(normalized) });
  },

  async loadRoomData() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) return;

      const avatarList = buildAvatarList(result.members || []);
      const me = avatarList.find((item) => item.isMe);
      const roomBG = normalizeBG(result.selectedBG)
        || normalizeBG(getApp().globalData.selectedBG);

      if (roomBG) {
        this._syncCategoriesFromBG(roomBG);
      }

      const isHost = result.isHost === true;
      const selectedProblem = resolveSelectedDesignProblem(getApp(), result);

      this.setData({
        workshopName: result.workshopName || '脑暴工作坊',
        avatarList,
        currentUser: me ? me.id : null,
        isHost,
        selectedProblem: selectedProblem || this.data.selectedProblem
      });

      if (isHost) {
        this._updateRoomState('selectMode');
        this._stopStatePolling();
      } else {
        const roomState = result.roomState || {};
        const page = roomState.currentPage || 'selectMode';
        followSubScreenRoomPoll(result, roomId);
        if (isAwaitPage(page)) {
          return;
        }
        this._startStatePolling();
      }
    } catch (e) {
      console.warn('selectMode loadRoomData', e);
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        followSubScreenRoomPoll(result, roomId);
      } catch (e) {
        console.warn('selectMode state poll', e);
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

  async _updateRoomState(currentPage) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: { roomId, currentPage }
      });
    } catch (e) {
      console.warn('updateRoomState', e);
    }
  },

  selectCategory(e) {
    const categoryId = e.currentTarget.dataset.id;
    const categories = this.data.categories.map((item) => ({
      ...item,
      selected: item.id === categoryId
    }));
    this.setData({ categories });
  },

  selectMode(e) {
    const modeId = e.currentTarget.dataset.id;
    const target = this.data.brainstormModes.find((item) => item.id === modeId);
    if (target && target.disabled) return;
    const brainstormModes = this.data.brainstormModes.map((item) => ({
      ...item,
      selected: item.id === modeId
    }));
    this.setData({ brainstormModes, selectedModeId: modeId });
  },

  onSliderChange(e) {
    this.setData({ goalSliderValue: e.detail.value });
  },

  async nextStep() {
    if (!this.data.selectedModeId) {
      wx.showToast({ title: '请选择脑暴模式', icon: 'none' });
      return;
    }

    const selectedMode = this.data.brainstormModes.find((m) => m.id === this.data.selectedModeId);
    getApp().globalData.selectedMode = {
      mode: selectedMode,
      goalValue: this.data.goalSliderValue
    };

    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    const selectPlayerUrl = roomId
      ? `/pages/main-pages/selectPlayer/index?roomId=${encodeURIComponent(roomId)}`
      : '/pages/main-pages/selectPlayer/index';

    await this._updateRoomState('selectPlayer');
    wx.navigateTo({ url: selectPlayerUrl });
  },

  goBack() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    safeNavigateBack({
      expectedPrev: [
        'pages/main-pages/selectProblem/index',
        'pages/main-pages/modeIndex/index'
      ],
      fallbackUrl: roomId
        ? `/pages/main-pages/selectProblem/index?roomId=${encodeURIComponent(roomId)}`
        : '/pages/main-pages/selectProblem/index'
    });
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
