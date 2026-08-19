/** 脑暴模式配置：共用 modeIndex 页，通过 modeId 区分 */
const MODE_INDEX_PATH = '/pages/main-pages/modeIndex/index';
const { clearPartnerSpecialMoveUsedFlag } = require('../../../utils/partnerSpecialMove');
const { openSubAwait } = require('../../../utils/subAwaitRoutes');
const { PARTNER_MODE_DISPLAY_TITLE } = require('../../../utils/modeDisplayNames');
const { goRoomPage } = require('../../../utils/goRoomPage');
const { buildAvatarListAsync } = require('../../../utils/avatars');
const { callCloudFunction } = require('../../../utils/cloudApi');
const { getCapsuleTopBarMetrics } = require('../../../utils/capsuleTopBar');
const { safeNavigateBack } = require('../../../utils/pageNavigate');

const BRAINSTORM_MODES = [
  {
    id: 'halliGalli',
    title: '德国心脏病模式',
    description: '快节奏卡牌对决，\n在限时竞速中碰撞创意火花',
    coverImage: '/assets/brainstormMode/mode-cover-halligalli.jpg',
    pagePath: MODE_INDEX_PATH
  },
  {
    id: 'partner',
    title: PARTNER_MODE_DISPLAY_TITLE,
    description: '团队协作，\n共同打磨并提交最佳创意方案',
    coverImage: '/assets/brainstormMode/mode-cover-partner.jpg',
    pagePath: MODE_INDEX_PATH
  },
  {
    id: 'spy',
    title: '谁是卧底模式',
    description: '在描述与推理中隐藏差异，\n激发多元视角与灵感',
    coverImage: '/assets/brainstormMode/mode-cover-spy.jpg',
    pagePath: '/packageSpy/pages/modeIndex/index'
  }
];

function cloneModes() {
  return BRAINSTORM_MODES.map((item) => ({ ...item }));
}

function cloneModesWithoutCover() {
  return BRAINSTORM_MODES.map((item) => ({ ...item, coverImage: '' }));
}

function parseIsHostOption(options) {
  if (!options) return false;
  const raw = options.isHost;
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}

function computeScrollHeight() {
  try {
    const sys = wx.getSystemInfoSync();
    const windowHeight = sys.windowHeight || 667;
    const footerReserve = 120 + (sys.safeAreaInsets && sys.safeAreaInsets.bottom
      ? sys.safeAreaInsets.bottom
      : 0);
    const m = getCapsuleTopBarMetrics();
    const headerReserve = (m.padTop || 0) + (m.barHeight || 32) + 140;
    return Math.max(320, windowHeight - headerReserve - footerReserve);
  } catch (e) {
    return 520;
  }
}

