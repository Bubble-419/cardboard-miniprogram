const { safeNavigateBack } = require('../../../utils/pageNavigate');
const { goRoomPage } = require('../../../utils/goRoomPage');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');
const {
  bindPageToRoomSession,
  dispatchRoomCommand,
  getActiveRoomSession,
  getRoomPageSnapshot,
  unbindPageFromRoomSession
} = require('../../../modules/room-session/index');

Page(withPageInteractionLock({
  data: {
    roomId: '',
    members: [],
    isHost: false,
    summaryList: [],
    canRestartRound: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ roomId });
    this.loadData(roomId);
  },

  onShow() {
    const roomId = this.data.roomId || '';
    if (roomId) {
      this.loadData(roomId);
      this._startStatePolling();
    }
  },

  onUnload() {
    this._stopStatePolling();
  },

  async loadData(roomId) {
    await this.loadRoomData(roomId);
    this._startStatePolling();
  },

  async loadRoomData(roomId) {
    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (result.ok !== true || !result.members || !result.members.length) return;
      const { assignAvatarImages } = require('../../../utils/avatars');
      const members = assignAvatarImages(result.members);
      this.setData({
        members,
        isHost: result.isHost === true
      });
      this._applySummary(result, members);
    } catch (e) {
      console.warn('creativeSummary loadRoomData', e);
    }
  },

  _applySummary(result, displayMembers) {
      if (!result || result.ok !== true) return;
      const session = result.view && result.view.session;
      const ideas = session && session.publicModeState && session.publicModeState.ideas || [];
      const ideaMap = {};
      ideas.forEach(item => {
        ideaMap[item.memberId] = item;
      });
      const actor = result.view && result.view.actor;
      if (actor && actor.contributionStatus && actor.contributionStatus.submitted
        && !ideaMap[actor.memberId]) {
        // 汇总公开前，提交者仍能从自己的私有 ActorView 看到本人创意。
        ideaMap[actor.memberId] = {
          memberId: actor.memberId,
          text: actor.contributionStatus.text || ''
        };
      }

      const roomMembers = displayMembers || this.data.members || [];
      const memberById = Object.fromEntries(roomMembers.map((member) => [member.memberId, member]));
      const actorMemberId = actor && actor.memberId;
      const participants = ((session && session.participants) || []).filter((item) => item.status === 'ACTIVE');
      const summaryList = participants.map((participant) => {
        const member = memberById[participant.memberId] || {};
        const idea = ideaMap[participant.memberId];
        return {
          playerIndex: member.playerIndex || participant.seatNoAtStart,
          isMe: participant.memberId === actorMemberId,
          avatar: member.avatarImage || member.avatarUrl || participant.avatarRef || '',
          ideaText: idea ? (idea.text || '') : ''
        };
      });

      const progress = session && session.progress && session.progress.contributionProgress || {};
      const allFilled = Number(progress.requiredCount) > 0
        && Number(progress.submittedCount) >= Number(progress.requiredCount)
        && summaryList.every((item) => (item.ideaText || '').trim().length > 0);

      const fingerprint = summaryList
        .map((item) => `${item.playerIndex || ''}:${item.ideaText || ''}`)
        .join('|') + `#${allFilled ? 1 : 0}`;
      if (fingerprint === this._summaryFingerprint) return;
      this._summaryFingerprint = fingerprint;

      this.setData({
        summaryList,
        canRestartRound: allFilled
      });
  },

  _startStatePolling() {
    this._stopStatePolling();
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || '',
      followNavigation: true,
      onSnapshot: (result) => {
        const { assignAvatarImages } = require('../../../utils/avatars');
        const members = assignAvatarImages(result.members || []);
        this.setData({ members, isHost: result.isHost === true });
        this._applySummary(result, members);
      }
    }).catch((e) => console.warn('creativeSummary bind room', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
  },

  async _completeHalliSession() {
    const view = getActiveRoomSession() && getActiveRoomSession().getView();
    if (view && view.session && view.session.status !== 'COMPLETED') {
      return dispatchRoomCommand('COMPLETE_HALLI_SESSION', {});
    }
    return { ok: true };
  },

  handleFinish() {
    if (!this.data.isHost) return;
    if (!this.data.canRestartRound) {
      wx.showToast({ title: '请等待所有玩家填写完成', icon: 'none' });
      return;
    }
    return runPageNavigation(this, async () => {
      let result = await this._completeHalliSession();
      if (result && result.ok === true) result = await dispatchRoomCommand('REPLAY_WORKSHOP_SESSION', {});
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '开始下一轮失败', icon: 'none' });
        return;
      }
      const roomId = encodeURIComponent(this.data.roomId || '');
      return {
        method: 'redirectTo',
        url: `/pages/main-pages/selectPlayer/index?roomId=${roomId}&modeId=halliGalli`
      };
    }, { loadingText: '正在准备下一轮…' });
  },

  handleGoRoom() {
    if (!this.data.isHost) return;
    if (!this.data.canRestartRound) return;
    return runPageInteraction(this, async () => {
      let result = await this._completeHalliSession();
      if (result && result.ok === true) result = await dispatchRoomCommand('RETURN_TO_LOBBY', {});
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '返回房间失败', icon: 'none' });
        return;
      }
      await goRoomPage(this.data.roomId);
    }, { loadingText: '正在返回房间…' });
  },

  handleGoBack() {
    return runPageInteraction(this, async () => {
      const roomId = this.data.roomId || '';
      safeNavigateBack({
        expectedPrev: 'pages/main-pages/creativeInput/index',
        fallbackUrl: roomId
          ? `/pages/main-pages/creativeInput/index?roomId=${encodeURIComponent(roomId)}`
          : '/pages/main-pages/modeIndex/index?modeId=halliGalli'
      });
    }, { loadingText: '正在返回…' });
  }
}, ['handleFinish', 'handleGoRoom', 'handleGoBack']));
