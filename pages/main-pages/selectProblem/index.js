const { listProblems, updateProblemText } = require('../../../utils/roomDesignProblems');
const {
  DEFAULT_CATEGORIES,
  buildCategoriesFromBG,
  applyBGToApp,
  normalizeBG
} = require('../../../utils/scenarioCategories');
const { navigateByRoomState, isAwaitPage } = require('../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');
const { goRoomPage } = require('../../../utils/goRoomPage');

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
    myPlayerIndex: null,
    countdown: 5,
    editingProblemId: '',
    textareaHeights: {},
    navbarPaddingTop: 0,
    scrollHeight: 0,
    contentPaddingTop: 0
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
    this.loadRoomData().then(() => {
      this.loadSubmittedProblems();
    });
    this.startCountdown();
    this.startProblemCheck();
  },

  onShow() {
    if (this.data.roomId) {
      this.loadRoomData().then(() => {
        this.loadSubmittedProblems();
      });
    } else {
      this.loadSubmittedProblems();
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
        const avatarImage = AVATAR_IMAGES[idx % AVATAR_IMAGES.length];
        return {
          id: m.userId || String(m.playerIndex),
          nickName: m.nickName || `玩家${m.playerIndex}`,
          avatar: avatarImage,
          avatarImage,
          isMe: m.isMe === true
        };
      });
      const meMember = (result.members || []).find((m) => m.isMe);
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
        myPlayerIndex: meMember ? meMember.playerIndex : null,
        isHost
      });

      if (isHost) {
        this._updateRoomState('selectProblem');
        this._stopStatePolling();
      } else {
        const roomState = result.roomState || {};
        const page = roomState.currentPage || 'selectProblem';
        followSubScreenRoomPoll(result, roomId);
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
        followSubScreenRoomPoll(result, roomId);
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

  _mapProblemsForDisplay(problemList) {
    const { isHost, myPlayerIndex, selectedProblemId, editingProblemId, problems } = this.data;
    const editingText = editingProblemId
      ? (problems.find((p) => p.id === editingProblemId) || {}).text
      : null;

    const mapped = problemList.map((item) => {
      const isMine = myPlayerIndex != null && item.playerIndex === myPlayerIndex;
      let text = item.text;
      if (editingProblemId && item.id === editingProblemId && editingText != null) {
        text = editingText;
      }
      return {
        id: item.id,
        text,
        playerIndex: item.playerIndex,
        submitTime: item.submitTime || 0,
        isMine,
        isAISummary: false,
        selected: false
      };
    });

    if (isHost) {
      let hostSelectedId = selectedProblemId;
      if (!hostSelectedId || !mapped.some((p) => p.id === hostSelectedId)) {
        hostSelectedId = mapped.length ? mapped[0].id : null;
      }
      return mapped.map((item) => ({
        ...item,
        selected: item.id === hostSelectedId
      }));
    }

    return mapped.map((item) => ({
      ...item,
      selected: item.isMine
    }));
  },

  async loadSubmittedProblems() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    const isHost = this.data.isHost === true;
    try {
      const problemList = await listProblems(roomId);
      const newProblems = this._mapProblemsForDisplay(problemList);

      if (newProblems.length === 0) {
        if (this.data.problems.length) {
          this.setData({ problems: [], selectedProblemId: null });
        }
        this._problemsFingerprint = '';
        return;
      }

      const fingerprint = newProblems
        .map((p) => `${p.id}:${p.text}:${p.submitTime || 0}`)
        .join('|');
      if (fingerprint === this._problemsFingerprint) return;
      this._problemsFingerprint = fingerprint;

      const selectedProblem = newProblems.find((p) => p.selected) || null;
      this.setData({
        problems: newProblems,
        selectedProblemId: selectedProblem ? selectedProblem.id : null
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
    const problemId = e.currentTarget.dataset.id;
    const problem = this.data.problems.find((p) => p.id === problemId);
    if (!problem) return;

    if (!this.data.isHost) {
      if (!problem.isMine) return;
      this.onEditProblem({ currentTarget: { dataset: { id: problemId } } });
      return;
    }

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
    const problemId = e.currentTarget.dataset.id;
    const problem = this.data.problems.find((p) => p.id === problemId);
    if (!problem) return;
    if (!this.data.isHost && !problem.isMine) return;

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
    const id = this.data.editingProblemId;
    if (!id) return;
    const problem = this.data.problems.find((p) => p.id === id);
    if (!problem) return;
    if (!this.data.isHost && !problem.isMine) return;
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
    const id = e.currentTarget.dataset.id;
    const problem = this.data.problems.find((p) => p.id === id);
    if (!problem) return;
    if (!this.data.isHost && !problem.isMine) return;
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
          currentPage: 'selectPlayer',
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
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
