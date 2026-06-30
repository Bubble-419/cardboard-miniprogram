const { buildGamepageUrl } = require('../../../../utils/modeRoutes');

Page({
  data: {
    navbarPaddingTop: 0,
    roomId: '',
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    memberCount: 0,
    members: [],
    isWaiting: false,
    selectedPassCount: null,
    passCountOptions: [],
    isPassOptionsReady: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10) : 1;
    const currentPlayerName = (options && options.currentPlayerName)
      ? decodeURIComponent(options.currentPlayerName) : `玩家${currentPlayerIndex}`;
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);
    const isSubScreen = options && (options.isSubScreen === '1' || options.isSubScreen === true);

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    let navbarPaddingTop = 0;
    try {
      navbarPaddingTop = wx.getSystemInfoSync().statusBarHeight || 0;
    } catch (e) {
      console.warn('statement getSystemInfoSync', e);
    }

    this.setData({
      navbarPaddingTop,
      roomId,
      currentPlayerIndex,
      currentPlayerName,
      isWaiting: !!(isWaiting || isSubScreen)
    });

    if (isWaiting || isSubScreen) {
      this._startStatePolling();
      return;
    }

    this.loadMemberCount(roomId);
    this._updateRoomState('statement', currentPlayerIndex, currentPlayerName);
  },

  onUnload() {
    this._stopStatePolling();
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName, incrementRound, extra) {
    const roomId = this.data.roomId || '';
    if (!roomId) return false;
    try {
      const data = { roomId, currentPage };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      if (incrementRound === true) data.incrementRound = true;
      if (extra && typeof extra === 'object') {
        if (extra.passCount != null) data.passCount = extra.passCount;
        if (extra.memberCount != null) data.memberCount = extra.memberCount;
      }
      const res = await wx.cloud.callFunction({
        name: 'updateRoomState',
        data
      });
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('updateRoomState', e);
      return false;
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId || '';
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
          const idx = result.roomState.currentPlayerIndex != null
            ? result.roomState.currentPlayerIndex
            : 1;
          const modeId = result.selectedModeId || 'partner';
          wx.redirectTo({
            url: buildGamepageUrl(roomId, idx, modeId)
          });
        } else if (page === 'playsuccess') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          const memberCountFromMembers = Array.isArray(result.members) ? result.members.length : 0;
          const passCount = Number.isFinite(Number(result.roomState.passCount))
            ? Number(result.roomState.passCount)
            : 0;
          const memberCount = Number.isFinite(Number(result.roomState.memberCount))
            ? Number(result.roomState.memberCount)
            : memberCountFromMembers;
          wx.redirectTo({
            url: `/pages/main-pages/playSuccess/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&passCount=${passCount}&memberCount=${memberCount}&isWaiting=1`
          });
        } else if (page === 'playfail') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          const memberCountFromMembers = Array.isArray(result.members) ? result.members.length : 0;
          const passCount = Number.isFinite(Number(result.roomState.passCount))
            ? Number(result.roomState.passCount)
            : 0;
          const memberCount = Number.isFinite(Number(result.roomState.memberCount))
            ? Number(result.roomState.memberCount)
            : memberCountFromMembers;
          wx.redirectTo({
            url: `/pages/main-pages/playFail/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&passCount=${passCount}&memberCount=${memberCount}&isWaiting=1`
          });
        } else if (page === 'discussion') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          wx.redirectTo({
            url: `/pages/main-pages/discussion/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}`
          });
        } else if (page === 'creativeinput') {
          wx.redirectTo({ url: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}` });
        } else if (page === 'creativesummary') {
          wx.redirectTo({ url: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}` });
        }
      } catch (e) {
        console.warn('state poll', e);
      }
    };
    poll();
    this._statePollTimer = setInterval(poll, 1000);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  async loadMemberCount(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true && result.members && result.members.length) {
        const memberCount = result.members.length;
        const passCountOptions = this._buildPassCountOptions(memberCount);
        const selectedPassCount = this.data.selectedPassCount;
        const nextSelected = passCountOptions.includes(selectedPassCount) ? selectedPassCount : null;
        this.setData({
          memberCount,
          members: result.members,
          passCountOptions,
          selectedPassCount: nextSelected,
          isPassOptionsReady: true
        });
      }
    } catch (e) {
      console.warn('loadMemberCount', e);
      this.setData({
        passCountOptions: this._buildPassCountOptions(0),
        isPassOptionsReady: true
      });
    }
  },

  _buildPassCountOptions(memberCount) {
    const max = Number.isFinite(memberCount) && memberCount > 0
      ? Math.max(0, memberCount - 1)
      : 5;
    return Array.from({ length: max + 1 }, (_, idx) => idx);
  },

  handleGoBack() {
    wx.navigateBack();
  },

  onStatementTap(e) {
    const passCountRaw = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.passcount;
    if (passCountRaw == null) return;
    const passCount = parseInt(passCountRaw, 10);
    if (!Number.isFinite(passCount)) return;
    this.setData({ selectedPassCount: passCount });
  },

  handleConfirm() {
    const passCount = this.data.selectedPassCount;
    if (passCount == null) {
      wx.showToast({ title: '请选择通过人数', icon: 'none' });
      return;
    }

    const { roomId, currentPlayerIndex, currentPlayerName, memberCount, members } = this.data;
    if (!roomId) return;

    const roomIdEnc = encodeURIComponent(roomId);
    const nameEnc = encodeURIComponent(currentPlayerName || `玩家${currentPlayerIndex}`);
    const total = memberCount || (members && members.length) || 0;
    const voters = Math.max(0, total - 1);
    const successThreshold = Math.ceil(voters / 2);

    if (passCount >= successThreshold) {
      this._updateRoomState(
        'playSuccess',
        currentPlayerIndex,
        currentPlayerName,
        false,
        { passCount, memberCount: total }
      ).then((ok) => {
        if (!ok) {
          wx.showToast({ title: '同步失败，请重试', icon: 'none' });
          return;
        }
        wx.redirectTo({
          url: `/pages/main-pages/playSuccess/index?roomId=${roomIdEnc}&currentPlayerIndex=${currentPlayerIndex}&currentPlayerName=${nameEnc}&passCount=${passCount}&memberCount=${total}`
        });
      });
      return;
    }

    this._updateRoomState(
      'playFail',
      currentPlayerIndex,
      currentPlayerName,
      false,
      { passCount, memberCount: total }
    ).then((ok) => {
      if (!ok) {
        wx.showToast({ title: '同步失败，请重试', icon: 'none' });
        return;
      }
      wx.redirectTo({
        url: `/pages/main-pages/playFail/index?roomId=${roomIdEnc}&currentPlayerIndex=${currentPlayerIndex}&currentPlayerName=${nameEnc}&passCount=${passCount}&memberCount=${total}`
      });
    });
  }
});
