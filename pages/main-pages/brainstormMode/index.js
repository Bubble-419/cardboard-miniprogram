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

/** 脑暴模式配置：pagePath 为各模式首页 modeIndex，位于 pages/main-pages/<模式名>/modeIndex/ */
const BRAINSTORM_MODES = [
  {
    id: 'halliGalli',
    title: '德国心脏病模式',
    description: '快节奏卡牌对决，在限时竞速中碰撞创意火花',
    icon: '/assets/icons/display.png',
    pagePath: '/pages/main-pages/halliGalli/modeIndex/index'
  },
  {
    id: 'partner',
    title: '合伙人模式',
    description: '两两组队协作，共同打磨并提交最佳创意方案',
    icon: '/assets/icons/share.png',
    pagePath: '/pages/main-pages/partnerMode/modeIndex/index'
  },
  {
    id: 'spy',
    title: '谁是卧底模式',
    description: '在描述与推理中隐藏差异，激发多元视角与灵感',
    icon: '/assets/icons/question-mark.png',
    pagePath: '/pages/main-pages/spyMode/modeIndex/index'
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
    currentCardIndex: 0,
    isSelecting: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isHost = options && (options.isHost === '1' || options.isHost === true);
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    getApp().globalData.roomId = roomId;
    this.setData({ roomId, isHost: !!isHost });
    this.loadRoomData(roomId);
  },

  onShow() {
    if (this.data.roomId) {
      this.loadRoomData(this.data.roomId, { silent: true });
    }
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

  onSwiperChange(e) {
    const current = e.detail && e.detail.current;
    if (current != null) {
      this.setData({ currentCardIndex: current });
    }
  },

  /** 房主点击模式卡片：保存选择并跳转至对应模式游戏页 */
  async onSelectMode(e) {
    if (!this.data.isHost) {
      wx.showToast({ title: '等待房主选择', icon: 'none' });
      return;
    }
    if (this.data.isSelecting) return;

    const modeId = e.currentTarget.dataset.id;
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
