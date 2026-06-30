/**
 * 合伙人模式 - 出牌页
 * 路径：pages/main-pages/partnerMode/gamepage/
 */
const { assignAvatarImages } = require('../../../../utils/avatars');
const { buildStatementUrl, buildSpecialMoveUrl } = require('../../../../utils/modeRoutes');
const { navigateByRoomState } = require('../../../../utils/subAwaitRoutes');
const { resolveSelectedDesignProblem } = require('../../../../utils/selectedDesignProblem');

Page({
  data: {
    roomId: '',
    isHost: false,
    avatarList: [],
    currentPlayerIndex: 1,
    currentPlayerKey: null,
    currentPlayerName: '玩家1',
    isCurrentPlayer: false,
    selectedProblemText: '',
    cardIndex: 0,
    insertedImages: [],
    scoreOptions: [0, 1, 2, 3, 4, 5],
    selectedScore: null,
    scoredCount: 0,
    totalRequired: 0,
    canStartStatement: false,
    playHistory: [
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    ],
    discussionNotes: [
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    ]
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10)
      : 1;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    getApp().globalData.roomId = roomId;
    getApp().globalData.gameMode = 'partner';

    this.setData({
      roomId,
      currentPlayerIndex
    });

    this.loadRoomData();
  },

  onShow() {
    this.refreshScoreStatus();
  },

  onUnload() {
    this._stopScorePolling();
    this._stopStatePolling();
  },

  async loadRoomData() {
    const roomId = this.data.roomId;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true || !result.members || !result.members.length) {
        wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        return;
      }

      const members = assignAvatarImages(result.members);
      const currentPlayerIndex = this.data.currentPlayerIndex;
      const current = members.find((m) => m.playerIndex === currentPlayerIndex);
      const me = members.find((m) => m.isMe);
      const currentPlayerName = current
        ? (current.nickName || `玩家${currentPlayerIndex}`)
        : `玩家${currentPlayerIndex}`;
      const isCurrentPlayer = !!(me && me.playerIndex === currentPlayerIndex);

      const avatarList = members.map((m) => ({
        id: m.userId || String(m.playerIndex),
        avatar: m.avatarImage || '',
        nickName: m.nickName,
        isMe: m.isMe
      }));

      const app = getApp();
      const selectedProblem = resolveSelectedDesignProblem(app, result);
      const selectedProblemText = selectedProblem && selectedProblem.text
        ? selectedProblem.text
        : '';

      this.setData({
        members,
        avatarList,
        currentPlayerKey: current ? (current.userId || String(current.playerIndex)) : null,
        currentPlayerName,
        isCurrentPlayer,
        isHost: result.isHost === true,
        selectedProblemText,
        totalRequired: Math.max(0, members.length - 1)
      });

      if (result.isHost === true) {
        await this._updateRoomState('gamepage', currentPlayerIndex, currentPlayerName);
        this._stopStatePolling();
      } else {
        this._startStatePolling();
      }

      this.refreshScoreStatus();
      this._startScorePolling();
    } catch (e) {
      console.error('partner gamepage loadRoomData', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async refreshScoreStatus() {
    const { roomId, currentPlayerIndex, isHost } = this.data;
    if (!roomId) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getGameScoreStatus',
        data: { roomId, currentPlayerIndex }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) return;

      const scoredCount = result.scoredCount || 0;
      const totalRequired = result.totalRequired != null
        ? result.totalRequired
        : this.data.totalRequired;
      const canStartStatement = isHost
        && totalRequired > 0
        && scoredCount >= totalRequired;

      this.setData({
        scoredCount,
        totalRequired,
        canStartStatement
      });
    } catch (e) {
      console.warn('refreshScoreStatus', e);
    }
  },

  _startScorePolling() {
    this._stopScorePolling();
    this._scorePollTimer = setInterval(() => this.refreshScoreStatus(), 1500);
  },

  _stopScorePolling() {
    if (this._scorePollTimer) {
      clearInterval(this._scorePollTimer);
      this._scorePollTimer = null;
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
        if (page === 'gamepage') return;
        if (page === 'statement') {
          const idx = result.roomState.currentPlayerIndex != null
            ? result.roomState.currentPlayerIndex
            : this.data.currentPlayerIndex;
          const name = result.roomState.currentPlayerName || this.data.currentPlayerName;
          wx.redirectTo({
            url: buildStatementUrl(roomId, idx, name, { isWaiting: true })
          });
          return;
        }
        navigateByRoomState(page, result.roomState, roomId);
      } catch (e) {
        console.warn('partner gamepage state poll', e);
      }
    };
    poll();
    this._statePollTimer = setInterval(poll, 1500);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName) {
    const roomId = this.data.roomId || '';
    if (!roomId) return false;
    try {
      const data = { roomId, currentPage };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      const res = await wx.cloud.callFunction({ name: 'updateRoomState', data });
      const result = (res && res.result) || {};
      return result.ok === true;
    } catch (e) {
      console.warn('updateRoomState', e);
      return false;
    }
  },

  onCardSwiperChange(e) {
    const index = e.detail && e.detail.current != null ? e.detail.current : 0;
    this.setData({ cardIndex: index });
  },

  handleInsertImage() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        const remain = 9 - (this.data.insertedImages || []).length;
        if (remain <= 0) {
          wx.showToast({ title: '最多插入 9 张图片', icon: 'none' });
          return;
        }
        wx.chooseImage({
          count: remain,
          sizeType: ['compressed'],
          sourceType,
          success: (chooseRes) => {
            const paths = chooseRes.tempFilePaths || [];
            if (!paths.length) return;
            this.setData({
              insertedImages: [...(this.data.insertedImages || []), ...paths]
            });
          },
          fail: () => {
            wx.showToast({ title: '选择图片失败', icon: 'none' });
          }
        });
      }
    });
  },

  async onScoreTap(e) {
    if (this.data.isCurrentPlayer) {
      wx.showToast({ title: '当前出牌玩家无需打分', icon: 'none' });
      return;
    }
    const score = parseInt(e.currentTarget.dataset.score, 10);
    if (!Number.isFinite(score)) return;

    this.setData({ selectedScore: score });

    const { roomId, currentPlayerIndex } = this.data;
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitGameScore',
        data: { roomId, currentPlayerIndex, score }
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
        return;
      }
      const scoredCount = result.scoredCount || 0;
      const totalRequired = result.totalRequired != null
        ? result.totalRequired
        : this.data.totalRequired;
      this.setData({
        scoredCount,
        totalRequired,
        canStartStatement: this.data.isHost
          && totalRequired > 0
          && scoredCount >= totalRequired
      });
    } catch (err) {
      console.warn('submitGameScore', err);
      wx.showToast({ title: '提交失败', icon: 'none' });
    }
  },

  handleSpecialMove() {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    wx.navigateTo({ url: buildSpecialMoveUrl(roomId) });
  },

  async handleStartStatement() {
    if (!this.data.canStartStatement) return;

    const { roomId, currentPlayerIndex, currentPlayerName } = this.data;
    const ok = await this._updateRoomState('statement', currentPlayerIndex, currentPlayerName);
    if (!ok) {
      wx.showToast({ title: '状态同步失败', icon: 'none' });
      return;
    }

    wx.redirectTo({
      url: buildStatementUrl(roomId, currentPlayerIndex, currentPlayerName)
    });
  },

  handleGoRoom() {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    wx.navigateTo({
      url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
    });
  },

  handleGoInspiration() {
    wx.navigateTo({ url: '/pages/inspiration/index' });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        const roomId = this.data.roomId || '';
        if (roomId) {
          wx.redirectTo({
            url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`
          });
        } else {
          wx.reLaunch({ url: '/pages/main-pages/aaa/index' });
        }
      }
    });
  }
});
