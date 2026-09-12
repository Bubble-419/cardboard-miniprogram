const { safeNavigateBack } = require('../../../utils/pageNavigate');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');
const {
  bindPageToRoomSession,
  dispatchRoomCommand,
  getRoomPageSnapshot,
  unbindPageFromRoomSession
} = require('../../../modules/room-session/index');

Page(withPageInteractionLock({
  data: {
    roomId: '',
    members: [],
    memberCount: 0,
    isHost: false,
    myPlayerIndex: null,
    myNickName: '',
    myAvatar: '',
    ideaText: '',
    submitted: false,
    submittedCount: 0,
    canViewSummary: false
  },

  async onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ roomId });
    await this.loadRoomData(roomId);
    this._startStatePolling();
  },

  onUnload() {
    this._stopStatePolling();
  },

  onIdeaInput(e) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({ ideaText: value });
  },

  async loadRoomData(roomId) {
    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      this._applySnapshot(result);
    } catch (e) {
      console.warn('creativeInput loadRoomData', e);
    }
  },

  _applySnapshot(result) {
      if (result.ok !== true || !result.members || !result.members.length) return;
      const { assignAvatarImages } = require('../../../utils/avatars');
      const members = assignAvatarImages(result.members);
      const me = members.find(m => m.isMe);
      const isHost = result.isHost === true;
      this.setData({
        members,
        memberCount: members.length,
        isHost,
        myPlayerIndex: me ? me.playerIndex : null,
        myNickName: me ? (me.nickName || `玩家${me.playerIndex}`) : '',
        myAvatar: me ? (me.avatarImage || me.avatarUrl || '') : ''
      });
      const session = result.view && result.view.session;
      const progress = session && session.progress && session.progress.contributionProgress || {};
      const contribution = result.view && result.view.actor && result.view.actor.contributionStatus;
      const submittedCount = progress.submittedCount || 0;
      this.setData({
        submittedCount,
        submitted: !!(contribution && contribution.submitted),
        ideaText: contribution && contribution.submitted ? (contribution.text || '') : this.data.ideaText
      });
      const memberCount = progress.requiredCount || members.length;
      this._updateCanViewSummary(submittedCount, memberCount, this.data.isHost);
  },

  _updateCanViewSummary(submittedCount, memberCount, isHost) {
    const canViewSummary = !!isHost && memberCount > 0 && submittedCount >= memberCount;
    this.setData({ canViewSummary });
  },

  async handleSubmit() {
    if (this._submitting) return;

    const roomId = this.data.roomId;
    const ideaText = (this.data.ideaText || '').trim();
    if (!roomId) return;
    if (!this.data.myPlayerIndex) {
      wx.showToast({ title: '未获取到玩家信息', icon: 'none' });
      return;
    }
    if (!ideaText) {
      wx.showToast({ title: '请先填写创意', icon: 'none' });
      return;
    }

    return runPageNavigation(this, async () => {
      this._submitting = true;
      this._stopStatePolling();
      try {
        const result = await dispatchRoomCommand('SUBMIT_HALLI_IDEA', { text: ideaText });
        if (result.ok !== true) {
          wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
          this._startStatePolling();
          return;
        }

        this.setData({ submitted: true });
        return {
          method: 'redirectTo',
          url: `/pages/main-pages/creativeSummary/index?roomId=${encodeURIComponent(roomId)}`
        };
      } catch (e) {
        console.error('creativeInput handleSubmit', e);
        wx.showToast({ title: '提交失败', icon: 'none' });
        this._startStatePolling();
        return;
      } finally {
        this._submitting = false;
      }
    }, { loadingText: '正在提交创意…' });
  },

  async handleViewSummary() {
    if (!this.data.canViewSummary) return;
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    return runPageNavigation(this, async () => {
      return {
        method: 'redirectTo',
        url: `/pages/main-pages/creativeSummary/index?roomId=${encodeURIComponent(roomId)}`
      };
    }, { loadingText: '正在打开汇总…' });
  },

  _startStatePolling() {
    this._stopStatePolling();
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || '',
      followNavigation: true,
      onSnapshot: (result) => {
        if (!this._submitting) this._applySnapshot(result);
      }
    }).catch((e) => console.warn('creativeInput bind room', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
  },

  handleGoBack() {
    return runPageInteraction(this, async () => {
      const roomId = this.data.roomId || '';
      safeNavigateBack({
        expectedPrev: 'pages/main-pages/halliGalli/gamepage/index',
        fallbackUrl: roomId
          ? `/pages/main-pages/halliGalli/gamepage/index?roomId=${encodeURIComponent(roomId)}`
          : '/pages/main-pages/modeIndex/index?modeId=halliGalli'
      });
    }, { loadingText: '正在返回…' });
  }
}, ['handleGoBack', 'onIdeaInput', 'handleSubmit', 'handleViewSummary']));
