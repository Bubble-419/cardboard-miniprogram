/** 脑暴模式配置：共用 modeIndex 页，通过 modeId 区分 */
const MODE_INDEX_PATH = '/pages/main-pages/modeIndex/index';
const { PARTNER_MODE_DISPLAY_TITLE } = require('../../../utils/modeDisplayNames');
const { buildAvatarListAsync } = require('../../../utils/avatars');
const {
  dispatchRoomCommand,
  getRoomPageSnapshot,
  bindPageToRoomSession,
  unbindPageFromRoomSession,
  canRoomCommand,
  getActiveRoomSession,
  goRoomPage,
  followRoomRouteAfterCommand,
  executeProjectedBack
} = require('../../../modules/room-session/index');
const {
  runPageInteraction,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');
const { staticCdnUrl } = require('../../../utils/staticCdn');

const BRAINSTORM_MODE_GROUPS = [
  {
    id: 'component',
    title: '组件卡',
    modes: [{
      id: 'ganDengYan',
      title: '干瞪眼模式',
      description: '组件卡快速组合，\n在线下对局中激发创意',
      // baseline 阶段复用 Halli 流程及封面，后续规则独立演进时可替换专属素材。
      coverImage: staticCdnUrl('assets/brainstormMode/mode-cover-halligalli.jpg'),
      pagePath: MODE_INDEX_PATH
    }, {
      id: 'partner',
      title: PARTNER_MODE_DISPLAY_TITLE,
      description: '团队协作，\n共同打磨并提交最佳创意方案',
      coverImage: staticCdnUrl('assets/brainstormMode/mode-cover-partner.jpg'),
      pagePath: MODE_INDEX_PATH
    }]
  },
  {
    id: 'template',
    title: '模板卡',
    modes: [{
      id: 'spy',
      title: '谁是卧底模式',
      description: '在描述与推理中隐藏差异，\n激发多元视角与灵感',
      coverImage: staticCdnUrl('assets/brainstormMode/mode-cover-spy.jpg'),
      pagePath: '/packageSpy/pages/modeIndex/index'
    }, {
      id: 'halliGalli',
      title: '德国心脏病模式',
      description: '快节奏卡牌对决，\n在限时竞速中碰撞创意火花',
      coverImage: staticCdnUrl('assets/brainstormMode/mode-cover-halligalli.jpg'),
      pagePath: MODE_INDEX_PATH
    }]
  }
];

function cloneModeGroups(includeCover = true) {
  return BRAINSTORM_MODE_GROUPS.map((group) => ({
    ...group,
    modes: group.modes.map((item) => ({
      ...item,
      coverImage: includeCover ? item.coverImage : ''
    }))
  }));
}

function flattenModes(groups) {
  return (groups || []).reduce((all, group) => all.concat(group.modes || []), []);
}

function parseIsHostOption(options) {
  if (!options) return false;
  const raw = options.isHost;
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}

Page(withPageInteractionLock({
  data: {
    roomId: '',
    isHost: false,
    workshopName: '脑暴工作坊',
    avatarList: [],
    currentUser: null,
    modeGroups: cloneModeGroups(false),
    selectedModeId: null,
    isSelecting: false
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
      modeGroups: cloneModeGroups(false)
    });

    if (!isHost) {
      goRoomPage(roomId);
    }
  },

  onReady() {
    this._readyOnce = true;
    if (!this._pageAlive || !this.data.roomId || !this.data.isHost) return;
    this._bindRoomRoute();
    // 先刷房间数据，封面再延后一帧挂载，降低首屏解码压力
    this._scheduleRoomRefresh({ silent: true });
    this._coverLoadTimer = setTimeout(() => {
      this._coverLoadTimer = null;
      if (this._pageAlive) {
        this.setData({ modeGroups: cloneModeGroups(true) });
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
    unbindPageFromRoomSession(this);
    if (this._roomRefreshTimer) {
      clearTimeout(this._roomRefreshTimer);
      this._roomRefreshTimer = null;
    }
    if (this._coverLoadTimer) {
      clearTimeout(this._coverLoadTimer);
      this._coverLoadTimer = null;
    }
  },

  _bindRoomRoute() {
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || '',
      followNavigation: true
    }).catch((e) => console.warn('brainstormMode bind room', e));
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
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (!this._pageAlive) return;
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
        goRoomPage(this.data.roomId);
        return;
      }
    } catch (err) {
      console.warn('brainstormMode refreshRoomData', err);
      if (!silent) {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      }
    } finally {
      this._roomRefreshInFlight = false;
    }
  },

  onTapMode(e) {
    if (!this.data.isHost) {
      wx.showToast({ title: '等待房主选择', icon: 'none' });
      return;
    }
    const modeId = e.currentTarget.dataset.id;
    this.setData({ selectedModeId: modeId });
  },

  onConfirmMode() {
    return runPageInteraction(this, () => this._confirmMode(), {
      loadingText: '正在进入模式…'
    });
  },

  async _confirmMode() {
    if (!this.data.isHost) return;
    if (this.data.isSelecting) return;

    const modeId = this.data.selectedModeId;
    if (!modeId) {
      wx.showToast({ title: '请先选择一种模式', icon: 'none' });
      return;
    }

    const mode = flattenModes(this.data.modeGroups).find((item) => item.id === modeId);
    if (!mode) return;

    this.setData({ isSelecting: true });

    try {
      const view = getActiveRoomSession() && getActiveRoomSession().getView();
      if (view && !canRoomCommand('START_WORKSHOP_SESSION')) {
        wx.showToast({ title: '当前不能选择模式', icon: 'none' });
        return;
      }
      const result = await dispatchRoomCommand('START_WORKSHOP_SESSION', { mode: mode.id }, {}, {
        roomId: this.data.roomId
      });

      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '选择失败', icon: 'none' });
        return;
      }

      getApp().globalData.selectedMode = {
        id: mode.id,
        title: mode.title,
        description: mode.description
      };
      await followRoomRouteAfterCommand(result, this.data.roomId);
    } catch (err) {
      wx.showToast({ title: err.errMsg || '选择失败', icon: 'none' });
    } finally {
      this.setData({ isSelecting: false });
    }
  },

  handleGoBack() {
    return runPageInteraction(this, async () => {
      const result = await executeProjectedBack(this.data.roomId);
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '返回失败', icon: 'none' });
      }
    }, { loadingText: '正在返回…' });
  },

  handleGoRoom() {
    return runPageInteraction(this, async () => {
      const result = await executeProjectedBack(this.data.roomId);
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '返回房间失败', icon: 'none' });
      }
    }, { loadingText: '正在返回房间…' });
  }
}, ['onTapMode', 'onConfirmMode', 'handleGoBack', 'handleGoRoom']));
