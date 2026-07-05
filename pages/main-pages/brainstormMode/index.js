const AVATAR_IMAGES = [
  '/assets/avatar/Frame 2085662241.png',
  '/assets/avatar/Frame 2085662242.png',
  '/assets/avatar/Frame 2085662243.png',
  '/assets/avatar/Frame 2085662244.png',
  '/assets/avatar/Frame 2085662245.png',
  '/assets/avatar/Frame 2085662246.png',
  '/assets/avatar/Frame 2085662247.png',
  '/assets/avatar/Frame 2085662248.png',
  '/assets/avatar/Frame 2085662249.png'
];

/** 脑暴模式配置：共用 modeIndex 页，通过 modeId 区分 */
const MODE_INDEX_PATH = '/pages/main-pages/modeIndex/index';
const { clearPartnerSpecialMoveUsedFlag } = require('../../../utils/partnerSpecialMove');
const { PARTNER_MODE_DISPLAY_TITLE } = require('../../../utils/modeDisplayNames');

const BRAINSTORM_MODES = [
  {
    id: 'halliGalli',
    title: '德国心脏病模式',
    description: '快节奏卡牌对决，\n在限时竞速中碰撞创意火花',
    coverImage: '/assets/brainstormMode/mode-cover-halligalli.png',
    pagePath: MODE_INDEX_PATH
  },
  {
    id: 'partner',
    title: PARTNER_MODE_DISPLAY_TITLE,
    description: '团队协作，\n共同打磨并提交最佳创意方案',
    coverImage: '/assets/brainstormMode/mode-cover-partner.png',
    pagePath: MODE_INDEX_PATH
  },
  {
    id: 'spy',
    title: '谁是卧底模式',
    description: '在描述与推理中隐藏差异，\n激发多元视角与灵感',
    coverImage: '/assets/brainstormMode/mode-cover-spy.png',
    pagePath: MODE_INDEX_PATH
  }
];

Page({
  data: {
    roomId: '',
    isHost: false,
    workshopName: '脑暴工作坊',
    avatarList: [],
    currentUser: null,
    brainstormModes: BRAINSTORM_MODES,
    selectedModeId: null,
    isSelecting: false,
    navbarPaddingTop: 0
  },

  onLoad(options) {
    let navbarPaddingTop = 44;
    try {
      const sys = wx.getSystemInfoSync();
      navbarPaddingTop = (sys.statusBarHeight || 0) + 16;
    } catch (e) {
      console.warn('getSystemInfo for navbar', e);
    }

    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isHost = options && (options.isHost === '1' || options.isHost === true);
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    getApp().globalData.roomId = roomId;
    this.setData({ roomId, isHost: !!isHost, navbarPaddingTop });
    this.loadRoomData(roomId);
  },

  onShow() {
    if (this.data.roomId) {
      this.loadRoomData(this.data.roomId, { silent: true });
    }
  },

  onUnload() {
    this._stopStatePolling();
  },

  async loadRoomData(roomId, opts = {}) {
    const silent = opts && opts.silent === true;
    if (!silent) wx.showLoading({ title: '加载中…' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (!silent) wx.hideLoading();

      if (result.ok !== true) {
        if (!silent) {
          wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        }
        return;
      }

      const avatarList = this._buildAvatarList(result.members || []);
      const me = avatarList.find((item) => item.isMe);
      this.setData({
        workshopName: result.workshopName || '脑暴工作坊',
        avatarList,
        currentUser: me ? me.id : null,
        isHost: result.isHost === true
      });

      if (result.isHost === true) {
        this._stopStatePolling();
      } else {
        this._startStatePolling();
      }
    } catch (err) {
      if (!silent) {
        wx.hideLoading();
        wx.showToast({ title: err.errMsg || '加载失败', icon: 'none' });
      }
    }
  },

  _buildAvatarList(members) {
    return (members || []).map((m, i) => {
      const idx = m.avatarIndex != null ? m.avatarIndex : i % AVATAR_IMAGES.length;
      return {
        id: m.userId || String(m.playerIndex),
        nickName: m.nickName || `玩家${m.playerIndex}`,
        avatarImage: AVATAR_IMAGES[idx % AVATAR_IMAGES.length],
        isMe: m.isMe === true
      };
    });
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        if (result.ok !== true || !result.roomState) return;
        const page = (result.roomState.currentPage || '').toLowerCase();
        const roomIdEnc = encodeURIComponent(roomId);
        if (page === 'gamepage') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          wx.redirectTo({ url: `/pages/main-pages/halliGalli/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}` });
        } else if (page === 'creativeinput') {
          wx.redirectTo({ url: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}` });
        } else if (page === 'creativesummary') {
          wx.redirectTo({ url: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}` });
        }
      } catch (e) {
        console.warn('brainstormMode state poll', e);
      }
    };
    poll();
    this._statePollTimer = setInterval(poll, 1500);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  /** 点击模式卡片：仅切换视觉选中状态 */
  onTapMode(e) {
    if (!this.data.isHost) {
      wx.showToast({ title: '等待房主选择', icon: 'none' });
      return;
    }
    const modeId = e.currentTarget.dataset.id;
    this.setData({ selectedModeId: modeId });
  },

  /** 点击"确认模式"按钮：调用云函数并跳转到对应模式页 */
  async onConfirmMode() {
    if (!this.data.isHost) return;
    if (this.data.isSelecting) return;

    const modeId = this.data.selectedModeId;
    if (!modeId) {
      wx.showToast({ title: '请先选择一种模式', icon: 'none' });
      return;
    }

    const mode = this.data.brainstormModes.find((item) => item.id === modeId);
    if (!mode) return;

    this.setData({ isSelecting: true });
    wx.showLoading({ title: '进入模式…' });

    try {
      const callRes = await wx.cloud.callFunction({
        name: 'roomSetBrainstormMode',
        data: {
          roomId: this.data.roomId,
          selectedModeId: mode.id,
          selectedModeTitle: mode.title,
          selectedModeDesc: mode.description
        }
      });
      const result = (callRes && callRes.result) || {};
      wx.hideLoading();

      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '选择失败', icon: 'none' });
        this.setData({ isSelecting: false });
        return;
      }

      getApp().globalData.selectedMode = {
        id: mode.id,
        title: mode.title,
        description: mode.description
      };
      clearPartnerSpecialMoveUsedFlag(this.data.roomId);

      wx.navigateTo({
        url: `${mode.pagePath}?roomId=${encodeURIComponent(this.data.roomId)}&modeId=${encodeURIComponent(mode.id)}`,
        complete: () => {
          this.setData({ isSelecting: false });
        }
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.errMsg || '选择失败', icon: 'none' });
      this.setData({ isSelecting: false });
    }
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({
          url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(this.data.roomId)}`
        });
      }
    });
  }
});
