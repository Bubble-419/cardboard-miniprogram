const {
  callCloudFunction,
  callSpyAction,
  goRoomPage,
  buildAvatarList,
  buildSpyPageUrl,
  openUrl,
  SPEAK_TURN_MS,
  startSpyCountdownTicker,
  withSpyRefreshGuard,
  samePlayerIndex
} = require('../../../../utils/spyMode');
const { assignAvatarImages } = require('../../../../utils/avatars');
const { followSpyRoomState } = require('../../../../utils/spyFollow');
const { getWordCardAssets, getLibraryGroupCount } = require('../../../../utils/spyWordCardAssets');

const DEFAULT_AVATAR = '/assets/avatar/frame_2085662311_1x.webp';

function buildProgressList(spyGame, myPlayerIndex, memberByIndex) {
  const order = spyGame.speakOrder || [];
  const players = spyGame.players || [];
  const cur = spyGame.currentSpeakIndex != null ? Number(spyGame.currentSpeakIndex) : 0;
  const speakAllDone = order.length > 0 && cur >= order.length;

  return order.map((idx, i) => {
    const p = players.find((x) => samePlayerIndex(x.playerIndex, idx));
    const member = (memberByIndex && (memberByIndex[Number(idx)] || memberByIndex[idx])) || {};
    const alive = !p || p.alive !== false;
    const isMe = samePlayerIndex(idx, myPlayerIndex);
    const isCurrent = !speakAllDone && i === cur && alive;

    let statusKey = 'waiting';
    let statusText = '等待中';
    if (!alive) {
      statusKey = 'out';
      statusText = '已出局';
    } else if (speakAllDone || i < cur) {
      statusKey = 'done';
      statusText = '已发言';
    } else if (isCurrent) {
      statusKey = 'speaking';
      statusText = '发言中';
    }

    return {
      playerIndex: Number(idx),
      name: (p && p.name) || member.nickName || `玩家${idx}`,
      avatarImage: member.avatarImage || DEFAULT_AVATAR,
      rank: i + 1,
      isCurrent,
      isMe,
      statusKey,
      statusText
    };
  });
}