Page({
  data: {
    roomId: '',
    isHost: false,
    workshopName: '脑暴工作坊',
    avatarList: [],
    currentUser: null,
    brainstormModes: cloneModesWithoutCover(),
    selectedModeId: null,
    isSelecting: false,
    scrollHeight: 520
  },

  onLoad(options) {
    this._pageAlive = true;
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isHost = parseIsHostOption(options);
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    getApp().globalData.roomId = roomId;
    // 首帧不挂封面，先把路由落地；封面延后挂载
    this.setData({
      roomId,
      isHost,
      scrollHeight: computeScrollHeight(),
      brainstormModes: cloneModesWithoutCover()
    });

    if (!isHost) {
      this._redirectNonHostToAwait();
    } else {
      this._updateRoomState('brainstormMode');
    }
  },

  onReady() {
    this._readyOnce = true;
    if (!this._pageAlive || !this.data.roomId || !this.data.isHost) return;
    // 先刷房间数据，封面再延后一帧挂载，降低首屏解码压力
    this._scheduleRoomRefresh({ silent: true });
    this._coverLoadTimer = setTimeout(() => {
      this._coverLoadTimer = null;
      if (this._pageAlive) {
        this.setData({ brainstormModes: cloneModes() });
      }
    }, 280);
  },

  onShow() {
    if (!this._pageAlive || !this._readyOnce || !this.data.roomId || !this.data.isHost) return;
    this._scheduleRoomRefresh({ silent: true });
  },

  onHide() {
    if (this._roomRefreshTimer) {
      clearTimeout(this._roomRefreshTimer);
      this._roomRefreshTimer = null;
    }
    if (this._coverLoadTimer) {
      clearTimeout(this._coverLoadTimer);
      this._coverLoadTimer = null;
    }
  },

  onUnload() {
    this._pageAlive = false;
    if (this._roomRefreshTimer) {
      clearTimeout(this._roomRefreshTimer);
      this._roomRefreshTimer = null;
    }
    if (this._coverLoadTimer) {
      clearTimeout(this._coverLoadTimer);
      this._coverLoadTimer = null;
    }
  },

  _scheduleRoomRefresh(opts = {}) {
    if (this._roomRefreshTimer) {
      clearTimeout(this._roomRefreshTimer);
    }
    this._roomRefreshTimer = setTimeout(() => {
      this._roomRefreshTimer = null;
      this.refreshRoomData(opts);
    }, 120);
  },

  async refreshRoomData(opts = {}) {
    if (!this._pageAlive || this._roomRefreshInFlight) return;
    const silent = opts && opts.silent === true;
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;

    this._roomRefreshInFlight = true;
    try {
      const res = await callCloudFunction('getAddPlayerData', { roomId });
      if (!this._pageAlive) return;
      const result = (res && res.result) || {};
      if (result.ok !== true) {
        if (!silent) {
          wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        }
        return;
      }

      let avatarList = [];
      try {
        avatarList = await buildAvatarListAsync(result.members || []);
      } catch (e) {
        console.warn('brainstormMode buildAvatarList', e);
      }
      const me = avatarList.find((item) => item.isMe);
      const isHost = result.isHost === true;
      this.setData({
        workshopName: result.workshopName || '脑暴工作坊',
        avatarList,
        currentUser: me ? me.id : null,
        isHost
      });

      if (!isHost) {
        this._redirectNonHostToAwait();
        return;
      }
      this._publishSelectingModeState();
    } catch (err) {
      console.warn('brainstormMode refreshRoomData', err);
      if (!silent) {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      }
    } finally {
      this._roomRefreshInFlight = false;
    }
  },

  _redirectNonHostToAwait() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    openSubAwait(roomId, 'brainstormMode');
  },

  async _updateRoomState(currentPage) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId || !currentPage) return false;
    try {
      const res = await callCloudFunction('updateRoomState', { roomId, currentPage });
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('brainstormMode updateRoomState', e);
      return false;
    }
  },

  _publishSelectingModeState() {
    if (this.data.isHost !== true) return;
    this._updateRoomState('brainstormMode');
  },

  onTapMode(e) {
    if (!this.data.isHost) {
      wx.showToast({ title: '等待房主选择', icon: 'none' });
      return;
    }
    const modeId = e.currentTarget.dataset.id;
    this.setData({ selectedModeId: modeId });
  },

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
      const callRes = await callCloudFunction('roomSetBrainstormMode', {
        roomId: this.data.roomId,
        selectedModeId: mode.id,
        selectedModeTitle: mode.title,
        selectedModeDesc: mode.description
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

      const targetUrl = `${mode.pagePath}?roomId=${encodeURIComponent(this.data.roomId)}&modeId=${encodeURIComponent(mode.id)}`;
      const openModePage = () => {
        // 谁是卧底：统一 redirectTo，避免与后续跟页叠栈导致不同步
        if (mode.id === 'spy') {
          const { openUrl } = require('../../../utils/pageNavigate');
          const navigated = openUrl(targetUrl, { immediate: true, noReLaunch: true });
          if (this._pageAlive) {
            this.setData({ isSelecting: false });
          }
          if (!navigated) {
            wx.showToast({ title: '打开失败，请重试', icon: 'none' });
          }
          return;
        }
        wx.navigateTo({
          url: targetUrl,
          fail: (err) => {
            const msg = (err && err.errMsg) || '';
            console.error('navigateTo modeIndex fail:', msg, err);
            if (/timeout|busy/i.test(msg)) {
              setTimeout(() => {
                wx.reLaunch({
                  url: targetUrl,
                  fail: (err2) => {
                    console.error('reLaunch modeIndex fail:', err2 && err2.errMsg, err2);
                    wx.showToast({ title: '打开失败，请重试', icon: 'none' });
                  }
                });
              }, 320);
              return;
            }
            wx.redirectTo({
              url: targetUrl,
              fail: (err2) => {
                console.error('redirectTo modeIndex fail:', err2 && err2.errMsg, err2);
                wx.showToast({ title: '打开失败，请重试', icon: 'none' });
              }
            });
          },
          complete: () => {
            if (this._pageAlive) {
              this.setData({ isSelecting: false });
            }
          }
        });
      };
      openModePage();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.errMsg || '选择失败', icon: 'none' });
      this.setData({ isSelecting: false });
    }
  },

  handleGoBack() {
    if (this.data.isHost === true) {
      this._updateRoomState('addPlayer');
    }
    const roomId = this.data.roomId || '';
    const fallbackUrl = roomId
      ? `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
      : '/pages/main-pages/addPlayer/index';
    safeNavigateBack({
      expectedPrev: 'pages/main-pages/addPlayer/index',
      fallbackUrl
    });
  },

  handleGoRoom() {
    if (this.data.isHost === true) {
      this._updateRoomState('addPlayer');
    }
    goRoomPage(this.data.roomId);
  }
});
