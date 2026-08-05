const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');

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
    this._loadHostStatus();
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
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    const { clearLocalBrainstormProgress } = require('../../../../utils/roomBrainstormProgress');
    clearLocalBrainstormProgress(roomId);
    wx.reLaunch({
      url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
    });
  },

  onBackToRoom() {
    this._goToRoom();
  },

  async _goToRoom() {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    if (this._goingToRoom) return;
    this._goingToRoom = true;

    const { clearLocalBrainstormProgress } = require('../../../../utils/roomBrainstormProgress');
    clearLocalBrainstormProgress(roomId);

    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'addPlayer',
          partnerGamePhase: 'play',
          partnerMasterMode: false,
          resetClosingVotes: true,
          clearBrainstormProgress: true,
          brainstormSessionEnded: true
        }
      });
    } catch (e) {
      console.warn('closingEnd _goToRoom updateRoomState', e);
    }

    this._reLaunchRoom();
  }
});
