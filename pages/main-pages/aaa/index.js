Page({
  data: {
    loading: false,
    inputRoomId: ''
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
      getApp().globalData.roomId = roomId;

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

  onInputRoomId(e) {
    const raw = (e.detail && e.detail.value) || '';
    // 只保留数字，最多 8 位
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    this.setData({ inputRoomId: digits });

    // 自动触发：当达到 8 位数字时尝试加入房间
    if (digits.length === 8) {
      this._autoJoinIfValid(digits);
    }
  },

  /** 加入房间：根据 data-action 区分扫码或输入 */
  handleJoinAction(e) {
    const action = e.currentTarget.dataset.action;
    if (action === 'scan') {
      this.handleScanJoin();
    }
  },

  /**
   * 输入满 8 位数字后自动校验并尝试加入房间
   */
  _autoJoinIfValid(roomId) {
    if (!/^\d{8}$/.test(roomId)) return;
    // 避免重复触发：若正在 loading，则不再发起
    if (this._autoJoining) return;
    this._autoJoining = true;
    this._joinRoomAndGo(roomId).finally(() => {
      this._autoJoining = false;
    });
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
    // 纯 roomId：只支持 8 位数字
    if (/^\d{8}$/.test(s)) return s;
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
