Page({
  data: {
    loading: false
  },

  onLoad() {},

  /**
   * 创建房间：调用云函数创建房间，跳转到 addPlayer 添加成员
   */
  async handleCreateRoom() {
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
  },

  /**
   * 扫码加入房间：调起扫码，解析 roomId 后调用 roomJoin 并跳转 addPlayer
   */
  async handleScanJoin() {
    try {
      const res = await wx.scanCode({
        scanType: ['qrCode'],
        onlyFromCamera: true
      });
      const content = (res && res.result) || '';
      const roomId = this._parseRoomId(content);
      if (!roomId) {
        wx.showToast({ title: '未能识别房间信息，请扫描正确的房间二维码', icon: 'none' });
        return;
      }
      await this._joinRoomAndGo(roomId);
    } catch (err) {
      if (err.errMsg && err.errMsg.includes('cancel')) {
        return;
      }
      wx.showToast({
        title: err.errMsg || '扫码失败',
        icon: 'none'
      });
    }
  },

  /**
   * 从扫码结果中解析 roomId
   * 支持：rid=xxx、roomId=xxx、URL 中的 roomId 参数、纯 roomId 文本
   */
  _parseRoomId(content) {
    if (!content || typeof content !== 'string') return '';
    const s = content.trim();
    // rid=roomId
    let m = s.match(/rid=([^&?#\s]+)/i);
    if (m) return m[1].trim();
    // roomId=xxx
    m = s.match(/roomId=([^&?#\s]+)/i);
    if (m) return m[1].trim();
    // URL 形式
    try {
      const url = s.startsWith('http') ? s : `https://x/?${s}`;
      const u = new URL(url);
      const rid = u.searchParams.get('rid') || u.searchParams.get('roomId');
      if (rid) return rid;
    } catch (_) {}
    // 纯 roomId（形如 1730123456789-123456）
    if (/^[\w-]{10,50}$/.test(s)) return s;
    return '';
  },

  /**
   * 调用 roomJoin 加入房间，成功后跳转 addPlayer
   */
  async _joinRoomAndGo(roomId) {
    wx.showLoading({ title: '加入中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'roomJoin',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '加入失败', icon: 'none' });
        return;
      }
      getApp().globalData.roomId = roomId;
      wx.navigateTo({
        url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.errMsg || '加入失败', icon: 'none' });
    }
  }
});
