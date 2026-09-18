const {
  getSubmitStatus,
  submitProblem: saveProblem
} = require('../../../utils/roomDesignProblems');
const {
  DEFAULT_CATEGORIES,
  buildCategoriesFromBG,
  applyBGToApp,
  normalizeBG
} = require('../../../utils/scenarioCategories');
const { buildUserListFromMembersAsync } = require('../../../utils/userListData');
const { goRoomPage } = require('../../../utils/goRoomPage');
const { clearPendingNavigation } = require('../../../utils/pageNavigate');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');
const {
  bindPageToRoomSession,
  followRoomRouteAfterCommand,
  getRoomPageSnapshot,
  unbindPageFromRoomSession
} = require('../../../modules/room-session/index');

Page(withPageInteractionLock({
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
    isSubmitting: false,
    inputFocused: false
  },

  onLoad(options) {
    this._pageAlive = true;
    this._pageVisible = true;
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    getApp().globalData.roomId = roomId;
    this.setData({ roomId });
    this._syncCategoriesFromBG(normalizeBG(getApp().globalData.selectedBG));
    this.loadRoomData().then(() => {
      if (!this._pageAlive) return;
      this.refreshSubmitStatus();
      this._startPolling();
      this._initialized = true;
    });
  },

  onShow() {
    this._pageVisible = true;
    if (!this._pageAlive || !this._initialized) return;
    this.loadRoomData().then(() => {
      if (!this._pageAlive || this._inputFocused) return;
      this.refreshSubmitStatus();
    });
    this._startPolling();
  },

  onHide() {
    this._pageVisible = false;
    this._stopPolling();
  },

  onUnload() {
    this._pageAlive = false;
    this._stopPolling();
    if (this._inputBlurTimer) {
      clearTimeout(this._inputBlurTimer);
      this._inputBlurTimer = null;
    }
  },

  _syncCategoriesFromBG(bg) {
    const normalized = normalizeBG(bg);
    if (normalized) {
      applyBGToApp(normalized);
    }
    this.setData({ categories: buildCategoriesFromBG(normalized) });
  },

  async _syncMembersFromResult(result) {
    if (!result || result.ok !== true) return;
    const members = result.members || [];
    const avatarList = await buildUserListFromMembersAsync(members, this._prevMembersForAvatar);
    this._prevMembersForAvatar = members;
    const me = members.find((m) => m.isMe);
    this.setData({
      workshopName: result.workshopName || this.data.workshopName,
      avatarList,
      currentUser: me ? me.playerIndex : null,
      myPlayerIndex: me ? me.playerIndex : null,
      myNickName: me ? (me.nickName || `玩家${me.playerIndex}`) : '',
      totalMembers: result.memberCount != null ? result.memberCount : avatarList.length
    });
  },

  async loadRoomData() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (result.ok !== true) return;

      this._syncCategoriesFromBG(normalizeBG(result.selectedBG));

      await this._syncMembersFromResult(result);
    } catch (e) {
      console.warn('loadRoomData', e);
    }
  },

  async refreshSubmitStatus() {
    const roomId = this.data.roomId;
    if (!roomId || this.data.myPlayerIndex == null) return;
    if (this._inputFocused || this.data.isSubmitting) return;
    try {
      const status = await getSubmitStatus(
        roomId,
        this.data.myPlayerIndex,
        this.data.totalMembers
      );
      const patch = {
        submittedCount: status.submittedCount || 0,
        totalMembers: status.totalMembers || this.data.totalMembers,
        hasSubmitted: status.hasSubmitted === true
      };
      if (status.hasSubmitted) {
        patch.problemText = status.myProblemText || '';
      }
      this.setData(patch);
    } catch (e) {
      console.warn('refreshSubmitStatus', e);
    }
  },

  _startPolling() {
    this._stopPolling();
    if (!this.data.roomId) return;
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId,
      followNavigation: true,
      onSnapshot: (result) => {
        if (!this._pageAlive || this._pageVisible === false) return;
        this._syncCategoriesFromBG(normalizeBG(result.selectedBG));
        this._syncMembersFromResult(result);
        const session = result.view && result.view.session;
        const progress = session && session.progress && session.progress.contributionProgress || {};
        const actor = result.view && result.view.actor;
        const patch = {
          submittedCount: progress.submittedCount || 0,
          totalMembers: progress.requiredCount || result.memberCount || 0,
          hasSubmitted: !!(actor && actor.contributionStatus.submitted)
        };
        if (patch.hasSubmitted && !this._inputFocused) patch.problemText = actor.contributionStatus.text || '';
        this.setData(patch);
      }
    }).catch((e) => console.warn('submitProblem bind room', e));
  },

  _stopPolling() {
    unbindPageFromRoomSession(this);
  },

  handleOpenCase() {
    return runPageNavigation(this, async () => {
      // 从“设计问题示例”跳转到案例页（展示四维度与多条设计问题）
      this._pauseFollowForOverlay();
      const roomIdEnc = this.data.roomId ? encodeURIComponent(this.data.roomId) : '';
      return {
        method: 'navigateTo',
        url: roomIdEnc
          ? `/pages/main-pages/case/index?roomId=${roomIdEnc}`
          : '/pages/main-pages/case/index',
        fail: (err) => {
          console.warn('navigateTo case page fail', err);
          this._pageVisible = true;
          this._startPolling();
          wx.showToast({ title: '打开案例页失败', icon: 'none' });
        }
      };
    }, { loadingText: '正在打开案例…' });
  },

  handleGoRoom() {
    return runPageInteraction(this, () => goRoomPage(this.data.roomId), {
      loadingText: '正在返回房间…'
    });
  },

  /** 打开回看叠层前先停跟随，避免在途轮询把用户拉回主流程 */
  _pauseFollowForOverlay() {
    this._pageVisible = false;
    this._stopPolling();
    clearPendingNavigation();
  },

  /** 点击情境格：只读回看确认情境页，不推进房间状态 */
  handleViewContext() {
    return runPageNavigation(this, async () => {
      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      if (!roomId) {
        wx.showToast({ title: '缺少房间信息', icon: 'none' });
        return null;
      }
      this._pauseFollowForOverlay();
      return {
        method: 'navigateTo',
        url: `/pages/main-pages/partnerMode/confirmBG/index?roomId=${encodeURIComponent(roomId)}&from=submit`,
        fail: (err) => {
          console.warn('submitProblem viewContext', err);
          this._pageVisible = true;
          this._startPolling();
          wx.showToast({ title: '打开失败', icon: 'none' });
        }
      };
    }, { loadingText: '正在查看情境…' });
  },

  selectCategory(e) {
    const categoryId = e.currentTarget.dataset.id;
    const categories = this.data.categories.map((item) => ({
      ...item,
      selected: item.id === categoryId
    }));
    this.setData({ categories, selectedCategory: categoryId });
  },

  onInputFocus() {
    this._inputFocused = true;
    if (this._inputBlurTimer) {
      clearTimeout(this._inputBlurTimer);
      this._inputBlurTimer = null;
    }
    if (!this.data.inputFocused) {
      this.setData({ inputFocused: true });
    }
  },

  onInputBlur() {
    if (this._inputBlurTimer) clearTimeout(this._inputBlurTimer);
    this._inputBlurTimer = setTimeout(() => {
      this._inputFocused = false;
      if (this.data.inputFocused) {
        this.setData({ inputFocused: false });
      }
    }, 200);
  },

  preventTouchMove() {},

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

    return runPageNavigation(this, async () => {
      this.setData({ isSubmitting: true });
      try {
        const result = await saveProblem(this.data.roomId, {
          playerIndex: this.data.myPlayerIndex,
          nickName: this.data.myNickName,
          text: problemText
        });

        const status = await getSubmitStatus(
          this.data.roomId,
          this.data.myPlayerIndex,
          this.data.totalMembers
        );

        wx.showToast({ title: '提交成功', icon: 'success', duration: 1200 });
        this.setData({
          hasSubmitted: true,
          submittedCount: status.submittedCount || 0,
          totalMembers: status.totalMembers || this.data.totalMembers
        });

        // 最后一位提交者也必须按自己的 Member View 路由：房主进选择页，玩家进等待页。
        await followRoomRouteAfterCommand(result, this.data.roomId);
        return null;
      } catch (e) {
        console.error('submitProblem', e);
        wx.showToast({ title: e.message || '提交失败，请重试', icon: 'none' });
        return;
      } finally {
        this.setData({ isSubmitting: false });
      }
    }, { loadingText: '正在提交问题…' });
  }
}, [
  'handleOpenCase', 'handleGoRoom', 'handleViewContext',
  'selectCategory', 'onInputFocus', 'onInputBlur', 'onInput', 'preventTouchMove',
  'submitProblem'
], {
  passthroughMethods: ['onInputFocus', 'onInputBlur']
}));
