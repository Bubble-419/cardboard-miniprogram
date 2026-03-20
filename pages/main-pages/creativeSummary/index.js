Page({
  _ideaCollection: 'designProblems',
  _ideaEntryType: 'creativeIdea',

  data: {
    roomId: '',
    members: [],
    isHost: false,
    summaryList: []
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

  async loadData(roomId) {
    await this.loadRoomData(roomId);
    await this.loadSummary(roomId);
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
      this.setData({ summaryList });
    } catch (e) {
      console.warn('creativeSummary loadSummary', e);
    }
  },

  async handleFinish() {
    if (!this.data.isHost) return;
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
    wx.reLaunch({ url: '/pages/auth/index' });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/auth/index' });
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
