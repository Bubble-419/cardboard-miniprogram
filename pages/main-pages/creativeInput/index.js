const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');
const { safeNavigateBack } = require('../../../utils/pageNavigate');

Page({
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
    await this.loadIdeas(roomId);
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
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
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
      this._updateCanViewSummary(this.data.submittedCount, members.length, isHost);

      if (isHost) {
        try {
          await wx.cloud.callFunction({
            name: 'updateRoomState',
            data: { roomId, currentPage: 'creativeInput' }
          });
        } catch (e) {
          console.warn('creativeInput sync room state', e);
        }
      }
    } catch (e) {
      console.warn('creativeInput loadRoomData', e);
    }
  },

  async loadIdeas(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'listCreativeIdeas',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) return;

      const list = result.ideas || [];
      const submittedCount = result.submittedCount != null ? result.submittedCount : list.length;
      const mine = list.find(i => i.playerIndex === this.data.myPlayerIndex);
      this.setData({
        submittedCount,
        submitted: !!mine,
        ideaText: mine ? (mine.ideaText || '') : ''
      });
      const memberCount = result.totalMembers || this.data.memberCount;
      this._updateCanViewSummary(submittedCount, memberCount, this.data.isHost);
    } catch (e) {
      console.warn('creativeInput loadIdeas', e);
    }
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

    this._submitting = true;
    this._stopStatePolling();
    wx.showLoading({ title: '提交中…', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitCreativeIdea',
        data: { roomId, ideaText }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
        this._startStatePolling();
        return;
      }

      this.setData({ submitted: true });
      wx.redirectTo({
        url: `/pages/main-pages/creativeSummary/index?roomId=${encodeURIComponent(roomId)}`
      });
    } catch (e) {
      console.error('creativeInput handleSubmit', e);
      wx.showToast({ title: '提交失败', icon: 'none' });
      this._startStatePolling();
    } finally {
      this._submitting = false;
      wx.hideLoading();
    }
  },

  async handleViewSummary() {
    if (!this.data.canViewSummary) return;
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'creativeSummary'
        }
      });
    } catch (e) {
      console.warn('creativeInput handleViewSummary updateRoomState', e);
    }
    wx.redirectTo({
      url: `/pages/main-pages/creativeSummary/index?roomId=${encodeURIComponent(roomId)}`
    });
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId || '';
      if (!roomId || this._submitting) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        followSubScreenRoomPoll(result, roomId, {
          beforeNavigate: (pollResult, page) => {
            if (page === 'creativesummary') {
              wx.redirectTo({
                url: `/pages/main-pages/creativeSummary/index?roomId=${encodeURIComponent(roomId)}`
              });
              return true;
            }
            if (page === 'addplayer') {
              wx.redirectTo({
                url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
              });
              return true;
            }
            if (page === 'creativeinput') return true;
            if (['gamepage', 'playsuccess', 'playfail'].includes(page)) return true;
            return false;
          }
        });
      } catch (e) {
        console.warn('creativeInput state poll', e);
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

  handleGoBack() {
    const roomId = this.data.roomId || '';
    safeNavigateBack({
      expectedPrev: 'pages/main-pages/halliGalli/gamepage/index',
      fallbackUrl: roomId
        ? `/pages/main-pages/halliGalli/gamepage/index?roomId=${encodeURIComponent(roomId)}`
        : '/pages/main-pages/modeIndex/index?modeId=halliGalli'
    });
  }
});
