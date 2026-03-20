Page({
  data: {
    roomId: '',
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    memberCount: 0,
    passCount: 0,
    members: [],
    nextPlayer: null,
    isHost: false,
    isWaiting: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10) : 1;
    const currentPlayerName = (options && options.currentPlayerName)
      ? decodeURIComponent(options.currentPlayerName) : `玩家${currentPlayerIndex}`;
    const memberCount = options.memberCount != null ? parseInt(options.memberCount, 10) : 0;
    const passCount = options.passCount != null ? parseInt(options.passCount, 10) : 0;
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    this.setData({
      roomId,
      currentPlayerIndex,
      currentPlayerName,
      memberCount: Number.isFinite(memberCount) ? memberCount : 0,
      passCount: Number.isFinite(passCount) ? passCount : 0,
      isWaiting: !!isWaiting
    });

    this.loadRoomData(roomId);
    if (!isWaiting) return;
    this._startStatePolling();
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
      const { assignAvatarImages } = require('../../../utils/avatars');
      const members = assignAvatarImages(result.members);
      const nextPlayer = this._resolveNextPlayer(members, this.data.currentPlayerIndex);
      this.setData({
        members,
        nextPlayer,
        memberCount: this.data.memberCount || members.length,
        isHost: result.isHost === true
      });
    } catch (e) {
      console.warn('playSuccess loadRoomData', e);
    }
  },

  _resolveNextPlayer(members, currentPlayerIndex) {
    const list = members || [];
    if (!list.length) return null;
    const count = list.length;
    const nextIndex = ((currentPlayerIndex || 1) % count) + 1;
    const next = list.find(m => m.playerIndex === nextIndex);
    if (!next) return null;
    return {
      playerIndex: next.playerIndex,
      nickName: next.nickName || `玩家${next.playerIndex}`,
      isMe: next.isMe === true,
      avatar: next.avatarImage || next.avatarUrl || ''
    };
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
        const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
        const roomIdEnc = encodeURIComponent(roomId);
        if (page === 'gamepage') {
          wx.redirectTo({
            url: `/pages/main-pages/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`
          });
        } else if (page === 'creativeinput') {
          wx.redirectTo({ url: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}` });
        } else if (page === 'creativesummary') {
          wx.redirectTo({ url: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}` });
        // 排行榜流程临时下线，本次不使用
        // } else if (page === 'leaderboard') {
        //   wx.redirectTo({ url: `/pages/leaderboard/index?roomId=${roomIdEnc}&isSubScreen=1` });
        }
      } catch (e) {
        console.warn('playSuccess state poll', e);
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

  async handleContinue() {
    if (!this.data.isHost) return;
    const { roomId, currentPlayerIndex, members } = this.data;
    if (!roomId || !members || !members.length) return;

    const count = members.length;
    const nextIndex = (currentPlayerIndex % count) + 1;
    const nextMember = members.find(m => m.playerIndex === nextIndex);
    const nextPlayerName = nextMember ? (nextMember.nickName || `玩家${nextIndex}`) : `玩家${nextIndex}`;
    const isCyclingBack = nextIndex === 1;

    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'gamepage',
          currentPlayerIndex: nextIndex,
          currentPlayerName: nextPlayerName,
          incrementRound: isCyclingBack
        }
      });
    } catch (e) {
      console.warn('playSuccess handleContinue updateRoomState', e);
    }

    wx.redirectTo({
      url: `/pages/main-pages/gamepage/index?roomId=${encodeURIComponent(roomId)}&currentPlayerIndex=${nextIndex}`
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
