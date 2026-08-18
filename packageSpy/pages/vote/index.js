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
  playerIndexIncludes,
  startSpyRoomPoll,
  stopSpyRoomPoll,
  bumpSpyRoomSession
} = require('../../../utils/spyMode');
const { assignAvatarImages, buildAvatarList } = require('../../../utils/avatars');
const { followSpyRoomState } = require('../../../utils/spyFollow');
const {
  buildTiedNames,
  isTieReturnPending,
  showTieReturnModal
} = require('../../../utils/spyTiePrompt');

function buildCircleSlots(players, memberByIndex, tiedIndexSet) {
  const list = (players || []).filter((p) => p.alive !== false);
  const n = list.length || 1;
  const radius = 38;
  const tied = tiedIndexSet || new Set();
  return list.map((p, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const left = 50 + radius * Math.cos(angle);
    const top = 50 + radius * Math.sin(angle);
    const member = memberByIndex[p.playerIndex] || memberByIndex[Number(p.playerIndex)] || {};
    const playerIndex = Number(p.playerIndex);
    return {
      playerIndex,
      name: p.name,
      isMe: !!p.isMe,
      isTied: tied.has(playerIndex),
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
    eliminated: false,
    tieBreak: false,
    showTieBanner: false,
    tiedNamesText: '',
    tieBannerTitle: '并列玩家需重新投票'
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
    startSpyRoomPoll(this, {
      intervalMs: 800,
      onPollResult: (result) => this.refresh(result)
    });
  },

  stopPolling() {
    stopSpyRoomPoll(this);
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
      this._voteDuration,
      'countdownText',
      (msLeft) => this._onCountdownTick(msLeft)
    );
  },

  /** 倒计时结束：若未出局且尚未投票，自动提交弃票 */
  _onCountdownTick(msLeft) {
    if (msLeft > 0) return;
    if (!this._pageAlive || this.data.eliminated || this.data.hasVoted || this._autoAbstaining) return;
    this._autoAbstaining = true;
    this.submitVote({ abstain: true }).finally(() => {
      this._autoAbstaining = false;
    });
  },

  async refresh(prefetchedResult) {
    const roomId = this.data.roomId;
    if (!roomId) return;
    await withSpyRefreshGuard(this, async () => {
      try {
        const result = (prefetchedResult && prefetchedResult.ok === true)
          ? prefetchedResult
          : await fetchRoomDataOrExit(roomId);
        if (!this._pageAlive || !result || result.ok !== true) return;

        const members = result.members || [];
        const spyGame = (result.roomState && result.roomState.spyGame) || {};
        if (this._holdVoteForTieSpeak(spyGame)) {
          return;
        }

        followSpyRoomState(result, roomId, {
          stayOnPage: 'spyvote',
          allowHost: true
        });
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
        const last = spyGame.lastResult || {};
        const tiedIndexes = Array.isArray(last.tiedIndexes) ? last.tiedIndexes : [];
        const tiedIndexSet = new Set(tiedIndexes.map((idx) => Number(idx)));
        const tiedNamesText = buildTiedNames(spyGame).join('、');
        const showTieBanner = spyGame.tieBreak === true || last.tied === true;
        const holdingTieSpeak = isTieReturnPending(spyGame);

        this.setData({
          avatarList: buildAvatarList(members),
          hasVoted,
          eliminated,
          tieBreak: spyGame.tieBreak === true,
          showTieBanner,
          tiedNamesText,
          tieBannerTitle: holdingTieSpeak || spyGame.phase === 'speak'
            ? '并列玩家需重新陈述'
            : '并列玩家需重新投票',
          circleSlots: buildCircleSlots(players, memberByIndex, tiedIndexSet),
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

  _applyTieBanner(spyGame) {
    const last = (spyGame && spyGame.lastResult) || {};
    const tiedIndexes = Array.isArray(last.tiedIndexes) ? last.tiedIndexes : [];
    const tiedIndexSet = new Set(tiedIndexes.map((idx) => Number(idx)));
    const players = this.data.circleSlots || [];
    const nextSlots = players.map((slot) => ({
      ...slot,
      isTied: tiedIndexSet.has(Number(slot.playerIndex))
    }));
    this.setData({
      tieBreak: true,
      showTieBanner: true,
      tiedNamesText: buildTiedNames(spyGame).join('、'),
      tieBannerTitle: '并列玩家需重新陈述',
      circleSlots: nextSlots
    });
  },

  _goSpeakAfterTie() {
    this.stopPolling();
    this.stopTicker();
    bumpSpyRoomSession();
    const navigated = openUrl(buildSpyPageUrl('speak', this.data.roomId), {
      immediate: true,
      noReLaunch: true
    });
    if (navigated) this._pageAlive = false;
  },

  /** 平票已切回发言：停在投票页弹确认，点确定后再走 */
  _holdVoteForTieSpeak(spyGame) {
    if (!isTieReturnPending(spyGame)) return false;
    this.stopTicker();
    this._applyTieBanner(spyGame);
    showTieReturnModal(spyGame, () => this._goSpeakAfterTie());
    return true;
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
    if (!this.data.selectedIndex) {
      wx.showToast({ title: '请先选择怀疑对象', icon: 'none' });
      return;
    }
    await this.submitVote({ abstain: false });
  },

  async onAbstain() {
    if (this.data.hasVoted || this.data.eliminated || this.data.acting) return;
    await this.submitVote({ abstain: true });
  },

  async submitVote({ abstain = false } = {}) {
    if (this.data.hasVoted || this.data.eliminated || this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await callSpyAction('submitVote', {
        roomId: this.data.roomId,
        abstain,
        targetPlayerIndex: abstain ? undefined : this.data.selectedIndex
      });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || (abstain ? '弃票失败' : '投票失败'), icon: 'none' });
        return;
      }
      if (!this._pageAlive) return;
      this.setData({ hasVoted: true });
      bumpSpyRoomSession();
      if (result.settled) {
        openUrl(buildSpyPageUrl('settle', this.data.roomId), {
          immediate: true,
          noReLaunch: true
        });
        return;
      }
      if (result.tied) {
        const spyGame = Object.assign(
          { phase: 'speak', tieBreak: true },
          result.spyGame || {}
        );
        if (!this._holdVoteForTieSpeak(spyGame)) {
          this._goSpeakAfterTie();
        }
        return;
      }
      if (result.currentPage === 'spyresult' || (result.spyGame && result.spyGame.phase === 'result')) {
        openUrl(buildSpyPageUrl('result', this.data.roomId), {
          immediate: true,
          noReLaunch: true
        });
        return;
      }
      wx.showToast({ title: abstain ? '已弃票，等待其他人' : '已提交，等待其他人', icon: 'success' });
      await this.refresh();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || (abstain ? '弃票失败' : '投票失败'), icon: 'none' });
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
