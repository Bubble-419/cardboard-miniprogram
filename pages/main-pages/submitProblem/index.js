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
const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');
const { buildUserListFromMembers } = require('../../../utils/userListData');
const { goRoomPage } = require('../../../utils/goRoomPage');

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
    isSubmitting: false,
    inputFocused: false
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
    this._syncCategoriesFromBG(normalizeBG(getApp().globalData.selectedBG));
    this.loadRoomData().then(() => {
      this.refreshSubmitStatus();
      this._startPolling();
      this._initialized = true;
    });
  },

  onShow() {
    if (this._initialized) {
      this.loadRoomData().then(() => {
        if (!this._inputFocused) {
          this.refreshSubmitStatus();
        }
      });
    }
  },

  onUnload() {
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

  _syncMembersFromResult(result) {
    if (!result || result.ok !== true) return;
    const members = result.members || [];
    const avatarList = buildUserListFromMembers(members);
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
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) return;

      const roomBG = normalizeBG(result.selectedBG)
        || normalizeBG(getApp().globalData.selectedBG);
      if (roomBG) {
        this._syncCategoriesFromBG(roomBG);
      }

      this._syncMembersFromResult(result);
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
      if (this.data.myPlayerIndex != null && !this._inputFocused && !this.data.isSubmitting) {
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

        const roomBG = normalizeBG(result.selectedBG)
          || normalizeBG(getApp().globalData.selectedBG);
        if (roomBG) {
          this._syncCategoriesFromBG(roomBG);
        }

        this._syncMembersFromResult(result);
        followSubScreenRoomPoll(result, roomId, {
          beforeNavigate: (pollResult, page) => {
            if (page === 'selectproblem') {
              this._goSelectProblem();
              return true;
            }
            return false;
          }
        });
      } catch (e) {
        console.warn('submitProblem poll', e);
      }
    };
    poll();
    this._pollTimer = setInterval(poll, 2000);
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

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/main-pages/modeIndex/index' });
      }
    });
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
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
