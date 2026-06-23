Page({
  _ideaCollection: 'designProblems',
  _ideaEntryType: 'creativeIdea',

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
      const db = await this._getDB();
      const res = await db.collection(this._ideaCollection).where({
        roomId,
        entryType: this._ideaEntryType
      }).get();
      const ideas = (res && res.data) || [];
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
        if (result.ok !== true || !result.roomState) return;
        const page = (result.roomState.currentPage || '').toLowerCase();
        if (page === 'auth') {
          wx.reLaunch({ url: '/pages/main-pages/halliGalli/modeIndex/index' });
        }
      } catch (e) {
        console.warn('creativeSummary state poll', e);
      }
    };
    this._statePollTimer = setInterval(poll, 1000);
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
        data: { roomId, currentPage: 'auth' }
      });
    } catch (e) {
      console.warn('creativeSummary handleFinish updateRoomState', e);
    }
    wx.reLaunch({ url: '/pages/main-pages/halliGalli/modeIndex/index' });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/main-pages/halliGalli/modeIndex/index' });
      }
    });
  },

  async _getDB() {
    const cloud = wx.cloud || {};
    let db = null;
    try {
      if (typeof cloud.database === 'function') {
        const maybeDb = cloud.database();
        if (maybeDb && typeof maybeDb.then === 'function') {
          db = await maybeDb;
        } else {
          db = maybeDb;
        }
      } else if (cloud.database && typeof cloud.database.collection === 'function') {
        db = cloud.database;
      }
    } catch (e) {
      db = null;
    }
    if (!db || typeof db.collection !== 'function') {
      throw new Error('云数据库不可用，请检查云开发初始化');
    }
    return db;
  }
});
