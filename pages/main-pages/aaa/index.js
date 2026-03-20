Page({
  data: {
    loading: false,
    inputRoomId: '',
    inputFocused: false
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

  /** 点击输入区域时聚焦，便于在体验版等环境下能点击输入 */
  onRoomCodeTap() {
    this.setData({ inputFocused: true });
  },

  onRoomCodeFocus() {
    this.setData({ inputFocused: true });
  },

  onRoomCodeBlur() {
    this.setData({ inputFocused: false });
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
      // 调试：先完整打印扫码返回，便于确认不同码型的真实返回结构
      try {
        console.log('[scanCode success]', JSON.stringify(res));
      } catch (_) {
        console.log('[scanCode success raw]', res);
      }
      const roomId = this._parseRoomIdFromScanResult(res);
      if (!roomId) {
        wx.showToast({ title: '未能识别房间信息，请扫描正确的房间二维码', icon: 'none' });
        return;
      }
      await this._joinRoomAndGo(roomId);
    } catch (err) {
      if (err.errMsg && err.errMsg.includes('cancel')) {
        wx.showToast({
          title: '已取消扫码',
          icon: 'none'
        });
        return;
      }
      wx.showToast({
        title: err.errMsg || '扫码失败',
        icon: 'none'
      });
    }
  },

  /**
   * 优先解析小程序码的 path（如 pages/room/index?roomId=123），
   * 再回退到扫码结果字符串解析。
   */
  _parseRoomIdFromScanResult(scanRes) {
    if (!scanRes || typeof scanRes !== 'object') return '';

    // 小程序码优先：从 path 里提取 scene / rid / roomId
    const pathRoomId = this._parseRoomIdFromPath(scanRes.path || '');
    if (pathRoomId) return pathRoomId;

    // 依次尝试 path/result/rawData，兼容不同码型返回结构
    const candidates = [
      scanRes.path || '',
      scanRes.result || '',
      scanRes.rawData || ''
    ];
    for (let i = 0; i < candidates.length; i++) {
      const text = (candidates[i] || '').trim();
      if (!text) continue;
      const roomId = this._parseRoomId(text);
      if (roomId) return roomId;
    }
    return '';
  },

  _parseRoomIdFromPath(path) {
    if (!path || typeof path !== 'string') return '';
    const qIndex = path.indexOf('?');
    if (qIndex < 0) return this._parseRoomId(path);
    const query = path.slice(qIndex + 1);
    const params = this._parseQuery(query);
    const roomId = (
      params.roomId ||
      params.rid ||
      this._extractRoomIdFromScene(params.scene) ||
      ''
    ).trim();
    return roomId;
  },

  /**
   * querystring 转对象：a=1&b=2 => { a: "1", b: "2" }
   */
  _parseQuery(query) {
    const obj = {};
    if (!query || typeof query !== 'string') return obj;
    query.split('&').forEach(item => {
      if (!item) return;
      const eqIndex = item.indexOf('=');
      const key = eqIndex >= 0 ? item.slice(0, eqIndex) : item;
      const value = eqIndex >= 0 ? item.slice(eqIndex + 1) : '';
      if (!key) return;
      const safeKey = this._safeDecodeURIComponent(key);
      const safeValue = this._safeDecodeURIComponent(value);
      obj[safeKey] = safeValue;
    });
    return obj;
  },

  _safeDecodeURIComponent(value) {
    if (typeof value !== 'string') return '';
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  },

  /**
   * 小程序码常见：scene=roomId%3D12345678 或 scene=rid%3D12345678 或 scene=12345678
   */
  _extractRoomIdFromScene(scene) {
    if (!scene || typeof scene !== 'string') return '';
    let decoded = this._safeDecodeURIComponent(scene);
    if (/^\d{8}$/.test(decoded)) return decoded;
    return this._parseRoomId(decoded);
  },

  /**
   * 从扫码结果中解析 roomId
   * 支持：rid=xxx、roomId=xxx、URL 中的 roomId 参数、纯 roomId 文本
   */
  _parseRoomId(content) {
    if (!content || typeof content !== 'string') return '';
    const s = content.trim();

    // 优先对原字符串匹配 rid/roomId，兼容 path 未 decode 的情况
    let m = s.match(/(?:^|[?&])rid=([^&?#\s]+)/i) || s.match(/rid=([^&?#\s]+)/i);
    if (m) return this._safeDecodeURIComponent(m[1]).trim();
    m = s.match(/(?:^|[?&])roomId=([^&?#\s]+)/i) || s.match(/roomId=([^&?#\s]+)/i);
    if (m) return this._safeDecodeURIComponent(m[1]).trim();

    // 对字符串做多轮 decode，兼容 scene 双重编码
    const decodedCandidates = [s];
    let decoded = s;
    for (let i = 0; i < 2; i++) {
      try {
        const next = decodeURIComponent(decoded);
        if (!next || next === decoded) break;
        decodedCandidates.push(next);
        decoded = next;
      } catch (_) {
        break;
      }
    }

    for (let i = 0; i < decodedCandidates.length; i++) {
      const text = decodedCandidates[i];
      // scene=xxxx（对扫码结果字符串先拆 scene）
      let mm = text.match(/scene=([^&?#\s]+)/i);
      if (mm) {
        const byScene = this._extractRoomIdFromScene(mm[1]);
        if (byScene) return byScene;
      }
      // rid=roomId
      mm = text.match(/rid=([^&?#\s]+)/i);
      if (mm) return mm[1].trim();
      // roomId=xxx
      mm = text.match(/roomId=([^&?#\s]+)/i);
      if (mm) return mm[1].trim();
      // 纯 roomId：8 位数字
      mm = text.match(/\b(\d{8})\b/);
      if (mm) return mm[1];
    }

    // scene=xxxx（对扫码结果字符串先拆 scene）
    m = s.match(/scene=([^&?#\s]+)/i);
    if (m) {
      const byScene = this._extractRoomIdFromScene(m[1]);
      if (byScene) return byScene;
    }
    // rid=roomId
    m = s.match(/rid=([^&?#\s]+)/i);
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
      wx.showToast({
        title: '加入成功',
        icon: 'success',
        duration: 1500
      });
      wx.navigateTo({
        url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.errMsg || '加入失败', icon: 'none' });
    }
  }
});
