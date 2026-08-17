const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const { goRoomPage, endPartnerSessionAndGoRoom } = require('../../../../utils/goRoomPage');

Page({
  data: {
    roomId: '',
    isHost: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    getApp().globalData.roomId = roomId;
    const { clearLocalBrainstormProgress } = require('../../../../utils/roomBrainstormProgress');
    clearLocalBrainstormProgress(roomId);
    this.setData({ roomId });
    // 结束脑暴后无需再点「查看排行榜」，直接进入
    wx.redirectTo({
      url: `/pages/leaderboard/index?roomId=${encodeURIComponent(roomId)}&from=closingEnd`,
      fail: () => {
        wx.reLaunch({
          url: `/pages/leaderboard/index?roomId=${encodeURIComponent(roomId)}&from=closingEnd`
        });
      }
    });
  },

  onUnload() {
    this._stopFollowPoll();
  },

  async _loadHostStatus() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        const isHost = result.isHost === true;
        this.setData({ isHost });
        if (!isHost) {
          this._startFollowPoll();
        }
      }
    } catch (e) {
      console.warn('closingEnd _loadHostStatus', e);
    }
  },

  _startFollowPoll() {
    this._stopFollowPoll();
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
            if (page === 'addplayer' || pollResult.roomState.brainstormSessionEnded === true) {
              this._stopFollowPoll();
              this._reLaunchRoom();
              return true;
            }
            return false;
          }
        });
      } catch (e) {
        console.warn('closingEnd follow poll', e);
      }
    };
    poll();
    this._followPollTimer = setInterval(poll, 2000);
  },

  _stopFollowPoll() {
    if (this._followPollTimer) {
      clearInterval(this._followPollTimer);
      this._followPollTimer = null;
    }
  },

  _reLaunchRoom() {
    goRoomPage(this.data.roomId || '');
  },

  onBackToRoom() {
    this._goToRoom();
  },

  onViewLeaderboard() {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    wx.navigateTo({
      url: `/pages/leaderboard/index?roomId=${encodeURIComponent(roomId)}&from=closingEnd`,
      fail: () => {
        wx.redirectTo({
          url: `/pages/leaderboard/index?roomId=${encodeURIComponent(roomId)}&from=closingEnd`
        });
      }
    });
  },

  async _goToRoom() {
    if (this._goingToRoom) return;
    this._goingToRoom = true;
    this._stopFollowPoll();
    if (this._hostStatusPromise) {
      try {
        await this._hostStatusPromise;
      } catch (e) {
        console.warn('closingEnd host status', e);
      }
    }
    await endPartnerSessionAndGoRoom(this.data.roomId, { isHost: this.data.isHost });
  }
});
