const { goRoomPage } = require('../../../utils/goRoomPage');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');
const {
  bindPageToRoomSession,
  dispatchRoomCommand,
  followRoomRouteAfterCommand,
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
    canEditIdea: false,
    canRestartRound: false,
    editing: false,
    editDraft: '',
    editingCursor: 0
  },

  onLoad(options) {
    this._pageAlive = true;
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
    this._pageAlive = false;
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
        const isMe = participant.memberId === actorMemberId;
        return {
          playerIndex: member.playerIndex || participant.seatNoAtStart,
          isMe,
          avatar: member.avatarImage || member.avatarUrl || participant.avatarRef || '',
          ideaText: idea ? (idea.text || '') : ''
        };
      });

      const progress = session && session.progress && session.progress.contributionProgress || {};
      const capabilities = actor && actor.capabilities || {};
      const canEditIdea = !!(capabilities.REOPEN_HALLI_IDEA
        && capabilities.REOPEN_HALLI_IDEA.allowed);
      const canSaveIdea = !!(capabilities.SUBMIT_HALLI_IDEA
        && capabilities.SUBMIT_HALLI_IDEA.allowed
        && actor && actor.contributionStatus && actor.contributionStatus.submitted);
      const canComplete = !!(capabilities.COMPLETE_HALLI_SESSION
        && capabilities.COMPLETE_HALLI_SESSION.allowed);
      const allFilled = Number(progress.requiredCount) > 0
        && Number(progress.submittedCount) >= Number(progress.requiredCount)
        && summaryList.every((item) => (item.ideaText || '').trim().length > 0);

      // 断线恢复：服务端已处于修改中时，汇总页原地进入编辑态。
      let editing = this.data.editing === true;
      let editDraft = this.data.editDraft || '';
      if (canSaveIdea && !editing && !this._savingIdea) {
        const mine = summaryList.find((item) => item.isMe);
        editDraft = (actor.contributionStatus && actor.contributionStatus.text)
          || (mine && mine.ideaText)
          || '';
        editing = true;
        this._ignoreInitialIdeaBlurUntil = Date.now() + 800;
        this._editingHasInput = false;
      } else if (!canSaveIdea && editing && !this._savingIdea && !this._reopeningIdea) {
        editing = false;
        editDraft = '';
      }

      if (editing) {
        summaryList.forEach((item) => {
          if (item.isMe) item.ideaText = editDraft;
        });
      }

      const fingerprint = summaryList
        .map((item) => `${item.playerIndex || ''}:${item.ideaText || ''}`)
        .join('|') + `#${allFilled ? 1 : 0}:${canEditIdea ? 1 : 0}:${canComplete ? 1 : 0}:${editing ? 1 : 0}:${editDraft}`;
      if (fingerprint === this._summaryFingerprint) return;
      this._summaryFingerprint = fingerprint;

      this.setData({
        summaryList,
        canEditIdea,
        canRestartRound: allFilled && (!result.isHost || canComplete),
        editing,
        editDraft,
        editingCursor: editing ? (editDraft || '').length : 0
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

  stopPropagation() {},

  onIdeaInput(e) {
    const value = (e.detail && e.detail.value) || '';
    this._editingHasInput = true;
    const summaryList = (this.data.summaryList || []).map((item) => (
      item.isMe ? { ...item, ideaText: value } : item
    ));
    this._summaryFingerprint = '';
    this.setData({ editDraft: value, summaryList });
  },

  handleEditIdea() {
    if (!this.data.canEditIdea || this.data.editing || this._reopeningIdea) return;
    const mine = (this.data.summaryList || []).find((item) => item.isMe);
    const draft = (mine && mine.ideaText) || '';
    return runPageInteraction(this, async () => {
      this._reopeningIdea = true;
      try {
        const result = await dispatchRoomCommand('REOPEN_HALLI_IDEA', {});
        if (!result || result.ok !== true) {
          wx.showToast({ title: result && result.errMsg || '无法修改创意', icon: 'none' });
          return;
        }
        this._ignoreInitialIdeaBlurUntil = Date.now() + 800;
        this._editingHasInput = false;
        this._summaryFingerprint = '';
        this.setData({
          editing: true,
          editDraft: draft,
          editingCursor: draft.length,
          canEditIdea: false
        });
      } finally {
        this._reopeningIdea = false;
      }
    }, { loadingText: '正在进入编辑…' });
  },

  async _saveIdeaText(rawText, options = {}) {
    const text = String(rawText || '').trim();
    if (!text) {
      if (options.toastEmpty !== false) {
        wx.showToast({ title: '请先填写创意', icon: 'none' });
      }
      return false;
    }
    if (this._savingIdea) return false;
    this._savingIdea = true;
    try {
      const result = await dispatchRoomCommand('SUBMIT_HALLI_IDEA', { text });
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '保存失败', icon: 'none' });
        return false;
      }
      this._summaryFingerprint = '';
      this.setData({
        editing: false,
        editDraft: '',
        editingCursor: 0
      });
      const snapshot = getActiveRoomSession() && getActiveRoomSession().getSnapshot
        && getActiveRoomSession().getSnapshot();
      if (snapshot) {
        const { assignAvatarImages } = require('../../../utils/avatars');
        const members = assignAvatarImages(snapshot.members || this.data.members || []);
        this.setData({ members, isHost: snapshot.isHost === true });
        this._applySummary(snapshot, members);
      }
      return true;
    } finally {
      this._savingIdea = false;
    }
  },

  handleSaveIdea() {
    if (!this.data.editing) return;
    return runPageInteraction(this, async () => {
      await this._saveIdeaText(this.data.editDraft);
    }, { loadingText: '正在保存…' });
  },

  async onIdeaBlur(e) {
    if (!this.data.editing) return;
    if (Date.now() < (this._ignoreInitialIdeaBlurUntil || 0) && !this._editingHasInput) {
      this._ignoreInitialIdeaBlurUntil = 0;
      return;
    }
    this._ignoreInitialIdeaBlurUntil = 0;
    this._editingHasInput = false;
    const value = e && e.detail ? e.detail.value : this.data.editDraft;
    await this._saveIdeaText(value, { toastEmpty: false });
  },

  handleFinish() {
    if (!this.data.isHost) return;
    if (this.data.editing) {
      wx.showToast({ title: '请先保存创意修改', icon: 'none' });
      return;
    }
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
      await followRoomRouteAfterCommand(result, this.data.roomId);
      return null;
    }, { loadingText: '正在准备下一轮…' });
  },

  handleGoRoom() {
    if (!this.data.isHost) return;
    if (!this.data.canRestartRound) return;
    if (this.data.editing) {
      wx.showToast({ title: '请先保存创意修改', icon: 'none' });
      return;
    }
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

}, ['handleEditIdea', 'handleSaveIdea', 'onIdeaInput', 'onIdeaBlur', 'handleFinish', 'handleGoRoom']));
