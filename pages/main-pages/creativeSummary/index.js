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

  async onShow() {
    const roomId = this.data.roomId || '';
    if (roomId) {
      await this.loadRoomData(roomId);
      this._startWatch(roomId);
    }
  },

  onUnload() {
    this._stopWatch();
  },

  async loadData(roomId) {
    await this.loadRoomData(roomId);
    await this.loadSummary(roomId);
    this._startWatch(roomId);
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
      this._applyIdeasToSummary(ideas);
    } catch (e) {
      console.warn('creativeSummary loadSummary', e);
    }
  },

  _applyIdeasToSummary(ideas) {
    const ideaMap = {};
    (ideas || []).forEach(item => {
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
  },

  async _startWatch(roomId) {
    this._stopWatch();
    let db;
    try {
      db = await this._getDB();
    } catch (e) {
      return;
    }
    const collection = db.collection(this._ideaCollection);
    if (typeof collection.watch !== 'function') {
      this._startPolling(roomId);
      return;
    }
    try {
      this._watcher = collection.where({
        roomId,
        entryType: this._ideaEntryType
      }).watch({
        onChange: (snapshot) => {
          const docs = (snapshot && snapshot.docs) || [];
          this._applyIdeasToSummary(docs);
        },
        onError: (err) => {
          console.warn('creativeSummary watch error', err);
          this._startPolling(roomId);
        }
      });
    } catch (e) {
      console.warn('creativeSummary watch init', e);
      this._startPolling(roomId);
    }
  },

  _stopWatch() {
    if (this._watcher && typeof this._watcher.close === 'function') {
      try {
        this._watcher.close();
      } catch (e) {}
      this._watcher = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  _startPolling(roomId) {
    this._stopWatch();
    this._pollTimer = setInterval(() => {
      if (this.data.roomId) this.loadSummary(roomId);
    }, 2000);
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
