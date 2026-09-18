const {
  assignAvatarImages,
  expandMembersToSlots,
  dedupeMembersById,
  buildMemberSlots
} = require('../utils/circleMemberLayout');
const {
  bindPageToRoomSession,
  dispatchRoomCommand,
  executeProjectedBack,
  followRoomRouteAfterCommand,
  getRoomPageSnapshot,
  unbindPageFromRoomSession
} = require('../../../../modules/room-session/index');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../../utils/pageInteractionLock');

Page(withPageInteractionLock({
  data: {
    roomId: '',
    memberSlots: [],
    members: [],
    selectedPlayerIndex: null,
    selectedPlayerName: '',
    hostReady: false,
    isHost: false,
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

    this.setData({
      roomId,
      isWaiting: !!isWaiting,
      selectedPlayerIndex: null,
      selectedPlayerName: '',
      canConfirm: false,
      hostReady: false,
      isHost: false
    });

    this._fetchHostStatus();
  },

  onShow() {
    this._startStatePolling();
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
      this.setData({ isHost: false, hostReady: true });
      this.loadRoomData();
      return;
    }
    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (result.ok === true) {
        const isHost = result.isHost === true;
        this.setData({ isHost, hostReady: true, roomId });
        await this.loadRoomData(result);
        this._startStatePolling();
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
        result = await getRoomPageSnapshot(roomId, { refresh: true });
      }
      if (result.ok !== true) return;

      const rawMembers = result.members || [];
      const deduped = dedupeMembersById(rawMembers);
      const withAvatars = assignAvatarImages(deduped);
      const members = expandMembersToSlots(withAvatars);
      const memberSlots = buildMemberSlots(members);

      const memberCount = result.memberCount != null ? result.memberCount : deduped.length;
      const workshopName = result.workshopName || '';
      const proposedMemberId = result.view && result.view.session
        && result.view.session.setup.proposedFirstMemberId;
      this._proposedMemberId = proposedMemberId || null;

      const patch = {
        members,
        memberSlots,
        memberCount,
        workshopName,
        hostReady: true,
        isHost: result.isHost === true
      };
      this.setData(patch);
    } catch (e) {
      console.warn('loadRoomData', e);
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || getApp().globalData.roomId || '',
      followNavigation: true,
      onSnapshot(snapshot) {
        this.loadRoomData(snapshot);
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

    const { selectedPlayerIndex } = this.data;
    if (selectedPlayerIndex == null) {
      wx.showToast({ title: '请选择首位出牌玩家', icon: 'none' });
      return;
    }

    return runPageNavigation(this, async () => {
      this._confirmPending = true;
      try {
        const selected = (this.data.members || []).find((item) => item.playerIndex === selectedPlayerIndex);
        if (!selected) {
          wx.showToast({ title: '所选成员已经离开', icon: 'none' });
          return;
        }
        if (selected.memberId !== this._proposedMemberId) {
          const selectedResult = await dispatchRoomCommand('SELECT_FIRST_PLAYER', {
            memberId: selected.memberId
          });
          if (!selectedResult || selectedResult.ok !== true) {
            wx.showToast({ title: selectedResult && selectedResult.errMsg || '同步房间失败，请重试', icon: 'none' });
            return;
          }
          this._proposedMemberId = selected.memberId;
        }
        const result = await dispatchRoomCommand('CONFIRM_FIRST_PLAYER', {
          memberId: this._proposedMemberId
        });
        if (!result || result.ok !== true) {
          wx.showToast({ title: result && result.errMsg || '同步房间失败，请重试', icon: 'none' });
          return;
        }
        await followRoomRouteAfterCommand(result, this.data.roomId);
        return null;
      } catch (e) {
        wx.showToast({ title: e.errMsg || '操作失败', icon: 'none' });
      } finally {
        this._confirmPending = false;
      }
    }, { loadingText: '正在开始脑暴…' });
  },

  handleGoBack() {
    return runPageInteraction(this, async () => {
      if (!this.data.isHost) {
        wx.showToast({ title: '请等待房主确认', icon: 'none' });
        return;
      }
      const result = await executeProjectedBack(this.data.roomId);
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '返回失败', icon: 'none' });
      }
    }, { loadingText: '正在返回…' });
  }
}, ['onSlotTap', 'handleConfirm', 'handleGoBack']));
