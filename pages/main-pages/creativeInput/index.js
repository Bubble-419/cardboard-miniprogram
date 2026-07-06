const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');

Page({
  _ideaCollection: 'designProblems',
  _ideaEntryType: 'creativeIdea',

  data: {
    roomId: '',
    members: [],
    memberCount: 0, // 仅用于 canViewSummary 判断，不展示
    isHost: false,
    myPlayerIndex: null,
    myNickName: '',
    myAvatar: '',
    ideaText: '',
    submitted: false,
    submittedCount: 0, // 仅用于 canViewSummary 判断，不展示
    canViewSummary: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ roomId });
    this.loadRoomData(roomId);
    this.loadIdeas(roomId);
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
      this.setData({
        members,
        memberCount: members.length, // 不展示，仅用于 canViewSummary
        isHost: result.isHost === true,
        myPlayerIndex: me ? me.playerIndex : null,
        myNickName: me ? (me.nickName || `玩家${me.playerIndex}`) : '',
        myAvatar: me ? (me.avatarImage || me.avatarUrl || '') : ''
      });
      this._updateCanViewSummary(this.data.submittedCount, members.length, result.isHost === true);
    } catch (e) {
      console.warn('creativeInput loadRoomData', e);
    }
  },

  async loadIdeas(roomId) {
    try {
      const db = await this._getDB();
      const res = await db.collection(this._ideaCollection).where({
        roomId,
        entryType: this._ideaEntryType
      }).get();
      const list = (res && res.data) || [];
      const submittedCount = list.length;
      const mine = list.find(i => i.playerIndex === this.data.myPlayerIndex);
      this.setData({
        submittedCount, // 不展示，仅用于 canViewSummary
        submitted: !!mine,
        ideaText: mine ? (mine.ideaText || '') : this.data.ideaText
      });
      this._updateCanViewSummary(submittedCount, this.data.memberCount, this.data.isHost);
    } catch (e) {
      console.warn('creativeInput loadIdeas', e);
    }
  },

  _updateCanViewSummary(submittedCount, memberCount, isHost) {
    const canViewSummary = !!isHost && memberCount > 0 && submittedCount >= memberCount;
    this.setData({ canViewSummary });
  },

  async handleSubmit() {
    const roomId = this.data.roomId;
    const playerIndex = this.data.myPlayerIndex;
    const ideaText = (this.data.ideaText || '').trim();
    if (!roomId) return;
    if (!playerIndex) {
      wx.showToast({ title: '未获取到玩家信息', icon: 'none' });
      return;
    }
    if (!ideaText) {
      wx.showToast({ title: '请先填写创意', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交中…' });
    try {
      const db = await this._getDB();
      const where = { roomId, playerIndex, entryType: this._ideaEntryType };
      const existsRes = await db.collection(this._ideaCollection).where(where).get();
      const nowData = {
        roomId,
        playerIndex,
        entryType: this._ideaEntryType,
        nickName: this.data.myNickName || `玩家${playerIndex}`,
        avatarUrl: this.data.myAvatar || '',
        ideaText,
        updateTime: db.serverDate()
      };
      if (existsRes.data && existsRes.data.length) {
        await db.collection(this._ideaCollection).doc(existsRes.data[0]._id).update({ data: nowData });
      } else {
        await db.collection(this._ideaCollection).add({
          data: {
            ...nowData,
            createTime: db.serverDate()
          }
        });
      }
      wx.showToast({ title: '提交成功', icon: 'success' });
      this.setData({ submitted: true });
      this.loadIdeas(roomId);
      wx.redirectTo({
        url: `/pages/main-pages/creativeSummary/index?roomId=${encodeURIComponent(roomId)}`
      });
    } catch (e) {
      console.error('creativeInput handleSubmit', e);
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
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
      if (!roomId) return;
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
            return false;
          }
        });
      } catch (e) {
        console.warn('creativeInput state poll', e);
      }
    };
    this._statePollTimer = setInterval(poll, 1000);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/main-pages/modeIndex/index?modeId=halliGalli' });
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
