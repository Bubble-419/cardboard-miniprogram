const { goRoomPage } = require('../../utils/goRoomPage');
const {
  bindPageToRoomSession,
  unbindPageFromRoomSession,
  dispatchRoomCommand,
  followRoomRouteAfterCommand,
  getRoomPageSnapshot
} = require('../../modules/room-session/index');
const { runPageInteraction, runPageNavigation, withPageInteractionLock } = require('../../utils/pageInteractionLock');

function buildLeaderboard(snapshot) {
  const view = snapshot && snapshot.view;
  const session = view && view.session;
  const result = session && session.result || {};
  const members = snapshot && snapshot.members || [];
  const participants = session && session.participants || [];
  const turns = Array.isArray(session && session.turnSummaries) ? session.turnSummaries : [];
  return (result.leaderboard || []).map((row) => {
    const member = members.find((item) => item.memberId === row.memberId)
      || participants.find((item) => item.memberId === row.memberId) || {};
    return {
      memberId: row.memberId,
      playerIndex: member.playerIndex || member.seatNoAtStart,
      nickName: member.nickName || `玩家${member.playerIndex || member.seatNoAtStart || ''}`,
      avatarUrl: member.avatarUrl || member.avatarRef || '',
      avatarColor: member.avatarColor || member.color || member.avatarColorHex || '#5EC159',
      totalStars: Number(row.totalStars) || 0,
      scoreCount: turns
        .filter((turn) => turn.activeMemberId === row.memberId)
        .reduce((sum, turn) => sum + Math.max(0, Number(turn.scoredCount) || 0), 0)
    };
  }).sort((a, b) => b.totalStars - a.totalStars)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

Page(withPageInteractionLock({
  data: {
    roomId: '', sessionId: '', isSubScreen: false, isHost: false, leaderboard: [], loading: true,
    error: '', from: '', actioning: false
  },

  onLoad(options) {
    const roomId = options && options.roomId || getApp().globalData.roomId || '';
    const isSubScreen = options && ['1', 'true'].includes(String(options.isSubScreen));
    const from = options && options.from || '';
    if (!roomId) {
      this.setData({ loading: false, error: '缺少房间参数' });
      return;
    }
    this.setData({ roomId, isSubScreen, from });
    this.loadLeaderboard(roomId);
  },

  onShow() { if (this.data.roomId) this._startStatePolling(); },
  onHide() { this._stopStatePolling(); },
  onUnload() { this._pageAlive = false; this._stopStatePolling(); },

  _applySnapshot(snapshot) {
    if (!snapshot || snapshot.ok !== true) return;
    const session = snapshot.view && snapshot.view.session;
    this.setData({
      sessionId: session && session.sessionId || '',
      isHost: snapshot.isHost === true,
      leaderboard: buildLeaderboard(snapshot),
      loading: false,
      error: ''
    });
  },

  _startStatePolling() {
    this._stopStatePolling();
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId,
      followNavigation: true,
      onSnapshot(snapshot) { this._applySnapshot(snapshot); }
    }).catch((e) => console.warn('leaderboard roomSession', e));
  },

  _stopStatePolling() { unbindPageFromRoomSession(this); },

  async loadLeaderboard(roomId) {
    this.setData({ loading: true, error: '' });
    try {
      const snapshot = await getRoomPageSnapshot(roomId, { refresh: true });
      if (!snapshot || snapshot.ok !== true) throw new Error(snapshot && snapshot.errMsg || '加载失败');
      this._applySnapshot(snapshot);
    } catch (e) {
      this.setData({ loading: false, error: e.errMsg || e.message || '加载失败' });
    }
  },

  handleGlobalReview() {
    const sessionQuery = this.data.sessionId
      ? `&sessionId=${encodeURIComponent(this.data.sessionId)}`
      : '';
    return runPageNavigation(this, async () => ({
      method: 'navigateTo',
      url: `/pages/main-pages/partnerMode/gamepage/index?roomId=${encodeURIComponent(this.data.roomId)}&mode=review${sessionQuery}`
    }), { loadingText: '正在打开回顾…' });
  },

  handleBack() {
    return runPageInteraction(this, () => this._returnRoom(), { loadingText: '正在返回房间…' });
  },

  handleNewGame() { return this.handleAnotherRound(); },

  handleAnotherRound() {
    return runPageNavigation(this, () => this._prepareAnotherRound(), { loadingText: '正在准备新一轮…' });
  },

  async _prepareAnotherRound() {
    if (this.data.actioning) return null;
    if (!this.data.isHost) {
      wx.showToast({ title: '请等待房主开始新一轮', icon: 'none' });
      return null;
    }
    this.setData({ actioning: true });
    try {
      const result = await dispatchRoomCommand('REPLAY_WORKSHOP_SESSION', {});
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '开始失败', icon: 'none' });
        return null;
      }
      // 重玩创建了新 Session，必须等待新 Member View 的角色路由完成跳转。
      await followRoomRouteAfterCommand(result, this.data.roomId);
      return null;
    } finally {
      if (this._pageAlive !== false) this.setData({ actioning: false });
    }
  },

  handleReturnRoom() {
    return runPageInteraction(this, () => this._returnRoom(), { loadingText: '正在返回房间…' });
  },

  async _returnRoom() {
    if (this.data.actioning) return;
    if (this.data.isSubScreen && !this.data.isHost) {
      await goRoomPage(this.data.roomId);
      return;
    }
    if (!this.data.isHost) {
      wx.showToast({ title: '请等待房主返回房间', icon: 'none' });
      return;
    }
    this.setData({ actioning: true });
    try {
      const result = await dispatchRoomCommand('RETURN_TO_LOBBY', {});
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '返回失败', icon: 'none' });
        return;
      }
      await goRoomPage(this.data.roomId);
    } finally {
      if (this._pageAlive !== false) this.setData({ actioning: false });
    }
  }
}, ['handleBack', 'handleGlobalReview', 'handleReturnRoom', 'handleAnotherRound', 'handleNewGame']));