Page({
  data: {
    roomId: '',
    navbarPaddingTop: 44,
    avatarList: [],
    turnCountdownText: '1:00',
    myCard: null,
    myWord: '',
    myBlurb: '',
    cardBackSrc: '',
    assignedWordSrc: '',
    assignedWordFallbackSrc: '',
    word1Src: '',
    word1FallbackSrc: '',
    cardReady: false,
    libraryGroupCount: 0,
    acting: false,
    isMyTurn: false,
    speakAllDone: false,
    tieBreak: false,
    progressList: [],
    canFinish: false
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
      navbarPaddingTop,
      libraryGroupCount: getLibraryGroupCount()
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

  ensureTurnTicker(startedAt, durationMs) {
    const duration = durationMs || SPEAK_TURN_MS;
    if (!startedAt) {
      this.stopTicker();
      this._turnStartedAt = 0;
      this.setData({ turnCountdownText: '0:00' });
      return;
    }
    if (this._turnStartedAt === startedAt && this._tickTimer) {
      this._speakDuration = duration;
      return;
    }
    this.stopTicker();
    this._turnStartedAt = startedAt;
    this._speakDuration = duration;
    this._tickTimer = startSpyCountdownTicker(
      this,
      () => this._turnStartedAt,
      this._speakDuration,
      'turnCountdownText'
    );
  },

  async refresh() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    await withSpyRefreshGuard(this, async () => {
      try {
        const res = await callCloudFunction('getAddPlayerData', { roomId });
        const result = (res && res.result) || {};
        if (!this._pageAlive || result.ok !== true) return;

        followSpyRoomState(result, roomId, {
          stayOnPage: 'spyspeak',
          allowHost: true
        });

        const spyGame = result.roomState && result.roomState.spyGame;
        const members = result.members || [];
        const membersWithAvatar = assignAvatarImages(members);
        const memberByIndex = {};
        membersWithAvatar.forEach((m) => {
          if (m && m.playerIndex != null) {
            memberByIndex[m.playerIndex] = m;
            memberByIndex[Number(m.playerIndex)] = m;
          }
        });

        this.setData({ avatarList: buildAvatarList(members) });
        if (!spyGame) return;

        const myMember = members.find((m) => m.isMe);
        let myPlayerIndex = myMember ? myMember.playerIndex : null;
        // 兼容：用自己的卡确认 playerIndex
        let myCard = this.data.myCard;
        if (!myCard) {
          const cardRes = await callSpyAction('getMyCard', { roomId });
          if (cardRes.ok && this._pageAlive) {
            myCard = cardRes.card;
          }
        }
        if (myPlayerIndex == null && myCard && myCard.playerIndex != null) {
          myPlayerIndex = myCard.playerIndex;
        }

        const order = spyGame.speakOrder || [];
        const cur = spyGame.currentSpeakIndex != null ? Number(spyGame.currentSpeakIndex) : 0;
        const speakAllDone = order.length > 0 && cur >= order.length;
        const currentPlayerIndex = !speakAllDone && cur < order.length ? order[cur] : null;
        const isMyTurn = !speakAllDone
          && currentPlayerIndex != null
          && myPlayerIndex != null
          && samePlayerIndex(currentPlayerIndex, myPlayerIndex);

        const myWord = (myCard && myCard.word) || '';
        const assets = getWordCardAssets(myWord);

        // 仅在词语/资源首次就绪或变化时更新卡面路径，减少组件抖动
        const nextCard = {
          myCard,
          myWord,
          myBlurb: (myCard && myCard.blurb) || '',
          isMyTurn,
          speakAllDone,
          tieBreak: spyGame.tieBreak === true,
          progressList: buildProgressList(spyGame, myPlayerIndex, memberByIndex),
          canFinish: isMyTurn && !this.data.acting
        };
        const cardReady = !!(myWord && (assets.assignedWordSrc || assets.assignedWordFallbackSrc));
        if (
          myWord !== this.data.myWord
          || assets.assignedWordSrc !== this.data.assignedWordSrc
          || !this.data.cardReady
        ) {
          nextCard.cardBackSrc = assets.backSrc;
          nextCard.assignedWordSrc = assets.assignedWordSrc;
          nextCard.assignedWordFallbackSrc = assets.assignedWordFallbackSrc;
          nextCard.word1Src = assets.word1Src;
          nextCard.word1FallbackSrc = assets.word1FallbackSrc;
          nextCard.cardReady = cardReady;
        }

        this.setData(nextCard);

        this.ensureTurnTicker(
          speakAllDone ? 0 : (spyGame.speakTurnStartedAt || spyGame.speakRoundStartedAt || 0),
          spyGame.speakTurnMs || SPEAK_TURN_MS
        );
      } catch (e) {
        console.warn('spy speak refresh', e);
      }
    });
  },

  async onFinishSpeak() {
    if (!this.data.isMyTurn || this.data.acting || this.data.speakAllDone) return;
    this.setData({ acting: true, canFinish: false });
    try {
      const result = await callSpyAction('advanceSpeak', { roomId: this.data.roomId });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '操作失败', icon: 'none' });
        return;
      }
      if (result.autoVote || result.finished) {
        wx.showToast({ title: '进入匿名投票', icon: 'success' });
        openUrl(buildSpyPageUrl('vote', this.data.roomId), {
          immediate: true,
          noReLaunch: true
        });
        return;
      }
      await this.refresh();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
    } finally {
      if (this._pageAlive) this.setData({ acting: false });
    }
  },

  handleGoRoom() {
    goRoomPage(this.data.roomId);
  },

  onOpenLibrary() {
    wx.navigateTo({
      url: buildSpyPageUrl('cardLibrary', this.data.roomId)
    });
  }
});
