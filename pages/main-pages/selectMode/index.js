const AVATAR_IMAGES = [
  '/assets/avatar/Frame 2085662241.png',
  '/assets/avatar/Frame 2085662242.png',
  '/assets/avatar/Frame 2085662243.png',
  '/assets/avatar/Frame 2085662244.png',
  '/assets/avatar/Frame 2085662245.png',
  '/assets/avatar/Frame 2085662246.png',
  '/assets/avatar/Frame 2085662247.png',
  '/assets/avatar/Frame 2085662248.png',
  '/assets/avatar/Frame 2085662249.png'
];

const {
  DEFAULT_CATEGORIES,
  buildCategoriesFromBG,
  applyBGToApp,
  normalizeBG
} = require('../../../utils/scenarioCategories');

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
    goalLabels: ['数量优先', '质量优先']
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
    this._updateRoomState('selectMode');
  },

  onShow() {
    if (this.data.roomId) {
      this.loadRoomData();
    }
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

      const avatarList = (result.members || []).map((m, i) => {
        const idx = m.avatarIndex != null ? m.avatarIndex : i % AVATAR_IMAGES.length;
        return {
          id: m.userId || String(m.playerIndex),
          nickName: m.nickName || `玩家${m.playerIndex}`,
          avatarImage: AVATAR_IMAGES[idx % AVATAR_IMAGES.length],
          isMe: m.isMe === true
        };
      });
      const me = avatarList.find((item) => item.isMe);
      const roomBG = normalizeBG(result.selectedBG)
        || normalizeBG(getApp().globalData.selectedBG);

      if (roomBG) {
        this._syncCategoriesFromBG(roomBG);
      }

      this.setData({
        workshopName: result.workshopName || '脑暴工作坊',
        avatarList,
        currentUser: me ? me.id : null
      });
    } catch (e) {
      console.warn('selectMode loadRoomData', e);
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
    wx.navigateBack();
  }
});
