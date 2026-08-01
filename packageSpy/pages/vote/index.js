const {
  fetchRoomDataOrExit,
  callSpyAction,
  goRoomPage,
  buildSpyPageUrl,
  openUrl,
  VOTE_ROUND_MS,
  startSpyCountdownTicker,
  withSpyRefreshGuard,
  samePlayerIndex,
  playerIndexIncludes
} = require('../../../utils/spyMode');
const { assignAvatarImages, buildAvatarList } = require('../../../utils/avatars');
const { followSpyRoomState } = require('../../../utils/spyFollow');

function buildCircleSlots(players, memberByIndex) {
  const list = (players || []).filter((p) => p.alive !== false);
  const n = list.length || 1;
  const radius = 38;
  return list.map((p, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const left = 50 + radius * Math.cos(angle);
    const top = 50 + radius * Math.sin(angle);
    const member = memberByIndex[p.playerIndex] || memberByIndex[Number(p.playerIndex)] || {};
    return {
      playerIndex: Number(p.playerIndex),
      name: p.name,
      isMe: !!p.isMe,
      avatarImage: member.avatarImage || '/assets/avatar/frame_2085662311_1x.png',
      left: left.toFixed(2),
      top: top.toFixed(2)
    };
  });
}

Page({
  data: {
    roomId: '',
    avatarList: [],
    countdownText: '2:00',
    circleSlots: [],
    selectedIndex: null,
    hasVoted: false,
    votedCount: 0,
    totalVoters: 0,
    acting: false,
    eliminated: false
  },

  onLoad(options) {
    this._pageAlive = true;
    this.setData({
      roomId: (options && options.roomId) || getApp().globalData.roomId || ''
    });
  },

  onShow() {
    this._pageAlive = true;
    this.refresh();
    this.startPolling();
  },

  onHide() {
    this._pageAlive = false;
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
    this._pollTimer = setInterval(() => {
      if (this._pageAlive === false) return;
      this.refresh();
    }, 800);
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
    await withSpyRefreshGuard(this, async () => {
      try {
        const result = await fetchRoomDataOrExit(roomId);
        if (!this._pageAlive || !result || result.ok !== true) return;

        followSpyRoomState(result, roomId, {
          stayOnPage: 'spyvote',
          allowHost: true
        });

        const members = result.members || [];
        const spyGame = (result.roomState && result.roomState.spyGame) || {};
        const membersWithAvatar = assignAvatarImages(members);
        const memberByIndex = {};
        membersWithAvatar.forEach((m) => {
          if (m && m.playerIndex != null) {
            memberByIndex[m.playerIndex] = m;
            memberByIndex[Number(m.playerIndex)] = m;
          }
        });

        const myMember = members.find((m) => m.isMe);
        const myIndex = myMember && myMember.playerIndex;
        const mySnap = (spyGame.players || []).find((p) => samePlayerIndex(p.playerIndex, myIndex));
        const eliminated = !!(mySnap && mySnap.alive === false);

        const players = (spyGame.players || []).map((p) => ({
          ...p,
          playerIndex: Number(p.playerIndex),
          isMe: samePlayerIndex(myIndex, p.playerIndex)
        }));

        const voteStatus = spyGame.voteStatus || {};
        const voted = voteStatus.votedPlayerIndexes || [];
        const serverHasVoted = playerIndexIncludes(voted, myIndex);
        const hasVoted = this.data.hasVoted || serverHasVoted;

        this.setData({
          avatarList: buildAvatarList(members),
          hasVoted,
          eliminated,
          circleSlots: buildCircleSlots(players, memberByIndex),
          votedCount: voteStatus.votedCount != null ? voteStatus.votedCount : voted.length,
          totalVoters: voteStatus.totalVoters != null
            ? voteStatus.totalVoters
            : players.filter((p) => p.alive !== false && p.leftRoom !== true).length
        });

        this.ensureTicker(spyGame.voteStartedAt, spyGame.voteDeadlineMs || VOTE_ROUND_MS);
      } catch (e) {
        console.warn('spy vote refresh', e);
      }
    });
  },

  onSelectTarget(e) {
    if (this.data.hasVoted || this.data.eliminated) return;
    const index = Number(e.currentTarget.dataset.index);
    const slot = (this.data.circleSlots || []).find((s) => samePlayerIndex(s.playerIndex, index));
    if (!slot || slot.isMe) {
      wx.showToast({ title: '不能投自己', icon: 'none' });
      return;
    }
    this.setData({ selectedIndex: index });
  },

  async onConfirmVote() {
    if (this.data.hasVoted || this.data.eliminated || this.data.acting) return;
    if (!this.data.selectedIndex) {
      wx.showToast({ title: '请先选择怀疑对象', icon: 'none' });
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
        return;
      }
      this.setData({ hasVoted: true });
      if (result.settled) {
        openUrl(buildSpyPageUrl('settle', this.data.roomId), {
          immediate: true,
          noReLaunch: true
        });
        return;
      }
      if (result.tied) {
        wx.showToast({ title: '平票，进入加时陈述', icon: 'none' });
        openUrl(buildSpyPageUrl('speak', this.data.roomId), {
          immediate: true,
          noReLaunch: true
        });
        return;
      }
      if (result.currentPage === 'spyresult' || (result.spyGame && result.spyGame.phase === 'result')) {
        openUrl(buildSpyPageUrl('result', this.data.roomId), {
          immediate: true,
          noReLaunch: true
        });
        return;
      }
      wx.showToast({ title: '已提交，等待其他人', icon: 'success' });
      await this.refresh();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '投票失败', icon: 'none' });
    } finally {
      if (this._pageAlive) this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    this._pageAlive = false;
    if (typeof this.stopPolling === 'function') this.stopPolling();
    goRoomPage(this.data.roomId);
  }
});
