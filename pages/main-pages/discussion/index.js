const { buildGamepageUrl, buildStatementUrl } = require('../../../utils/modeRoutes');
const { followSubScreenRoomPoll } = require('../../../utils/subScreenRoomPoll');

Page({
    data: {
    navbarPaddingTop: 0,
    contentOffsetTop: 52,
    roomId: '',
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    avatarList: [],
    members: [],
    isHost: false,
    // 直接使用当前页面目录下的图片，避免真机路径解析问题
    discussionImgSrc: './images/discussion.jpg'
  },

  onDiscussionImageError(e) {
    console.error('discussion 图片加载失败：', e);
    wx.showToast({
      title: '图片加载失败',
      icon: 'none'
    });
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10)
      : 1;
    const currentPlayerName = (options && options.currentPlayerName)
      ? decodeURIComponent(options.currentPlayerName)
      : `玩家${currentPlayerIndex}`;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    // 真机 iOS 顶部留白与模拟器不一致，与 gamepage 一致计算
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
    // 固定 60px，与 gamepage 一致，实测合适且不遮挡；iOS/Android 保持一致
    const contentOffsetTop = 60;

    this.setData({
      roomId,
      currentPlayerIndex,
      currentPlayerName,
      navbarPaddingTop,
      contentOffsetTop
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
      if (result.ok !== true || !result.members || !result.members.length) return;

      const members = result.members;
      const avatarList = members.map(m => ({
        id: m.playerIndex,
        avatar: m.avatarUrl || ''
      }));
      const isHost = result.isHost === true;

      this.setData({
        members,
        avatarList,
        isHost
      });

      if (!isHost) {
        this._startStatePolling();
      } else {
        this._stopStatePolling();
      }
    } catch (e) {
      console.warn('loadRoomData error:', e);
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
            const roomIdEnc = encodeURIComponent(roomId);
            const idx = pollResult.roomState.currentPlayerIndex != null
              ? pollResult.roomState.currentPlayerIndex
              : 1;
            const modeId = pollResult.selectedModeId || getApp().globalData.gameMode || 'partner';
            if (page === 'gamepage') {
              wx.redirectTo({ url: buildGamepageUrl(roomId, idx, modeId) });
              return true;
            }
            if (page === 'statement') {
              wx.redirectTo({
                url: buildStatementUrl(
                  roomId,
                  idx,
                  pollResult.roomState.currentPlayerName || `玩家${idx}`,
                  { isWaiting: true }
                )
              });
              return true;
            }
            if (page === 'creativeinput') {
              wx.redirectTo({
                url: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}`
              });
              return true;
            }
            if (page === 'creativesummary') {
              wx.redirectTo({
                url: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}`
              });
              return true;
            }
            return false;
          }
        });
      } catch (e) {
        console.warn('discussion state poll error:', e);
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

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: '/pages/main-pages/addPlayer/index'
        });
      }
    });
  },

  // 房主点击“继续游戏”
  async handleContinue() {
    if (!this.data.isHost) return;

    const { roomId, members, currentPlayerIndex } = this.data;
    if (!roomId || !members || !members.length) return;

    const count = members.length;
    const nextIndex = (currentPlayerIndex % count) + 1;
    const nextMember = members.find(m => m.playerIndex === nextIndex);
    const nextPlayerName = nextMember
      ? (nextMember.nickName || `玩家${nextIndex}`)
      : `玩家${nextIndex}`;
    const isCyclingBack = nextIndex === 1;

    try {
      await this._updateRoomState(
        'gamepage',
        nextIndex,
        nextPlayerName,
        isCyclingBack
      );
    } catch (e) {
      console.warn('updateRoomState error:', e);
    }

    const modeId = getApp().globalData.gameMode || 'partner';
    wx.redirectTo({
      url: buildGamepageUrl(roomId, nextIndex, modeId)
    });
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName, incrementRound) {
    const roomId = this.data.roomId || '';
    if (!roomId) return;

    const data = { roomId, currentPage };
    if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
    if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
    if (incrementRound === true) data.incrementRound = true;

    await wx.cloud.callFunction({
      name: 'updateRoomState',
      data
    });
  }
});
