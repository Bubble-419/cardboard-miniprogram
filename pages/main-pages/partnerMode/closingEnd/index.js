const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');

Page({
  data: {
    roomId: '',
    countdown: 5,
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
    this._startCountdown();
  },

  onUnload() {
    this._clearCountdown();
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
              this._clearCountdown();
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

  _startCountdown() {
    this._clearCountdown();
    let remaining = 5;
    this.setData({ countdown: remaining });
    this._countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this._clearCountdown();
        this._goToRoom();
        return;
      }
      this.setData({ countdown: remaining });
    }, 1000);
  },

  _clearCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
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

  async _goToRoom() {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    if (this._goingToRoom) return;
    this._goingToRoom = true;

    const { clearLocalBrainstormProgress } = require('../../../../utils/roomBrainstormProgress');
    clearLocalBrainstormProgress(roomId);

    // 任意端进入 closingEnd 后都应落盘 ended，避免房主卡住导致「再来一轮」永不出现
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
