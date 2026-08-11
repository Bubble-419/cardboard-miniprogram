const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');
const { safeNavigateBack } = require('../../../utils/pageNavigate');

Page({
  data: {
    roomId: '',
    members: [],
    isHost: false,
    summaryList: [],
    canRestartRound: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ roomId });
    this.loadData(roomId);
  },

  onShow() {
    const roomId = this.data.roomId || '';
    if (roomId) this.loadData(roomId);
  },

  onUnload() {
    this._stopStatePolling();
    this._stopSummaryPolling();
  },

  async loadData(roomId) {
    await this.loadRoomData(roomId);
    await this.loadSummary(roomId);

    if (this.data.isHost) {
      this._stopStatePolling();
    } else {
      this._startStatePolling();
    }
    this._startSummaryPolling(roomId);
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
      this.setData({
        members,
        isHost: result.isHost === true
      });
    } catch (e) {
      console.warn('creativeSummary loadRoomData', e);
    }
  },

  async loadSummary(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'listCreativeIdeas',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) return;

      const ideas = result.ideas || [];
      const ideaMap = {};
      ideas.forEach(item => {
        ideaMap[item.playerIndex] = item;
      });

      const summaryList = (this.data.members || []).map(m => {
        const idea = ideaMap[m.playerIndex];
        return {
          playerIndex: m.playerIndex,
          isMe: m.isMe === true,
          avatar: m.avatarImage || m.avatarUrl || '',
          ideaText: idea ? (idea.ideaText || '') : ''
        };
      });

      const members = this.data.members || [];
      const hasAllMembers = members.length > 0 && summaryList.length === members.length;
      const allFilled = hasAllMembers && summaryList.every(item => {
        const text = (item.ideaText || '').trim();
        return text.length > 0;
      });

      const fingerprint = summaryList
        .map((item) => `${item.playerIndex || ''}:${item.ideaText || ''}`)
        .join('|') + `#${allFilled ? 1 : 0}`;
      if (fingerprint === this._summaryFingerprint) return;
      this._summaryFingerprint = fingerprint;

      this.setData({
        summaryList,
        canRestartRound: allFilled
      });
    } catch (e) {
      console.warn('creativeSummary loadSummary', e);
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        followSubScreenRoomPoll(result, roomId, {
          beforeNavigate: (pollResult, page) => {
            if (page === 'auth') {
              wx.reLaunch({ url: '/pages/main-pages/modeIndex/index?modeId=halliGalli' });
              return true;
            }
            if (page === 'addplayer') {
              wx.redirectTo({
                url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
              });
              return true;
            }
            if (page === 'creativeinput') return true;
            return false;
          }
        });
      } catch (e) {
        console.warn('creativeSummary state poll', e);
      }
    };
    this._statePollTimer = setInterval(poll, 2000);
    poll();
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  _startSummaryPolling(roomId) {
    this._stopSummaryPolling();
    this._summaryPollTimer = setInterval(() => {
      if (this.data.roomId) this.loadSummary(roomId);
    }, 2000);
  },

  _stopSummaryPolling() {
    if (this._summaryPollTimer) {
      clearInterval(this._summaryPollTimer);
      this._summaryPollTimer = null;
    }
  },

  async handleFinish() {
    if (!this.data.isHost) return;
    if (!this.data.canRestartRound) {
      wx.showToast({ title: '请等待所有玩家填写完成', icon: 'none' });
      return;
    }

    const roomId = this.data.roomId || '';
    if (!roomId) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: { roomId, currentPage: 'auth', resetCreativeIdeas: true }
      });
    } catch (e) {
      console.warn('creativeSummary handleFinish updateRoomState', e);
    }
    wx.reLaunch({ url: '/pages/main-pages/modeIndex/index?modeId=halliGalli' });
  },

  async handleGoRoom() {
    if (!this.data.isHost) return;
    if (!this.data.canRestartRound) return;

    const roomId = this.data.roomId || '';
    if (!roomId) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: { roomId, currentPage: 'addPlayer', resetCreativeIdeas: true }
      });
    } catch (e) {
      console.warn('creativeSummary handleGoRoom updateRoomState', e);
    }
    wx.redirectTo({
      url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
    });
  },

  handleGoBack() {
    const roomId = this.data.roomId || '';
    safeNavigateBack({
      expectedPrev: 'pages/main-pages/creativeInput/index',
      fallbackUrl: roomId
        ? `/pages/main-pages/creativeInput/index?roomId=${encodeURIComponent(roomId)}`
        : '/pages/main-pages/modeIndex/index?modeId=halliGalli'
    });
  }
});
