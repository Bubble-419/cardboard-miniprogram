const {
  callCloudFunction,
  callSpyAction,
  goRoomPage,
  buildSpyPageUrl,
  openUrl,
  VOTE_ROUND_MS,
  startSpyCountdownTicker
} = require('../../../../utils/spyMode');
const { assignAvatarImages, buildAvatarList } = require('../../../../utils/avatars');
const { followSpyRoomState } = require('../../../../utils/spyFollow');

function buildCircleSlots(players, memberByIndex) {
  const list = (players || []).filter((p) => p.alive !== false);
  const n = list.length || 1;
  const radius = 38;
  return list.map((p, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const left = 50 + radius * Math.cos(angle);
    const top = 50 + radius * Math.sin(angle);
    const member = memberByIndex[p.playerIndex] || {};
    return {
      playerIndex: p.playerIndex,
      name: p.name,
      isMe: !!p.isMe,
      avatarImage: member.avatarImage || '/assets/avatar/frame_2085662311_1x.webp',
      left: left.toFixed(2),
      top: top.toFixed(2)
    };
  });
}

Page({
  data: {
    roomId: '',
    isHost: false,
    navbarPaddingTop: 44,
    avatarList: [],
    countdownText: '2:00',
    circleSlots: [],
    selectedIndex: null,
    hasVoted: false,
    progressList: [],
    tallyList: [],
    acting: false
  },

  onLoad(options) {
    this._pageAlive = true;
    let navbarPaddingTop = 44;
    try {
      navbarPaddingTop = (wx.getSystemInfoSync().statusBarHeight || 0) + 16;
    } catch (e) {
      // ignore
    }
    this.setData({
      roomId: (options && options.roomId) || getApp().globalData.roomId || '',
      navbarPaddingTop
    });
  },

  onShow() {
    this._pageAlive = true;
    this.refresh();
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
    this.stopTicker();
  },

  onUnload() {
    this._pageAlive = false;
    this.stopPolling();
    this.stopTicker();
  },

  startPolling() {
    this.stopPolling();
    this._pollTimer = setInterval(() => this.refresh(), 2000);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  stopTicker() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  },

  ensureTicker(startedAt, durationMs) {
    this._voteStartedAt = startedAt;
    this._voteDuration = durationMs || VOTE_ROUND_MS;
    if (this._tickTimer) return;
    this._tickTimer = startSpyCountdownTicker(
      this,
      () => this._voteStartedAt,
      this._voteDuration
    );
  },

  async refresh() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    try {
      const res = await callCloudFunction('getAddPlayerData', { roomId });
      const result = (res && res.result) || {};
      if (!this._pageAlive || result.ok !== true) return;

      const isHost = result.isHost === true;
      const members = result.members || [];
      const spyGame = (result.roomState && result.roomState.spyGame) || {};
      const membersWithAvatar = assignAvatarImages(members);
      const memberByIndex = {};
      membersWithAvatar.forEach((m) => {
        if (m && m.playerIndex != null) memberByIndex[m.playerIndex] = m;
      });

      const myMember = members.find((m) => m.isMe);
      const players = (spyGame.players || []).map((p) => ({
        ...p,
        isMe: !!(myMember && myMember.playerIndex === p.playerIndex)
      }));

      const voteStatus = spyGame.voteStatus || {};
      const voted = voteStatus.votedPlayerIndexes || [];
      const abstain = voteStatus.abstainPlayerIndexes || [];
      const myIndex = myMember && myMember.playerIndex;
      const hasVoted = myIndex != null && voted.includes(myIndex);

      const progressList = players
        .filter((p) => p.alive !== false)
        .map((p) => {
          let statusText = '未投票';
          if (abstain.includes(p.playerIndex)) statusText = '已弃票';
          else if (voted.includes(p.playerIndex)) statusText = '已投票';
          return { playerIndex: p.playerIndex, name: p.name, statusText };
        });

      const tally = voteStatus.tally || {};
      const tallyList = Object.keys(tally)
        .map((key) => {
          const idx = Number(key);
          const p = players.find((x) => x.playerIndex === idx);
          return {
            playerIndex: idx,
            name: (p && p.name) || `玩家${idx}`,
            votes: Number(tally[key]) || 0
          };
        })
        .sort((a, b) => b.votes - a.votes);

      this.setData({
        isHost,
        avatarList: buildAvatarList(members),
        hasVoted,
        circleSlots: buildCircleSlots(players, memberByIndex),
        progressList,
        tallyList
      });

      this.ensureTicker(spyGame.voteStartedAt, spyGame.voteDeadlineMs || VOTE_ROUND_MS);

      if (!isHost) {
        followSpyRoomState(result, roomId, { stayOnPage: 'spyvote' });
      }
    } catch (e) {
      console.warn('spy vote refresh', e);
    }
  },

  onSelectTarget(e) {
    if (this.data.isHost || this.data.hasVoted) return;
    const index = Number(e.currentTarget.dataset.index);
    const slot = (this.data.circleSlots || []).find((s) => s.playerIndex === index);
    if (!slot || slot.isMe) {
      wx.showToast({ title: '不能投自己', icon: 'none' });
      return;
    }
    this.setData({ selectedIndex: index });
  },

  async onConfirmVote() {
    if (this.data.isHost || this.data.hasVoted || this.data.acting) return;
    if (!this.data.selectedIndex) {
      wx.showToast({ title: '请先选择目标', icon: 'none' });
      return;
    }
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('submitVote', {
        roomId: this.data.roomId,
        targetPlayerIndex: this.data.selectedIndex
      });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '投票失败', icon: 'none' });
      } else {
        this.setData({ hasVoted: true });
        wx.showToast({ title: '投票成功', icon: 'success' });
      }
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '投票失败', icon: 'none' });
    } finally {
      this.setData({ acting: false });
      this.refresh();
    }
  },

  async onAbstain() {
    if (this.data.isHost || this.data.hasVoted || this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('submitVote', {
        roomId: this.data.roomId,
        abstain: true
      });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '弃票失败', icon: 'none' });
      } else {
        this.setData({ hasVoted: true });
        wx.showToast({ title: '已弃票', icon: 'success' });
      }
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '弃票失败', icon: 'none' });
    } finally {
      this.setData({ acting: false });
      this.refresh();
    }
  },

  async onConfirmResult() {
    if (!this.data.isHost || this.data.acting) return;
    this.setData({ acting: true });
    wx.showLoading({ title: '结算中…' });
    try {
      const result = await callSpyAction('confirmResult', { roomId: this.data.roomId });
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '确认失败', icon: 'none' });
        this.setData({ acting: false });
        return;
      }
      if (result.settled) {
        openUrl(buildSpyPageUrl('settle', this.data.roomId), { immediate: true, noReLaunch: true });
      } else {
        openUrl(buildSpyPageUrl('result', this.data.roomId), { immediate: true, noReLaunch: true });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.errMsg) || '确认失败', icon: 'none' });
      this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  }
});
