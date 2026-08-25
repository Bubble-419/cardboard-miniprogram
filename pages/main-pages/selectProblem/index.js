const { listProblems, updateProblemText } = require('../../../utils/roomDesignProblems');
const {
  DEFAULT_CATEGORIES,
  buildCategoriesFromBG,
  applyBGToApp,
  normalizeBG
} = require('../../../utils/scenarioCategories');
const { isAwaitPage } = require('../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');
const { goRoomPage } = require('../../../utils/goRoomPage');
const { buildAvatarListAsync } = require('../../../utils/avatars');
const { safeNavigateBack, clearPendingNavigation } = require('../../../utils/pageNavigate');

/** 已在选择设计问题页时，这些滞后 currentPage 不应把成员拉走 */
const SELECT_PROBLEM_STALE_PAGES = {
  selectproblem: true,
  submitproblem: true,
  confirmbg: true,
  selectbg: true,
  auth: true,
  addplayer: true,
  brainstormmode: true
};

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
    /** 他端同步的房主编辑中问题 id（只读展示） */
    remoteEditingProblemId: '',
    editingCursor: 0,
    textareaHeights: {},
    scrollHeight: 0
  },

  onLoad(options) {
    this._pageAlive = true;
    this._pageVisible = true;
    let screenHeight = 750;
    try {
      const sys = wx.getSystemInfoSync();
      screenHeight = sys.windowHeight || 750;
      this._windowWidth = sys.windowWidth || 375;
    } catch (e) {
      console.warn('getSystemInfo', e);
    }
    this._windowHeight = screenHeight;

    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (roomId) {
      getApp().globalData.roomId = roomId;
    }
    this.setData({ roomId, scrollHeight: screenHeight });
    this._syncCategoriesFromBG(normalizeBG(getApp().globalData.selectedBG));
    this.loadRoomData().then(() => {
      if (!this._pageAlive) return;
      this._initialized = true;
      this.loadSubmittedProblems();
      this._measureHeaderHeight();
    });
    this.startProblemCheck();
  },

  onReady() {
    this._measureHeaderHeight();
  },

  /** header-section 移出 scroll-view 后，用实测高度反算 scroll-view 可用高度，避免留白或裁切 */
  _measureHeaderHeight() {
    wx.nextTick(() => {
      if (!this._pageAlive) return;
      const query = wx.createSelectorQuery().in(this);
      query.select('#selectProblemHeader').boundingClientRect();
      query.exec((res) => {
        if (!this._pageAlive) return;
        const rect = res && res[0];
        const windowHeight = this._windowHeight || 750;
        if (rect && rect.height) {
          this.setData({ scrollHeight: Math.max(320, windowHeight - rect.height) });
        }
      });
    });
  },

  onShow() {
    this._pageVisible = true;
    if (!this._pageAlive || !this._initialized) return;
    if (this.data.roomId) {
      this.loadRoomData().then(() => {
        if (!this._pageAlive) return;
        this.loadSubmittedProblems();
      });
    } else {
      this.loadSubmittedProblems();
    }
    if (this.data.isHost) {
      this.startProblemCheck();
    } else {
      this._startStatePolling();
    }
  },

  onHide() {
    this._pageVisible = false;
    if (this.problemCheckTimer) {
      clearInterval(this.problemCheckTimer);
      this.problemCheckTimer = null;
    }
    this._stopStatePolling();
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
    // 房主离开页时清掉编辑态，避免成员端一直显示「编辑中」
    if (this.data.isHost && this.data.editingProblemId) {
      this._syncEditingProblemId('');
    }
  },

  _syncCategoriesFromBG(bg) {
    const normalized = normalizeBG(bg);
    if (normalized) {
      applyBGToApp(normalized);
    }
    const categories = buildCategoriesFromBG(normalized);
    const fingerprint = (categories || [])
      .map((item) => `${item.key || ''}:${item.name || ''}`)
      .join('|');
    if (fingerprint === this._categoriesFingerprint) return;
    this._categoriesFingerprint = fingerprint;
    this.setData({ categories });
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

      const avatarList = await buildAvatarListAsync(result.members || [], this._prevMembersForAvatar);
      this._prevMembersForAvatar = result.members || [];
      const meMember = (result.members || []).find((m) => m.isMe);
      const me = avatarList.find((item) => item.isMe);
      const isHost = result.isHost === true;
      const roomBG = normalizeBG(result.selectedBG)
        || normalizeBG(getApp().globalData.selectedBG);

      if (roomBG) {
        this._syncCategoriesFromBG(roomBG);
      }

      const roomState = result.roomState || {};
      const patch = {
        workshopName: result.workshopName || '脑暴工作坊',
        currentUser: me ? me.id : null,
        myPlayerIndex: meMember ? meMember.playerIndex : null,
        isHost
      };
      const avatarFp = (avatarList || [])
        .map((item) => `${item.id || ''}:${item.avatarImage || item.avatar || ''}`)
        .join('|');
      if (avatarFp !== this._avatarFingerprint) {
        this._avatarFingerprint = avatarFp;
        patch.avatarList = avatarList;
      }
      // 成员端：进入页即同步房主编辑态标记（只同步 id，不同步正文）
      if (!isHost) {
        const remoteId = roomState.editingProblemId || '';
        if (remoteId !== (this.data.remoteEditingProblemId || '')) {
          patch.remoteEditingProblemId = remoteId;
        }
      }
      this.setData(patch);

      if (isHost) {
        this._updateRoomState('selectProblem');
        this._stopStatePolling();
        this.startProblemCheck();
      } else {
        const page = (roomState.currentPage || 'selectProblem').toLowerCase();
        this._followRoomOrStay(result, roomId);
        if (isAwaitPage(page)) {
          return;
        }
        if (this._pageVisible === false) return;
        this._startStatePolling();
      }
    } catch (e) {
      console.warn('loadRoomData', e);
    }
  },

  /** 非房主跟随：只前进（抽首位/进游戏），不因滞后 currentPage 回跳 */
  _followRoomOrStay(result, roomId) {
    followSubScreenRoomPoll(result, roomId, {
      beforeNavigate: (pollResult, page) => {
        const leftWorkshop = pollResult
          && pollResult.hasSelectedMode !== true
          && (page === 'addplayer' || page === 'brainstormmode');
        // 房主已回大厅/重选模式：不要吞掉，交给后续逻辑拉回
        if (leftWorkshop) return false;
        return SELECT_PROBLEM_STALE_PAGES[page] === true;
      }
    });
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
      if (!this._pageAlive || this._pageVisible === false) return;
      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        if (!this._pageAlive || this._pageVisible === false) return;
        const result = (res && res.result) || {};
        this._followRoomOrStay(result, roomId);
        const roomState = result.roomState || {};
        const remoteId = roomState.editingProblemId || '';
        const prevRemoteId = this.data.remoteEditingProblemId || '';
        if (remoteId !== prevRemoteId) {
          this.setData({ remoteEditingProblemId: remoteId });
          // 房主退出编辑后再拉列表，拿到保存后的最终文案
          if (!remoteId) {
            this.loadSubmittedProblems();
          }
        } else {
          this.loadSubmittedProblems();
        }
        // 编辑中：只同步「编辑中」标记，不刷新正文（无需实时同步修改内容）
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

    // 固定按首次提交时间升序；同时间按 id 稳定排序。选择/编辑不得改变顺序。
    const sorted = (problemList || []).slice().sort((a, b) => {
      const ta = a.createTime || a.submitTime || 0;
      const tb = b.createTime || b.submitTime || 0;
      if (ta !== tb) return ta - tb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const mapped = sorted.map((item) => {
      const isMine = myPlayerIndex != null && item.playerIndex === myPlayerIndex;
      let text = item.text;
      if (editingProblemId && item.id === editingProblemId && editingText != null) {
        text = editingText;
      }
      return {
        id: item.id,
        text,
        playerIndex: item.playerIndex,
        createTime: item.createTime || item.submitTime || 0,
        submitTime: item.createTime || item.submitTime || 0,
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

    // 非房主：全部非选中态，仅通过 isMine / problem-text-mine 区分自己的问题
    return mapped;
  },

  async loadSubmittedProblems() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    // 编辑中跳过整表刷新，避免 setData 打断输入焦点/光标
    if (this.data.editingProblemId) return;
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
        .map((p) => `${p.id}:${p.text}:${p.createTime || p.submitTime || 0}:${p.selected ? 1 : 0}`)
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

    // 非房主仅查看，不可选择/编辑
    if (!this.data.isHost) return;

    const problems = this.data.problems.map((item) => ({
      ...item,
      selected: item.id === problemId
    }));
    this.setData({ problems, selectedProblemId: problemId });
  },

  _getTextLineHeight() {
    const ww = this._windowWidth || 375;
    return Math.ceil((28 / 750) * ww * 1.4);
  },

  onEditProblem(e) {
    if (!this.data.isHost) return;
    const problemId = e.currentTarget.dataset.id;
    const problem = this.data.problems.find((p) => p.id === problemId);
    if (!problem) return;

    // 进入编辑前先测量展示态文字高度，确保 textarea 与原文同高
    wx.createSelectorQuery()
      .in(this)
      .select(`#problem-text-${problemId}`)
      .boundingClientRect((rect) => {
        const fallback = this._getTextLineHeight();
        const height = rect && rect.height > 0 ? Math.ceil(rect.height) : fallback;
        this.setData({
          editingProblemId: problemId,
          editingCursor: (problem.text || '').length,
          [`textareaHeights.${problemId}`]: height,
        });
        this._syncEditingProblemId(problemId);
      })
      .exec();
  },

  async _syncEditingProblemId(problemId) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId || !this.data.isHost) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          // 编辑态同步时显式带上 currentPage，避免云端读取到旧 currentPage
          // 导致非房主端“跳房间页又跳回”的循环抖动
          currentPage: 'selectProblem',
          editingProblemId: problemId == null ? '' : String(problemId)
        }
      });
    } catch (e) {
      console.warn('sync editingProblemId', e);
    }
  },

  stopPropagation() {},

  async onSaveEdit() {
    if (!this.data.isHost) return;
    const id = this.data.editingProblemId;
    if (!id) return;
    const problem = this.data.problems.find((p) => p.id === id);
    if (!problem) return;
    const text = ((problem && problem.text) || '').trim();
    this.setData({ editingProblemId: '' });
    this._syncEditingProblemId('');

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
    const problem = this.data.problems.find((p) => p.id === id);
    if (!problem) return;
    const text = (e.detail.value || '').trim();
    this.setData({ editingProblemId: '' });
    this._syncEditingProblemId('');
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
    if (this.data.editingProblemId) {
      this.setData({ editingProblemId: '' });
    }
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'selectPlayer',
          editingProblemId: '',
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
    const roomId = this.data.roomId || '';
    const fallbackUrl = roomId
      ? `/pages/main-pages/submitProblem/index?roomId=${encodeURIComponent(roomId)}`
      : '/pages/main-pages/submitProblem/index';
    safeNavigateBack({
      expectedPrev: 'pages/main-pages/submitProblem/index',
      fallbackUrl
    });
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  },

  /** 点击情境格：回看完整情境（confirmBG，只读），不推进房间状态 */
  handleViewContext() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }
    this._pageVisible = false;
    this._stopStatePolling();
    if (this.problemCheckTimer) {
      clearInterval(this.problemCheckTimer);
      this.problemCheckTimer = null;
    }
    clearPendingNavigation();
    wx.navigateTo({
      url: `/pages/main-pages/partnerMode/confirmBG/index?roomId=${encodeURIComponent(roomId)}&from=select`,
      fail: (err) => {
        console.warn('selectProblem viewContext', err);
        this._pageVisible = true;
        if (this.data.isHost) {
          this.startProblemCheck();
        } else {
          this._startStatePolling();
        }
        wx.showToast({ title: '打开失败', icon: 'none' });
      }
    });
  }
});
