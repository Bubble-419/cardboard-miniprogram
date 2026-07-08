const { listProblems, updateProblemText } = require('../../../utils/roomDesignProblems');
const {
  DEFAULT_CATEGORIES,
  buildCategoriesFromBG,
  applyBGToApp,
  normalizeBG
} = require('../../../utils/scenarioCategories');
const { navigateByRoomState, isAwaitPage } = require('../../../utils/subAwaitRoutes');

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
    editingProblemId: '',
    textareaHeights: {},
    navbarPaddingTop: 0,
    scrollHeight: 0,
    contentPaddingTop: 0,
    myAvatar: '',
    otherAvatars: []
  },

  onLoad(options) {
    let navbarPaddingTop = 44;
    let screenHeight = 750;
    try {
      const sys = wx.getSystemInfoSync();
      navbarPaddingTop = (sys.statusBarHeight || 0) + 8;
      screenHeight = sys.windowHeight || 750;
      // 记录设备宽度用于 rpx→px 换算（textarea 高度计算）
      this._windowWidth = sys.windowWidth || 375;
    } catch (e) {
      console.warn('getSystemInfo', e);
    }
    const scrollHeight = screenHeight - navbarPaddingTop;
    const contentPaddingTop = navbarPaddingTop + 30;

    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (roomId) {
      getApp().globalData.roomId = roomId;
    }
    this.setData({ roomId, navbarPaddingTop, scrollHeight, contentPaddingTop });
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

      const myAvatar = me ? (me.avatarImage || '') : '';
      const otherAvatars = avatarList.filter((a) => !a.isMe).slice(0, 5);

      this.setData({
        workshopName: result.workshopName || '脑暴工作坊',
        avatarList,
        currentUser: me ? me.id : null,
        isHost,
        myAvatar,
        otherAvatars
      }, () => {
        this.loadSubmittedProblems();
      });

      if (isHost) {
        this._updateRoomState('selectProblem');
        this._stopStatePolling();
      } else {
        const roomState = result.roomState || {};
        const page = roomState.currentPage || 'selectProblem';
        navigateByRoomState(page, roomState, roomId);
        if (isAwaitPage((page || '').toLowerCase())) {
          return;
        }
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
    const isHost = this.data.isHost === true;
    try {
      const problemList = await listProblems(roomId);
      const newProblems = problemList.map((item) => ({
        id: item.id,
        text: item.text,
        selected: false,
        isAISummary: false
      }));

      if (newProblems.length === 0) {
        if (this.data.problems.length > 0) {
          this.setData({ problems: [], selectedProblemId: null, editingProblemId: '' });
        }
        return;
      }

      let selectedProblemId = isHost ? this.data.selectedProblemId : null;
      if (isHost && (!selectedProblemId || !newProblems.some((p) => p.id === selectedProblemId))) {
        selectedProblemId = newProblems[0].id;
      }

      const problems = newProblems.map((item) => ({
        ...item,
        selected: isHost && item.id === selectedProblemId
      }));

      const currentIds = this.data.problems.map((p) => p.id);
      const newIds = newProblems.map((p) => p.id);
      const selectionChanged = isHost
        ? problems.some((p, i) => p.selected !== (this.data.problems[i] && this.data.problems[i].selected))
        : this.data.problems.some((p) => p.selected);
      const changed = newProblems.length !== this.data.problems.length
        || newIds.some((id) => !currentIds.includes(id))
        || selectionChanged
        || (!isHost && this.data.editingProblemId);

      if (!changed) return;

      this.setData({
        problems,
        selectedProblemId: isHost ? selectedProblemId : null,
        editingProblemId: isHost ? this.data.editingProblemId : ''
      });
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

  _getTextLineHeight() {
    const ww = this._windowWidth || 375;
    return Math.ceil((28 / 750) * ww * 1.2);
  },

  onEditProblem(e) {
    if (!this.data.isHost) return;
    const problemId = e.currentTarget.dataset.id;

    // 进入编辑前先测量展示态文字高度，确保 textarea 与原文同高
    wx.createSelectorQuery()
      .in(this)
      .select(`#problem-text-${problemId}`)
      .boundingClientRect((rect) => {
        const fallback = this._getTextLineHeight();
        const height = rect && rect.height > 0 ? Math.ceil(rect.height) : fallback;
        this.setData({
          editingProblemId: problemId,
          [`textareaHeights.${problemId}`]: height,
        });
      })
      .exec();
  },

  stopPropagation() {},

  async onSaveEdit() {
    if (!this.data.isHost) return;
    const id = this.data.editingProblemId;
    if (!id) return;

    const problem = this.data.problems.find((p) => p.id === id);
    const text = ((problem && problem.text) || '').trim();
    this.setData({ editingProblemId: '' });

    if (!text) return;
    try {
      await updateProblemText(id, text);
    } catch (err) {
      console.error('更新设计问题失败', err);
      wx.showToast({ title: '更新失败', icon: 'none' });
    }
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
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'selectMode',
          selectedDesignProblem: {
            id: problem.id,
            text: problem.text
          }
        }
      });
    } catch (e) {
      console.warn('updateRoomState selectedDesignProblem', e);
      wx.showToast({ title: '保存设计问题失败', icon: 'none' });
      return;
    }

    const query = roomId ? `?roomId=${encodeURIComponent(roomId)}` : '';
    wx.navigateTo({
      url: `/pages/main-pages/selectPlayer/index${query}`
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
