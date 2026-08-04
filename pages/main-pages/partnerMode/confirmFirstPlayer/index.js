const {
  assignAvatarImages,
  expandMembersToSlots,
  dedupeMembersById,
  buildMemberSlots
} = require('../../../../utils/circleMemberLayout');
const { navigateByRoomState } = require('../../../../utils/subAwaitRoutes');
const { followSubScreenRoomPoll } = require('../../../../utils/subScreenRoomPoll');
const { buildGamepageUrl } = require('../../../../utils/modeRoutes');
const {
  bindPageToRoomSession,
  unbindPageFromRoomSession
} = require('../../../../modules/room-session/index');

Page({
  data: {
    roomId: '',
    memberSlots: [],
    members: [],
    selectedPlayerIndex: null,
    selectedPlayerName: '',
    isHost: true,
    isWaiting: false,
    canConfirm: false,
    workshopName: '',
    memberCount: 0
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);

    if (roomId) {
      getApp().globalData.roomId = roomId;
    }

    const sp = getApp().globalData.selectedPlayer || {};
    const preIndex = sp.currentPlayerIndex != null ? sp.currentPlayerIndex : null;
    const preName = sp.currentPlayerName || '';

    this.setData({
      roomId,
      isWaiting: !!isWaiting,
      selectedPlayerIndex: preIndex,
      selectedPlayerName: preName,
      canConfirm: preIndex != null
    });

    if (isWaiting) {
      this.setData({ isHost: false });
      this._startStatePolling();
      return;
    }

    this._fetchHostStatus();
  },

  onShow() {
    if (this.data.isWaiting || this.data.isHost === false) {
      this._startStatePolling();
    }
  },

  onHide() {
    this._stopStatePolling();
  },

  onUnload() {
    this._stopStatePolling();
  },

  async _fetchHostStatus() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      this.setData({ isHost: true });
      this.loadRoomData();
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
          await this.loadRoomData(result);
          this._updateRoomState('confirmFirstPlayer');
        } else {
          this._startStatePolling();
        }
      } else {
        this.loadRoomData();
      }
    } catch (e) {
      console.warn('_fetchHostStatus', e);
      this.loadRoomData();
    }
  },

  async loadRoomData(cachedResult) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;

    try {
      let result = cachedResult;
      if (!result) {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        result = (res && res.result) || {};
      }
      if (result.ok !== true) return;

      const rawMembers = result.members || [];
      const deduped = dedupeMembersById(rawMembers);
      const withAvatars = assignAvatarImages(deduped);
      const members = expandMembersToSlots(withAvatars);
      const memberSlots = buildMemberSlots(members);

      const memberCount = result.memberCount != null ? result.memberCount : deduped.length;
      const workshopName = result.workshopName || '';

      let { selectedPlayerIndex, selectedPlayerName, canConfirm } = this.data;
      if (selectedPlayerIndex == null && result.roomState) {
        const idx = result.roomState.currentPlayerIndex;
        if (idx != null) {
          selectedPlayerIndex = idx;
          const found = deduped.find((m) => m.playerIndex === idx);
          selectedPlayerName = found
            ? (found.nickName || `玩家${idx}`)
            : (result.roomState.currentPlayerName || `玩家${idx}`);
          canConfirm = true;
        }
      } else if (selectedPlayerIndex != null && !selectedPlayerName) {
        const found = deduped.find((m) => m.playerIndex === selectedPlayerIndex);
        if (found) {
          selectedPlayerName = found.nickName || `玩家${selectedPlayerIndex}`;
        }
      }

      this.setData({
        members,
        memberSlots,
        memberCount,
        workshopName,
        selectedPlayerIndex,
        selectedPlayerName,
        canConfirm: selectedPlayerIndex != null
      });
    } catch (e) {
      console.warn('loadRoomData', e);
    }
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName) {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return false;
    try {
      const data = { roomId, currentPage };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
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
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || getApp().globalData.roomId || '',
      intervalMs: 2000,
      followNavigation: true,
      beforeNavigate(pollResult, page) {
        if (page === 'gamepage') {
          const idx = pollResult.roomState.currentPlayerIndex != null
            ? pollResult.roomState.currentPlayerIndex
            : 1;
          wx.redirectTo({
            url: buildGamepageUrl(roomId, idx, 'partner')
          });
          return true;
        }
        return false;
      }
    }).catch((e) => console.warn('confirmFirstPlayer roomSession', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
  },

  onSlotTap(e) {
    if (!this.data.isHost) return;
    const index = e.currentTarget.dataset.index;
    const slot = this.data.memberSlots[index];
    if (!slot || !slot.member) return;

    const playerIndex = slot.member.playerIndex;
    const name = slot.member.nickName || `玩家${playerIndex}`;

    getApp().globalData.selectedPlayer = {
      currentPlayerIndex: playerIndex,
      currentPlayerName: name
    };

    this.setData({
      selectedPlayerIndex: playerIndex,
      selectedPlayerName: name,
      canConfirm: true
    });
  },

  async handleConfirm() {
    if (!this.data.isHost || !this.data.canConfirm) return;
    if (this._confirmPending) return;

    const { roomId, selectedPlayerIndex, selectedPlayerName } = this.data;
    if (selectedPlayerIndex == null) {
      wx.showToast({ title: '请选择首位出牌玩家', icon: 'none' });
      return;
    }

    this._confirmPending = true;
    wx.showLoading({ title: '开始脑暴…' });
    try {
      const ok = await this._updateRoomState('gamepage', selectedPlayerIndex, selectedPlayerName);
      wx.hideLoading();
      if (!ok) {
        wx.showToast({ title: '同步房间失败，请重试', icon: 'none' });
        return;
      }
      wx.redirectTo({
        url: buildGamepageUrl(roomId, selectedPlayerIndex, 'partner')
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.errMsg || '操作失败', icon: 'none' });
    } finally {
      this._confirmPending = false;
    }
  },

  handleGoBack() {
    const roomId = this.data.roomId || '';
    wx.navigateBack({
      fail: () => {
        if (roomId) {
          wx.redirectTo({
            url: `/pages/main-pages/selectPlayer/index?roomId=${encodeURIComponent(roomId)}&modeId=partner`
          });
        } else {
          wx.navigateBack();
        }
      }
    });
  }
});
