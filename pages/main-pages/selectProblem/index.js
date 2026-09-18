const { listProblems, updateProblemText } = require('../../../utils/roomDesignProblems');
const {
  DEFAULT_CATEGORIES,
  buildCategoriesFromBG,
  applyBGToApp,
  normalizeBG
} = require('../../../utils/scenarioCategories');
const { goRoomPage } = require('../../../utils/goRoomPage');
const { buildAvatarListAsync } = require('../../../utils/avatars');
const { clearPendingNavigation } = require('../../../utils/pageNavigate');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');
const {
  bindPageToRoomSession,
  dispatchRoomCommand,
  executeProjectedBack,
  followRoomRouteAfterCommand,
  getRoomPageSnapshot,
  getActiveRoomSession,
  getRoomRequestContext,
  unbindPageFromRoomSession
} = require('../../../modules/room-session/index');

Page(withPageInteractionLock({
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
    sessionId: '',
    workflowRevision: null,
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
    this._startStatePolling();
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
    this._startStatePolling();
  },

  onHide() {
    this._pageVisible = false;
    this._stopStatePolling();
  },

  onUnload() {
    this._pageAlive = false;
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this._stopEditingHeartbeat();
    if (this.data.isHost && this.data.editingProblemId) {
      this._syncEditingProblemId('');
    }
    this._stopStatePolling();
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
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (result.ok !== true) return;
      await this._applyRoomSnapshot(result);
    } catch (e) {
      console.warn('loadRoomData', e);
    }
  },

  async _applyRoomSnapshot(result) {
      if (!result || result.ok !== true) return;
      const applyGen = (this._snapshotApplyGen || 0) + 1;
      this._snapshotApplyGen = applyGen;
      const avatarList = await buildAvatarListAsync(result.members || [], this._prevMembersForAvatar);
      if (!this._pageAlive || this._snapshotApplyGen !== applyGen) return;
      this._prevMembersForAvatar = result.members || [];
      const meMember = (result.members || []).find((m) => m.isMe);
      const me = avatarList.find((item) => item.isMe);
      const isHost = result.isHost === true;
      const session = result.view && result.view.session;
      this._syncCategoriesFromBG(normalizeBG(result.selectedBG));

      const patch = {
        workshopName: result.workshopName || '脑暴工作坊',
        currentUser: me ? me.id : null,
        myPlayerIndex: meMember ? meMember.playerIndex : null,
        isHost,
        sessionId: session && session.sessionId || this.data.sessionId || '',
        workflowRevision: session && session.workflow && session.workflow.revision || null
      };
      const remoteId = !isHost && result.roomState && result.roomState.editingProblemId
        ? String(result.roomState.editingProblemId)
        : '';
      if (remoteId !== (this.data.remoteEditingProblemId || '')) {
        patch.remoteEditingProblemId = remoteId;
      }
      const avatarFp = (avatarList || [])
        .map((item) => `${item.id || ''}:${item.avatarImage || item.avatar || ''}`)
        .join('|');
      if (avatarFp !== this._avatarFingerprint) {
        this._avatarFingerprint = avatarFp;
        patch.avatarList = avatarList;
      }
      this.setData(patch);
      this._applyProblemsFromSnapshot(result);
  },

  _startStatePolling() {
    this._stopStatePolling();
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    bindPageToRoomSession(this, {
      getRoomId: () => roomId,
      // 房主可能从后续配置页返回重新选题；该页确认后会主动跳转，无需状态路由立即推走。
      followNavigation: true,
      onSnapshot: (result) => {
        if (!this._pageAlive || this._pageVisible === false) return;
        this._applyRoomSnapshot(result).catch((e) => console.warn('selectProblem snapshot', e));
      }
    }).catch((e) => console.warn('selectProblem bind room', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
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
      this._applyProblemList(problemList);
    } catch (e) {
      console.warn('loadSubmittedProblems', e);
    }
  },

  _applyProblemsFromSnapshot(result) {
    if (this.data.editingProblemId) return;
    const session = result && result.view && result.view.session;
    const members = result && result.members || [];
    const problemList = ((session && session.setup && session.setup.designProblems) || []).map((item) => {
      const member = members.find((row) => row.memberId === item.memberId) || {};
      return { id: item.contributionId, contributionId: item.contributionId, text: item.text,
        entityVersion: item.entityVersion, playerIndex: member.playerIndex,
        nickName: member.nickName || '', createTime: item.createdAt, submitTime: item.createdAt };
    });
    this._applyProblemList(problemList);
  },

  _applyProblemList(problemList) {
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
  },

  startProblemCheck() {
    this._startStatePolling();
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

    // 进入编辑前先测量展示态文字高度，确保 textarea 与原文同高。
    // 真机上 boundingClientRect 的节点回调可能不触发，必须以 exec 结果为准。
    wx.createSelectorQuery()
      .in(this)
      .select(`#problem-text-${problemId}`)
      .boundingClientRect()
      .exec((res) => {
        const rect = res && res[0];
        const fallback = this._getTextLineHeight();
        const height = rect && rect.height > 0 ? Math.ceil(rect.height) : fallback;
        // textarea 初次挂载在部分真机上会紧接着误发 blur。
        // 只忽略一次「无输入」的初始 blur，不会吞掉用户已修改的内容。
        this._ignoreInitialProblemBlurUntil = Date.now() + 800;
        this._editingHasInput = false;
        this.setData({
          editingProblemId: problemId,
          editingCursor: (problem.text || '').length,
          [`textareaHeights.${problemId}`]: height,
        }, () => {
          this._syncEditingProblemId(problemId, { notify: true });
          this._startEditingHeartbeat();
        });
      });
  },

  _resolveEditingScope() {
    let sessionId = this.data.sessionId || '';
    let workflowRevision = this.data.workflowRevision;
    if (sessionId && Number.isInteger(workflowRevision)) {
      return { sessionId, workflowRevision };
    }
    const roomSession = getActiveRoomSession();
    const view = roomSession && typeof roomSession.getView === 'function' ? roomSession.getView() : null;
    const currentSession = view && view.session;
    sessionId = sessionId || currentSession && currentSession.sessionId || '';
    if (!Number.isInteger(workflowRevision)) {
      workflowRevision = currentSession && currentSession.workflow
        ? currentSession.workflow.revision
        : null;
    }
    return { sessionId, workflowRevision };
  },

  async _syncEditingProblemId(problemId, options = {}) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    const { sessionId, workflowRevision } = this._resolveEditingScope();
    if (!this.data.isHost) return problemId;
    if (!roomId || !sessionId || !Number.isInteger(workflowRevision)) {
      if (options.notify === true) {
        wx.showToast({ title: '编辑态同步失败', icon: 'none' });
      }
      return problemId;
    }
    const contributionId = problemId == null ? '' : String(problemId);
    // 所有编辑心跳与清空操作串行发送，避免旧心跳晚到后覆盖清空状态。
    const previous = this._editingSignalQueue || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      try {
        const response = await wx.cloud.callFunction({
          name: 'roomSignal',
          data: {
            roomId,
            sessionId,
            workflowRevision,
            signalType: 'DESIGN_PROBLEM_EDITING',
            value: contributionId,
            clientContext: getRoomRequestContext()
          }
        });
        const result = response && Object.prototype.hasOwnProperty.call(response, 'result')
          ? response.result
          : response;
        if (!result || result.ok !== true) {
          console.warn('sync editingProblemId', result);
          if (options.notify === true) {
            wx.showToast({ title: result && result.errMsg || '编辑态同步失败', icon: 'none' });
          }
        }
      } catch (e) {
        console.warn('sync editingProblemId', e);
        if (options.notify === true) {
          wx.showToast({ title: '编辑态同步失败', icon: 'none' });
        }
      }
      return problemId;
    });
    this._editingSignalQueue = task.then(() => undefined, () => undefined);
    return task;
  },

  _startEditingHeartbeat() {
    this._stopEditingHeartbeat();
    this._editingHeartbeat = setInterval(() => {
      if (!this._pageAlive || !this.data.isHost || !this.data.editingProblemId) {
        this._stopEditingHeartbeat();
        return;
      }
      this._syncEditingProblemId(this.data.editingProblemId);
    }, 20000);
  },

  _stopEditingHeartbeat() {
    if (this._editingHeartbeat) {
      clearInterval(this._editingHeartbeat);
      this._editingHeartbeat = null;
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
    this._stopEditingHeartbeat();
    this.setData({ editingProblemId: '' });
    await this._syncEditingProblemId('');

    if (!text) return;
    return runPageInteraction(this, async () => {
      try {
        await updateProblemText(id, text);
      } catch (err) {
        console.error('更新设计问题失败', err);
        wx.showToast({ title: '更新失败', icon: 'none' });
      }
    }, { loadingText: '正在保存…' });
  },

  onProblemInput(e) {
    const id = e.currentTarget.dataset.id;
    const value = e.detail.value;
    const problems = this.data.problems.map((item) => (
      item.id === id ? { ...item, text: value } : item
    ));
    this._editingHasInput = true;
    this.setData({ problems });
  },

  onProblemFocus(e) {
    if (!this.data.isHost) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    if (this.data.editingProblemId !== id) {
      this._ignoreInitialProblemBlurUntil = Date.now() + 800;
      this._editingHasInput = false;
      this.setData({ editingProblemId: id });
    }
    this._syncEditingProblemId(id);
    this._startEditingHeartbeat();
  },

  async onProblemBlur(e) {
    if (!this.data.isHost) return;
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.editingProblemId !== id) return;
    if (Date.now() < (this._ignoreInitialProblemBlurUntil || 0) && !this._editingHasInput) {
      this._ignoreInitialProblemBlurUntil = 0;
      return;
    }
    this._ignoreInitialProblemBlurUntil = 0;
    this._editingHasInput = false;
    const problem = this.data.problems.find((p) => p.id === id);
    if (!problem) return;
    const text = (e.detail.value || '').trim();
    this._stopEditingHeartbeat();
    this.setData({ editingProblemId: '' });
    await this._syncEditingProblemId('');
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

    return runPageNavigation(this, async () => {
      const problem = this.data.problems.find((p) => p.id === this.data.selectedProblemId);
      getApp().globalData.selectedProblem = problem;

      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      if (this.data.editingProblemId) {
        this._stopEditingHeartbeat();
        this.setData({ editingProblemId: '' });
        await this._syncEditingProblemId('');
      }
      const result = await dispatchRoomCommand('SELECT_DESIGN_PROBLEM', {
        contributionId: problem.id
      });
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '保存设计问题失败', icon: 'none' });
        return;
      }

      await followRoomRouteAfterCommand(result, roomId);
      return null;
    }, { loadingText: '正在确认问题…' });
  },

  goBack() {
    return runPageInteraction(this, async () => {
      const result = await executeProjectedBack(this.data.roomId);
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '返回失败', icon: 'none' });
      }
    }, { loadingText: '正在返回…' });
  },

  handleGoRoom() {
    return runPageInteraction(this, () => goRoomPage(this.data.roomId), {
      loadingText: '正在返回房间…'
    });
  },

  /** 点击情境格：回看完整情境（confirmBG，只读），不推进房间状态 */
  handleViewContext() {
    return runPageNavigation(this, async () => {
      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      if (!roomId) {
        wx.showToast({ title: '缺少房间信息', icon: 'none' });
        return null;
      }
      this._pageVisible = false;
      this._stopStatePolling();
      clearPendingNavigation();
      return {
        method: 'navigateTo',
        url: `/pages/main-pages/partnerMode/confirmBG/index?roomId=${encodeURIComponent(roomId)}&from=select`,
        fail: (err) => {
          console.warn('selectProblem viewContext', err);
          this._pageVisible = true;
          this._startStatePolling();
          wx.showToast({ title: '打开失败', icon: 'none' });
        }
      };
    }, { loadingText: '正在查看情境…' });
  }
}, [
  'handleViewContext', 'selectProblem', 'stopPropagation', 'onSaveEdit',
  'onEditProblem', 'onProblemInput', 'onProblemFocus', 'onProblemBlur', 'confirmSelection',
  'goBack', 'handleGoRoom'
], {
  passthroughMethods: ['onProblemFocus', 'onProblemBlur']
}));
