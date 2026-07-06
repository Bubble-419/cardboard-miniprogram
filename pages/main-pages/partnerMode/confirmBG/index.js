const { saveHistoryScenario, shouldSaveSelectedBGToHistory, isValidPartnerBG } = require('../../../../utils/partnerScenarios');
const { clearRoomProblems } = require('../../../../utils/roomDesignProblems');
const { navigateByRoomState, safeOpenUrl } = require('../../../../utils/subAwaitRoutes');

const PARTNER_CARD_DEFS = [
  { type: 'scene', label: '场景' },
  { type: 'user', label: '用户' },
  { type: 'platform', label: '平台' },
  { type: 'function', label: '功能' }
];

Page({
  data: {
    roomId: '',
    cards: [],
    canConfirm: false,
    isHost: true,
    isWaiting: false,
    navbarPaddingTop: 44
  },

  onLoad(options) {
    try {
      const sys = wx.getSystemInfoSync();
      this.setData({ navbarPaddingTop: sys.statusBarHeight || 44 });
    } catch (e) {
      this.setData({ navbarPaddingTop: 44 });
    }
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);

    if (roomId) {
      getApp().globalData.roomId = roomId;
    }

    if (isWaiting) {
      this.setData({ roomId, isWaiting: true, isHost: false });
      this._startStatePolling();
      return;
    }

    this._initPage(roomId);
  },

  async _initPage(roomId) {
    let bg = getApp().globalData.selectedBG;
    if (!isValidPartnerBG(bg, { requirePlatform: true })) {
      bg = await this._fetchSelectedBGFromRoom(roomId);
      if (bg) {
        getApp().globalData.selectedBG = bg;
      }
    }

    if (!isValidPartnerBG(bg, { requirePlatform: true })) {
      wx.showToast({ title: '请先选择情境', icon: 'none' });
      setTimeout(() => {
        const id = roomId || getApp().globalData.roomId || '';
        if (id) {
          wx.redirectTo({
            url: `/pages/main-pages/modeIndex/index?roomId=${encodeURIComponent(id)}&modeId=partner`
          });
        } else {
          wx.navigateBack();
        }
      }, 800);
      return;
    }

    const cards = PARTNER_CARD_DEFS.map((item) => ({
      ...item,
      value: (bg[item.type] || '').trim()
    })).filter((item) => item.value);

    const canConfirm = cards.length === PARTNER_CARD_DEFS.length;

    this.setData({
      roomId,
      cards,
      canConfirm,
      isWaiting: false
    });

    this._fetchHostStatus();
  },

  async _fetchSelectedBGFromRoom(roomId) {
    if (!roomId) return null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.selectedBG) {
        return result.selectedBG;
      }
    } catch (e) {
      console.warn('fetchSelectedBGFromRoom', e);
    }
    return null;
  },

  onUnload() {
    this._stopStatePolling();
  },

  async _fetchHostStatus() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      this.setData({ isHost: true });
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        const isHost = result.isHost === true;
        this.setData({ isHost, roomId });
        if (isHost) {
          const bg = getApp().globalData.selectedBG;
          this._updateRoomState('confirmBG', bg);
        } else {
          this._startStatePolling();
        }
      }
    } catch (e) {
      this.setData({ isHost: true });
    }
  },

  async _updateRoomState(currentPage, selectedBG) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    try {
      const data = { roomId, currentPage };
      if (selectedBG) data.selectedBG = selectedBG;
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data
      });
    } catch (e) {
      console.warn('updateRoomState', e);
    }
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
        if (page === 'submitproblem') {
          safeOpenUrl(`/pages/main-pages/submitProblem/index?roomId=${roomIdEnc}`);
        } else if (page === 'selectproblem') {
          wx.redirectTo({
            url: `/pages/main-pages/selectProblem/index?roomId=${roomIdEnc}`
          });
        } else {
          navigateByRoomState(page, result.roomState, roomId);
        }
      } catch (e) {
        console.warn('confirmBG state poll', e);
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

  async handleConfirm() {
    if (!this.data.isHost || !this.data.canConfirm) return;

    const bg = getApp().globalData.selectedBG;
    if (!bg) {
      wx.showToast({ title: '情境数据丢失', icon: 'none' });
      return;
    }

    const bgSource = getApp().globalData.selectedBGSource;
    if (shouldSaveSelectedBGToHistory(bgSource)) {
      saveHistoryScenario(bg);
    }

    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '进入提交…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: {
          roomId,
          currentPage: 'submitProblem',
          resetDesignProblems: true,
          selectedBG: bg
        }
      });
      const result = (res && res.result) || {};
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '操作失败', icon: 'none' });
        return;
      }
      try {
        await clearRoomProblems(roomId);
      } catch (clearErr) {
        console.warn('clearRoomProblems', clearErr);
      }
      safeOpenUrl(
        `/pages/main-pages/submitProblem/index?roomId=${encodeURIComponent(roomId)}`
      );
    } catch (e) {
      wx.hideLoading();
      console.error('handleConfirm', e);
      wx.showToast({ title: e.errMsg || '操作失败', icon: 'none' });
    }
  },

  handleCardTap(e) {
    const index = parseInt(e.currentTarget.dataset.index || '0', 10);
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    let url = `/pages/main-pages/selectBG/index?mode=partner&step=${index}`;
    if (roomId) url += `&roomId=${encodeURIComponent(roomId)}`;
    wx.redirectTo({ url });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        const roomId = this.data.roomId || '';
        if (roomId) {
          wx.redirectTo({
            url: `/pages/main-pages/modeIndex/index?roomId=${encodeURIComponent(roomId)}&modeId=partner`
          });
        } else {
          wx.navigateBack();
        }
      }
    });
  }
});
