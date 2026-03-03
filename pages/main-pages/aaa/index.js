Page({
  data: {
    loading: false
  },

  onLoad() {},

  /**
   * 点击按钮：调用云函数创建房间，拿到 roomId 后跳转 addPlayer
   */
  async handleCreateAndGo() {
    if (this.data.loading) return;

    this.setData({ loading: true });
    const clientCreateId = `client-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

    try {
      const res = await wx.cloud.callFunction({
        name: 'roomCreate',
        data: { clientCreateId }
      });

      const result = (res && res.result) || {};
      if (result.ok !== true) {
        console.error('roomCreate error', result);
        wx.showToast({
          title: result.errMsg || '创建失败，请重试',
          icon: 'none'
        });
        return;
      }

      const roomId = result.roomId;
      if (!roomId) {
        wx.showToast({ title: '未返回房间号', icon: 'none' });
        return;
      }

      wx.navigateTo({
        url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
      });
    } catch (err) {
      console.error('roomCreate fail', { errMsg: err.errMsg, errCode: err.errCode });
      wx.showToast({
        title: err.errMsg || '创建失败，请重试',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  }
});
