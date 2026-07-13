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
const { buildAvatarList } = require('../../../utils/avatars');

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
    this._pageAlive = true;
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
      if (!this._pageAlive) return;
      this.loadSubmittedProblems();
    });
    this.startCountdown();
    this.startProblemCheck();
  },

  onShow() {
    if (!this._pageAlive) return;
    if (this.data.roomId) {
      this.loadRoomData().then(() => {
        if (!this._pageAlive) return;
        this.loadSubmittedProblems();
      });
    } else {
      this.loadSubmittedProblems();
    }
  },

  onUnload() {
    this._pageAlive = false;
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.problemCheckTimer) {
      clearInterval(this.problemCheckTimer);
      this.problemCheckTimer = null;
    }
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
        this.startProblemCheck();
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
      if (!this._pageAlive) return;
      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        if (!this._pageAlive) return;
        const result = (res && res.result) || {};
        followSubScreenRoomPoll(result, roomId);
        // 副屏合并问题列表刷新，避免并行双定时器
        this.loadSubmittedProblems();
      } catch (e) {
        if (this._pageAlive) {
          console.warn('selectProblem state poll', e);
        }
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

  startCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownTimer = setInterval(() => {
      if (!this._pageAlive) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        return;
      }
      if (this.data.countdown > 0) {
        this.setData({ countdown: this.data.countdown - 1 });
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
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
    // 副屏由状态轮询顺带刷新问题列表；房主单独轮询
    if (this.problemCheckTimer) {
      clearInterval(this.problemCheckTimer);
      this.problemCheckTimer = null;
    }
    if (!this.data.isHost) return;
    this.problemCheckTimer = setInterval(() => {
      if (!this._pageAlive) {
        clearInterval(this.problemCheckTimer);
        this.problemCheckTimer = null;
        return;
      }
      this.loadSubmittedProblems();
    }, 2500);
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

    const query = roomId
      ? `?roomId=${encodeURIComponent(roomId)}&modeId=partner`
      : '?modeId=partner';
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
