/**
 * 德国心脏病模式 - 游戏页
 * 路径：pages/main-pages/halliGalli/gamepage/
 */
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');

Page({
  data: {
    navbarPaddingTop: 0,
    roomId: '',
    members: [],
    avatarList: [],
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    isHost: false,
    selectedBG: null
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10) : 1;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    let navbarPaddingTop = 0;
    try {
      const sys = wx.getSystemInfoSync();
      const h = sys.statusBarHeight || 0;
      if (sys.platform === 'ios') {
        navbarPaddingTop = Math.max(6, h - 36);
      } else {
        navbarPaddingTop = h;
      }
    } catch (e) {
      console.warn('getSystemInfo for navbar', e);
    }

    this.setData({
      roomId,
      currentPlayerIndex,
      navbarPaddingTop,
      selectedBG: getApp().globalData.selectedBG || null
    });

    this.loadRoomData(roomId);
  },

  onUnload() {
    this._stopStatePolling();
  },

  async loadRoomData(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.members || !result.members.length) {
        if (followSubScreenRoomPoll(result, roomId)) return;
        wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        return;
      }

      const members = result.members;
      const { assignAvatarImages } = require('../../../../utils/avatars');
      const enriched = assignAvatarImages(members);
      const avatarList = enriched.map(m => ({
        id: m.playerIndex,
        avatar: m.avatarImage || m.avatarUrl || '',
        nickName: m.nickName,
        isMe: m.isMe
      }));

      const current = members.find(m => m.playerIndex === this.data.currentPlayerIndex);
      const currentPlayerName = current
        ? (current.nickName || `玩家${this.data.currentPlayerIndex}`)
        : `玩家${this.data.currentPlayerIndex}`;
      const isHost = result.isHost === true;
      const selectedBG = this.data.selectedBG || getApp().globalData.selectedBG || null;

      this.setData({
        members,
        avatarList,
        currentPlayerName,
        isHost,
        selectedBG
      });

      if (result.isHost === true) {
        this._updateRoomState('gamepage', this.data.currentPlayerIndex, currentPlayerName);
        this._stopStatePolling();
      } else {
        this._startStatePolling();
      }
    } catch (e) {
      console.error('loadRoomData', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  /** 非房主：轮询房间状态，房主结束游戏时跟随跳转 */
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
        followSubScreenRoomPoll(result, roomId);
      } catch (e) {
        console.warn('halliGalli gamepage state poll', e);
      }
    };
    this._statePollTimer = setInterval(poll, 1500);
    poll();
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName) {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    try {
      const data = { roomId, currentPage };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data
      });
    } catch (e) {
      console.warn('updateRoomState', e);
    }
  },

  handleEndGame() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '房间信息丢失', icon: 'none' });
      return;
    }
    const roomIdEnc = encodeURIComponent(roomId);
    wx.showLoading({ title: '请稍候…', mask: true });
    this._updateRoomState('creativeInput').then(() => {
      wx.hideLoading();
      wx.redirectTo({ url: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}` });
    }).catch(() => {
      wx.hideLoading();
      wx.redirectTo({ url: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}` });
    });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/main-pages/addPlayer/index' });
      }
    });
  }
});
