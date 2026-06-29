const { listProblems, updateProblemText } = require('../../../utils/roomDesignProblems');
const {
  DEFAULT_CATEGORIES,
  buildCategoriesFromBG,
  applyBGToApp,
  normalizeBG
} = require('../../../utils/scenarioCategories');
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

Page({
  data: {
    roomId: '',
    workshopName: '脑暴工作坊',
    avatarList: [],
    currentUser: null,
    isHost: false,
    categories: DEFAULT_CATEGORIES,
    problems: [],
    selectedProblemId: null,
    countdown: 5,
    editingProblemId: ''
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (roomId) {
      getApp().globalData.roomId = roomId;
    }
    this.setData({ roomId });
    this._syncCategoriesFromBG(normalizeBG(getApp().globalData.selectedBG));
    this.loadRoomData();
    this.loadSubmittedProblems();
    this.startCountdown();
    this.startProblemCheck();
  },

  onShow() {
    this.loadSubmittedProblems();
    if (this.data.roomId) {
      this.loadRoomData();
    }
  },

  onUnload() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.problemCheckTimer) clearInterval(this.problemCheckTimer);
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
      const isHost = result.isHost === true;
      const roomBG = normalizeBG(result.selectedBG)
        || normalizeBG(getApp().globalData.selectedBG);

      if (roomBG) {
        this._syncCategoriesFromBG(roomBG);
      }

      this.setData({
        workshopName: result.workshopName || '脑暴工作坊',
        avatarList,
        currentUser: me ? me.id : null,
        isHost
      });

      if (isHost) {
        this._updateRoomState('selectProblem');
        this._stopStatePolling();
      } else {
        this._startStatePolling();
      }
    } catch (e) {
      console.warn('loadRoomData', e);
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
        if (result.ok !== true || !result.roomState) return;
        navigateByRoomState(result.roomState.currentPage, result.roomState, roomId);
      } catch (e) {
        console.warn('selectProblem state poll', e);
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

  startCountdown() {
    this.countdownTimer = setInterval(() => {
      if (this.data.countdown > 0) {
        this.setData({ countdown: this.data.countdown - 1 });
      } else {
        clearInterval(this.countdownTimer);
      }
    }, 1000);
  },

  async loadSubmittedProblems() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    try {
      const problemList = await listProblems(roomId);
      const newProblems = problemList.map((item) => ({
        id: item.id,
        text: item.text,
        selected: item.id === this.data.selectedProblemId,
        isAISummary: false
      }));

      if (newProblems.length === 0) return;

      const currentIds = this.data.problems.map((p) => p.id);
      const newIds = newProblems.map((p) => p.id);
      const changed = newProblems.length !== this.data.problems.length
        || newIds.some((id) => !currentIds.includes(id));

      if (!changed) return;

      let selectedProblemId = this.data.selectedProblemId;
      if (!selectedProblemId || !newIds.includes(selectedProblemId)) {
        selectedProblemId = newProblems[0].id;
      }

      const problems = newProblems.map((item) => ({
        ...item,
        selected: item.id === selectedProblemId
      }));

      this.setData({ problems, selectedProblemId });
    } catch (e) {
      console.warn('loadSubmittedProblems', e);
    }
  },

  startProblemCheck() {
    if (this.problemCheckTimer) clearInterval(this.problemCheckTimer);
    this.problemCheckTimer = setInterval(() => {
      this.loadSubmittedProblems();
    }, 1500);
  },

  selectCategory(e) {
    if (!this.data.isHost) return;
    const categoryId = e.currentTarget.dataset.id;
    const categories = this.data.categories.map((item) => ({
      ...item,
      selected: item.id === categoryId
    }));
    this.setData({ categories });
  },

  selectProblem(e) {
    if (!this.data.isHost) return;
    const problemId = e.currentTarget.dataset.id;
    const problems = this.data.problems.map((item) => ({
      ...item,
      selected: item.id === problemId
    }));
    this.setData({ problems, selectedProblemId: problemId });
  },

  onEditProblem(e) {
    if (!this.data.isHost) return;
    const problemId = e.currentTarget.dataset.id;
    this.setData({ editingProblemId: problemId });
  },

  onProblemInput(e) {
    const id = e.currentTarget.dataset.id;
    const value = e.detail.value;
    const problems = this.data.problems.map((item) => (
      item.id === id ? { ...item, text: value } : item
    ));
    this.setData({ problems });
  },

  async onProblemBlur(e) {
    if (!this.data.isHost) return;
    const id = e.currentTarget.dataset.id;
    const text = (e.detail.value || '').trim();
    this.setData({ editingProblemId: '' });
    if (!id || !text) return;

    const problems = this.data.problems.map((item) => (
      item.id === id ? { ...item, text } : item
    ));
    this.setData({ problems });

    try {
      await updateProblemText(id, text);
    } catch (err) {
      console.error('更新设计问题失败', err);
      wx.showToast({ title: '更新失败', icon: 'none' });
    }
  },

  async confirmSelection() {
    if (!this.data.isHost) return;
    if (!this.data.selectedProblemId) {
      wx.showToast({ title: '请选择一个设计问题', icon: 'none' });
      return;
    }

    const problem = this.data.problems.find((p) => p.id === this.data.selectedProblemId);
    getApp().globalData.selectedProblem = problem;

    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    await this._updateRoomState('selectPlayer');

    const query = roomId ? `?roomId=${encodeURIComponent(roomId)}` : '';
    wx.navigateTo({
      url: `/pages/main-pages/selectPlayer/index${query}`
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
