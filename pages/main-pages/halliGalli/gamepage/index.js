/**
 * 德国心脏病模式 - 游戏页
 * 路径：pages/main-pages/halliGalli/gamepage/
 */
Page({
  data: {
    navbarPaddingTop: 0,
    contentOffsetTop: 44,
    roomId: '',
    members: [],
    avatarList: [],
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    isHost: false,
    selectedBG: null,
    bgImageSrc: '/assets/icons/bg.jpg'
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

    const contentOffsetTop = 60;
    this.setData({
      roomId,
      currentPlayerIndex,
      navbarPaddingTop,
      contentOffsetTop,
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
        if (result.ok !== true || !result.roomState) return;
        const page = (result.roomState.currentPage || '').toLowerCase();
        const roomIdEnc = encodeURIComponent(roomId);
        if (page === 'creativeinput') {
          wx.redirectTo({ url: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}` });
        } else if (page === 'creativesummary') {
          wx.redirectTo({ url: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}` });
        }
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

  onBgImageError() {
    if (this.data.bgImageSrc.startsWith('/')) {
      this.setData({ bgImageSrc: '../../../../assets/icons/bg.jpg' });
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
    wx.showModal({
      title: '结束游戏',
      content: '是否结束全局游戏？',
      confirmText: '结束',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return;
        const roomId = this.data.roomId || getApp().globalData.roomId || '';
        const url = roomId
          ? `/pages/main-pages/creativeInput/index?roomId=${encodeURIComponent(roomId)}`
          : '/pages/main-pages/modeIndex/index?modeId=halliGalli';
        try {
          await this._updateRoomState('creativeInput');
        } catch (e) {
          console.warn('updateRoomState creativeInput', e);
        }
        wx.redirectTo({ url });
      }
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
