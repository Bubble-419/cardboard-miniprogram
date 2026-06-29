const {
  getSubmitStatus,
  submitProblem: saveProblem
} = require('../../../utils/roomDesignProblems');
const { navigateByRoomState } = require('../../../utils/subAwaitRoutes');

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

const DEFAULT_CATEGORIES = [
  { id: 1, key: 'scene', name: '场景', icon: '/assets/icons/display.png', selected: false },
  { id: 2, key: 'user', name: '用户', icon: '/assets/icons/wearable.png', selected: false },
  { id: 3, key: 'platform', name: '平台', icon: '/assets/icons/passenger.png', selected: false },
  { id: 4, key: 'function', name: '功能', icon: '/assets/icons/share.png', selected: false }
];

Page({
  data: {
    roomId: '',
    workshopName: '脑暴工作坊',
    avatarList: [],
    currentUser: null,
    myPlayerIndex: null,
    myNickName: '',
    categories: DEFAULT_CATEGORIES,
    problemText: '',
    maxLength: 50,
    selectedCategory: null,
    hasSubmitted: false,
    submittedCount: 0,
    totalMembers: 0,
    isSubmitting: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    getApp().globalData.roomId = roomId;
    this.setData({ roomId });
    this._applySelectedBGCategories();
    this.loadRoomData().then(() => {
      this.refreshSubmitStatus();
      this._startPolling();
    });
  },

  onShow() {
    this.refreshSubmitStatus();
  },

  onUnload() {
    this._stopPolling();
  },

  _applySelectedBGCategories() {
    const bg = getApp().globalData.selectedBG;
    if (!bg) return;
    const categories = DEFAULT_CATEGORIES.map((item) => {
      let name = item.name;
      if (item.key === 'scene' && bg.scene) name = bg.scene;
      if (item.key === 'user' && bg.user) name = bg.user;
      if (item.key === 'platform' && bg.platform) name = bg.platform;
      if (item.key === 'function' && bg.function) name = bg.function;
      return { ...item, name };
    }).filter((item) => !(item.key === 'platform' && !bg.platform));
    this.setData({ categories });
  },

  async loadRoomData() {
    const roomId = this.data.roomId;
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
      const me = (result.members || []).find((m) => m.isMe);
      this.setData({
        workshopName: result.workshopName || '脑暴工作坊',
        avatarList,
        currentUser: me ? (me.userId || String(me.playerIndex)) : null,
        myPlayerIndex: me ? me.playerIndex : null,
        myNickName: me ? (me.nickName || `玩家${me.playerIndex}`) : '',
        totalMembers: result.memberCount || avatarList.length
      });
    } catch (e) {
      console.warn('loadRoomData', e);
    }
  },

  async refreshSubmitStatus() {
    const roomId = this.data.roomId;
    if (!roomId || this.data.myPlayerIndex == null) return;
    try {
      const status = await getSubmitStatus(
        roomId,
        this.data.myPlayerIndex,
        this.data.totalMembers
      );
      this.setData({
        submittedCount: status.submittedCount || 0,
        totalMembers: status.totalMembers || this.data.totalMembers,
        hasSubmitted: status.hasSubmitted === true,
        problemText: status.hasSubmitted ? (status.myProblemText || '') : this.data.problemText
      });
      if (status.allSubmitted) {
        this._goSelectProblem();
      }
    } catch (e) {
      console.warn('refreshSubmitStatus', e);
    }
  },

  _startPolling() {
    this._stopPolling();
    const poll = async () => {
      if (this.data.myPlayerIndex != null) {
        await this.refreshSubmitStatus();
      }
      const roomId = this.data.roomId;
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        if (result.ok !== true || !result.roomState) return;
        const page = (result.roomState.currentPage || '').toLowerCase();
        if (page === 'selectproblem') {
          this._goSelectProblem();
        } else {
          navigateByRoomState(page, result.roomState, roomId);
        }
      } catch (e) {
        console.warn('submitProblem poll', e);
      }
    };
    poll();
    this._pollTimer = setInterval(poll, 1500);
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  _goSelectProblem() {
    if (this._navigating) return;
    this._navigating = true;
    const roomIdEnc = encodeURIComponent(this.data.roomId);
    wx.redirectTo({
      url: `/pages/main-pages/selectProblem/index?roomId=${roomIdEnc}`,
      complete: () => {
        this._navigating = false;
      }
    });
  },

  async _updateRoomState(currentPage) {
    const roomId = this.data.roomId;
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
    this.setData({ categories, selectedCategory: categoryId });
  },

  onInput(e) {
    this.setData({ problemText: e.detail.value });
  },

  async submitProblem() {
    if (this.data.hasSubmitted || this.data.isSubmitting) return;
    const problemText = (this.data.problemText || '').trim();
    if (!problemText) {
      wx.showToast({ title: '请输入设计问题', icon: 'none' });
      return;
    }
    if (problemText.length > this.data.maxLength) {
      wx.showToast({ title: `问题不能超过${this.data.maxLength}字`, icon: 'none' });
      return;
    }
    if (this.data.myPlayerIndex == null) {
      wx.showToast({ title: '未获取到玩家信息', icon: 'none' });
      return;
    }

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '提交中...', mask: true });
    try {
      await saveProblem(this.data.roomId, {
        playerIndex: this.data.myPlayerIndex,
        nickName: this.data.myNickName,
        text: problemText
      });

      const status = await getSubmitStatus(
        this.data.roomId,
        this.data.myPlayerIndex,
        this.data.totalMembers
      );

      wx.hideLoading();
      wx.showToast({ title: '提交成功', icon: 'success', duration: 1200 });
      this.setData({
        hasSubmitted: true,
        submittedCount: status.submittedCount || 0,
        totalMembers: status.totalMembers || this.data.totalMembers
      });

      if (status.allSubmitted) {
        await this._updateRoomState('selectProblem');
        setTimeout(() => this._goSelectProblem(), 500);
      }
    } catch (e) {
      wx.hideLoading();
      console.error('submitProblem', e);
      wx.showToast({ title: e.message || '提交失败，请重试', icon: 'none' });
    } finally {
      this.setData({ isSubmitting: false });
    }
  }
});
