Page({
  data: {
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

    this.setData({
      roomId,
      currentPlayerIndex,
      currentPlayerName
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
      const { assignAvatarImages } = require('../../../utils/avatars');
      const enriched = assignAvatarImages(members);
      const avatarList = enriched.map(m => ({
        id: m.playerIndex,
        avatar: m.avatarImage || m.avatarUrl || '',
        nickName: m.nickName,
        isMe: m.isMe
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
        if (result.ok !== true || !result.roomState) return;

        const page = (result.roomState.currentPage || '').toLowerCase();
        const roomIdEnc = encodeURIComponent(roomId);
        const idx = result.roomState.currentPlayerIndex != null
          ? result.roomState.currentPlayerIndex
          : 1;
        const name = encodeURIComponent(
          result.roomState.currentPlayerName || `玩家${idx}`
        );

        if (page === 'gamepage') {
          wx.redirectTo({
            url: `/pages/main-pages/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`
          });
        } else if (page === 'statement') {
          wx.redirectTo({
            url: `/pages/main-pages/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isWaiting=1`
          });
        } else if (page === 'leaderboard') {
          wx.redirectTo({
            url: `/pages/leaderboard/index?roomId=${roomIdEnc}&isSubScreen=1`
          });
        }
      } catch (e) {
        console.warn('discussion state poll error:', e);
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

    wx.redirectTo({
      url: `/pages/main-pages/gamepage/index?roomId=${encodeURIComponent(roomId)}&currentPlayerIndex=${nextIndex}`
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
