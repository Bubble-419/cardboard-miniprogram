Page({
  data: {
    roomId: '',
    leaderboard: [],
    loading: true,
    error: ''
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      this.setData({
        loading: false,
        error: '缺少房间参数'
      });
      return;
    }
    this.setData({ roomId });
    this.loadLeaderboard(roomId);
  },

  async loadLeaderboard(roomId) {
    this.setData({ loading: true, error: '' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getLeaderboard',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.leaderboard) {
        const leaderboard = result.leaderboard.map((item, index) => ({
          ...item,
          rank: index + 1
        }));
        this.setData({
          leaderboard,
          loading: false
        });
      } else {
        this.setData({
          loading: false,
          error: result.errMsg || '加载失败'
        });
      }
    } catch (e) {
      console.error('loadLeaderboard', e);
      this.setData({
        loading: false,
        error: e.errMsg || '加载失败'
      });
    }
  },

  handleBack() {
    wx.reLaunch({ url: '/pages/auth/index' });
  }
});
