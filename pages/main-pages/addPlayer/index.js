const MEMBER_SLOTS = 6;   // 圆周展示的槽位数（含空位）
const CIRCLE_R = 280;     // 头像圆心半径 rpx
const AVATAR_SIZE = 80;   // 头像直径 rpx
const CENTER_XY = 300;    // 圆心在 600rpx 区域内的坐标
const START_ANGLE = -Math.PI / 2; // 从顶部开始

Page({
  data: {
    roomId: '',
    workshopName: '脑暴工作坊',
    qrcodeUrl: '',
    qrcodeStatus: 'loading', // loading | success | no_qr | error
    members: [],
    memberSlots: [], // 用于圆周均分展示的槽位（含占位）
    isFromScan: false,
    isHost: true // 房主为 true，普通玩家为 false
  },

  onLoad(options) {
    let roomId = (options && options.roomId) || '';
    const scene = options && options.scene;

    if (scene) {
      try {
        const decoded = decodeURIComponent(scene);
        const match = decoded.match(/rid=([^&]+)/);
        if (match && match[1]) roomId = match[1].trim();
      } catch (e) {
        console.error('scene decode error', e);
      }
    }

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.reLaunch({ url: '/pages/auth/index' }), 1500);
      return;
    }

    // 将 roomId 存为全局变量，供 auth 等后续页面使用
    getApp().globalData.roomId = roomId;

    this.setData({
      roomId,
      isFromScan: !!scene
    });

    if (scene) {
      this.joinRoomThenLoad(roomId);
    } else {
      this.loadRoomData(roomId).then((result) => {
        if (result && result.isHost) {
          this._updateRoomState('addPlayer');
          this._startMemberPolling();
        } else if (result && !result.isHost) {
          this._startStatePolling();
        }
      });
    }
  },

  onUnload() {
    this._stopMemberPolling();
    this._stopStatePolling();
  },

  /** 房主更新房间当前页状态 */
  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName) {
    const roomId = this.data.roomId;
    if (!roomId) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: { roomId, currentPage, currentPlayerIndex, currentPlayerName }
      });
    } catch (e) {
      console.warn('updateRoomState', e);
    }
  },

  /** 普通玩家：轮询房间状态，跟随房主跳转 */
  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId;
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        if (result.ok !== true || !result.roomState) return;
        const page = (result.roomState.currentPage || 'addPlayer').toLowerCase();
        const roomIdEnc = encodeURIComponent(roomId);
        if (page === 'auth' || page === 'selectbg' || page === 'selectproblem') {
          wx.redirectTo({ url: '/pages/auth/index?isWaiting=1' });
        } else if (page === 'selectplayer') {
          wx.redirectTo({ url: `/pages/main-pages/selectPlayer/index?roomId=${roomIdEnc}&isWaiting=1` });
        } else if (page === 'gamepage') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          wx.redirectTo({ url: `/pages/main-pages/normal-gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}` });
        } else if (page === 'statement') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          wx.redirectTo({ url: `/pages/main-pages/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isWaiting=1` });
        } else if (page === 'leaderboard') {
          wx.redirectTo({ url: `/pages/Leaderboard/index?roomId=${roomIdEnc}` });
        }
      } catch (e) {
        console.warn('state poll', e);
      }
    };
    this._statePollTimer = setInterval(poll, 2000);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  /** 房主端：定时轮询成员列表，以便新玩家扫码加入后自动刷新展示 */
  _startMemberPolling() {
    this._stopMemberPolling();
    const poll = () => {
      const roomId = this.data.roomId;
      if (roomId) this.loadRoomData(roomId, { silent: true });
    };
    this._memberPollTimer = setInterval(poll, 3000);
  },

  _stopMemberPolling() {
    if (this._memberPollTimer) {
      clearInterval(this._memberPollTimer);
      this._memberPollTimer = null;
    }
  },

  /**
   * 扫码进入：先加入房间再拉取数据
   */
  async joinRoomThenLoad(roomId) {
    wx.showLoading({ title: '加入中…' });
    try {
      const joinRes = await wx.cloud.callFunction({
        name: 'roomJoin',
        data: { roomId }
      });
      const result = (joinRes && joinRes.result) || {};
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '加入失败', icon: 'none' });
        return;
      }
      this.loadRoomData(roomId).then((result) => {
        if (result && !result.isHost) this._startStatePolling();
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.errMsg || '加入失败', icon: 'none' });
    }
  },

  /**
   * 拉取房间小程序码 + 成员列表，并计算圆周槽位
   * @param {string} roomId
   * @param {object} [opts] - { silent: true } 静默刷新，仅更新成员列表（不弹 loading、不碰二维码），用于房主轮询
   */
  async loadRoomData(roomId, opts = {}) {
    const silent = opts && opts.silent === true;
    if (!silent) {
      this.setData({ qrcodeStatus: 'loading' });
      wx.showLoading({ title: '加载中…' });
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (!silent) wx.hideLoading();
      if (result.ok !== true) {
        if (!silent) {
          this.setData({ qrcodeStatus: 'error' });
          wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        }
        return null;
      }

      const members = result.members || [];
      const memberSlots = this.buildMemberSlots(members);
      const isHost = result.isHost !== false;
      const roomState = result.roomState || { currentPage: 'addPlayer', currentPlayerIndex: 1, currentPlayerName: '玩家1' };

      if (silent) {
        this.setData({ members, memberSlots });
        return result;
      }

      let qrcodeFileID = result.qrcodeFileID;
      // 若无二维码且为创建者，尝试补生成（此前未配置 APP_SECRET 时创建的房间）
      if (!qrcodeFileID) {
        try {
          const regenRes = await wx.cloud.callFunction({
            name: 'regenerateRoomQrcode',
            data: { roomId }
          });
          const regenResult = (regenRes && regenRes.result) || {};
          if (regenResult.ok === true && regenResult.qrcodeFileID) {
            qrcodeFileID = regenResult.qrcodeFileID;
          }
        } catch (e) {
          console.warn('regenerateRoomQrcode 调用失败', e);
        }
      }

      let qrcodeUrl = '';
      let qrcodeStatus = 'no_qr';
      if (qrcodeFileID) {
        try {
          const tempRes = await wx.cloud.getTempFileURL({
            fileList: [qrcodeFileID]
          });
          const first = tempRes && tempRes.fileList && tempRes.fileList[0];
          if (first && first.tempFileURL) {
            qrcodeUrl = first.tempFileURL;
            qrcodeStatus = 'success';
          } else if (first && first.errMsg && first.errMsg !== 'ok') {
            console.error('getTempFileURL err', first.errMsg);
            qrcodeStatus = 'error';
          } else {
            qrcodeStatus = 'error';
          }
        } catch (e) {
          console.error('getTempFileURL exception', e);
          qrcodeStatus = 'error';
        }
      }

      this.setData({
        qrcodeUrl,
        qrcodeStatus,
        members,
        memberSlots,
        isHost,
        roomState
      });
      return result;
    } catch (err) {
      if (!silent) {
        wx.hideLoading();
        this.setData({ qrcodeStatus: 'error' });
        wx.showToast({ title: err.errMsg || '加载失败', icon: 'none' });
      }
      return null;
    }
  },

  /** 下拉刷新：重新拉取成员列表与二维码 */
  onPullDownRefresh() {
    const roomId = this.data.roomId;
    if (roomId) {
      this.loadRoomData(roomId).finally(() => {
        wx.stopPullDownRefresh();
      });
    } else {
      wx.stopPullDownRefresh();
    }
  },

  /** 重试加载二维码（下拉刷新或点击重试） */
  handleRetryQrcode() {
    const roomId = this.data.roomId;
    if (roomId) this.loadRoomData(roomId);
  },

  /**
   * 构建圆周均分槽位：N 个槽位，有人的显示头像+名字，空位显示占位
   */
  buildMemberSlots(members) {
    const n = MEMBER_SLOTS;
    const slots = [];
    const half = AVATAR_SIZE / 2;
    for (let i = 0; i < n; i++) {
      const angle = START_ANGLE + (i * 2 * Math.PI) / n;
      const member = members[i] || null;
      const left = Math.round(CENTER_XY + CIRCLE_R * Math.cos(angle) - half);
      const top = Math.round(CENTER_XY + CIRCLE_R * Math.sin(angle) - half);
      slots.push({
        index: i,
        left,
        top,
        member
      });
    }
    return slots;
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: '/pages/main-pages/setRoom/index'
        });
      }
    });
  },

  handleComplete() {
    const roomId = this.data.roomId || '';
    if (roomId) getApp().globalData.roomId = roomId;
    this._updateRoomState('auth');
    wx.navigateTo({
      url: '/pages/auth/index'
    });
  }
});
