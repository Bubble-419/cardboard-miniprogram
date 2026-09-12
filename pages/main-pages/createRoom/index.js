const { dispatchRoomCommand } = require('../../../modules/room-session/index');

function generateClientCreateId() {
  return `create_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

Page({
  data: { isCreating: false, clientCreateId: '', lastError: null },

  onLoad() { this.setData({ clientCreateId: generateClientCreateId() }); },

  handleGoBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/main-pages/aaa/index' }) });
  },

  async handleCreateRoom() {
    if (this.data.isCreating) return;
    const commandId = this.data.clientCreateId || generateClientCreateId();
    this.setData({ isCreating: true, clientCreateId: commandId, lastError: null });
    try {
      const result = await dispatchRoomCommand('CREATE_ROOM', { nickName: '玩家1' }, {}, { commandId });
      if (!result || result.ok !== true) {
        this.setData({ lastError: { errCode: result && result.errCode, errMsg: result && result.errMsg } });
        wx.showToast({ title: result && result.errMsg || '创建失败，请重试', icon: 'none' });
        return;
      }
      const roomId = result.outcome && result.outcome.roomId;
      wx.navigateTo({ url: `/pages/main-pages/setRoom/index?roomId=${encodeURIComponent(roomId)}` });
    } catch (error) {
      this.setData({ lastError: { errCode: error.code || '', errMsg: error.message || '创建失败' } });
      wx.showToast({ title: '创建失败，请检查网络', icon: 'none' });
    } finally {
      this.setData({ isCreating: false });
    }
  }
});
