const { saveHistoryScenario, shouldSaveSelectedBGToHistory, isValidPartnerBG } = require('../../../../utils/partnerScenarios');
const { goRoomPage } = require('../../../../utils/goRoomPage');
const { buildAvatarListAsync } = require('../../../../utils/avatars');
const { safeNavigateBack } = require('../../../../utils/pageNavigate');
const { resolveSelectedDesignProblem } = require('../utils/selectedDesignProblem');
const { buildCategoriesFromBG, normalizeBG } = require('../../../../utils/scenarioCategories');
const {
  bindPageToRoomSession,
  dispatchRoomCommand,
  followRoomRouteAfterCommand,
  getRoomPageSnapshot,
  unbindPageFromRoomSession
} = require('../../../../modules/room-session/index');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../../utils/pageInteractionLock');

const PARTNER_CARD_DEFS = [
  { type: 'scene', label: '场景' },
  { type: 'user', label: '用户' },
  { type: 'platform', label: '平台' },
  { type: 'function', label: '功能' }
];

Page(withPageInteractionLock({
  data: {
    roomId: '',
    cards: [],
    canConfirm: false,
    isHost: true,
    isWaiting: false,
    /** 从 gamepage / submitProblem 回看情境：只读 */
    fromGameView: false,
    from: '',
    /** 游戏页点设计问题进入：缩小叠卡 + 完整问题，一屏不滚 */
    isGameDetail: false,
    /** 缩小叠卡叠距（rpx） */
    deckStepRpx: 118,
    /** 底部主按钮文案 */
    returnBtnText: '返回游戏',
    avatarList: [],
    fullProblemText: '',
    categories: []
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    const isWaiting = options && (options.isWaiting === '1' || options.isWaiting === true);
    const from = (options && options.from) || '';
    // game：游戏页回看；submit/select：提交/选择设计问题页回看 —— 均为只读确认情境
    const fromGameView = from === 'game' || from === 'submit' || from === 'select'
      || options.fromGame === '1'
      || options.fromGame === true;
    const isGameDetail = from === 'game' || options.fromGame === '1' || options.fromGame === true;
    const returnBtnText = (from === 'submit' || from === 'select') ? '返回' : '返回游戏';
    // 游戏页传入的最终选定设计问题（URL / eventChannel / globalData）
    let passedProblemText = '';
    try {
      passedProblemText = options && options.problemText
        ? decodeURIComponent(options.problemText)
        : '';
    } catch (e) {
      passedProblemText = (options && options.problemText) || '';
    }
    this._passedProblemText = String(passedProblemText || '').trim();
    this._fromGameView = fromGameView;
    this._fromSource = from || (fromGameView ? 'game' : '');
    this.setData({ from: this._fromSource });

    if (roomId) {
      getApp().globalData.roomId = roomId;
    }

    // eventChannel 可传长文案，避免 URL 编码丢失
    try {
      const ec = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (ec && typeof ec.on === 'function') {
        ec.on('initGameDetail', (payload) => {
          const text = payload && payload.problemText
            ? String(payload.problemText).trim()
            : '';
          if (text) {
            this._passedProblemText = text;
            if (getApp().globalData) {
              getApp().globalData.selectedProblem = {
                id: (payload && payload.problemId) || '',
                text
              };
            }
            if (this.data.isGameDetail && text !== this.data.fullProblemText) {
              this.setData({ fullProblemText: text });
            }
          }
          if (payload && payload.selectedBG && isValidPartnerBG(payload.selectedBG, { requirePlatform: true })) {
            getApp().globalData.selectedBG = payload.selectedBG;
          }
        });
      }
    } catch (e) {
      console.warn('confirmBG eventChannel', e);
    }

    if (fromGameView) {
      this.setData({
        roomId,
        fromGameView: true,
        isGameDetail,
        returnBtnText,
        // 先用已传入文案占位，避免等云端时空白
        fullProblemText: this._passedProblemText
          || ((getApp().globalData.selectedProblem
            && getApp().globalData.selectedProblem.text) || '')
      });
      this._initPage(roomId);
      return;
    }

    if (isWaiting) {
      this.setData({ roomId, isWaiting: true, isHost: false });
      this._syncAvatarList();
      this._startStatePolling();
      return;
    }

    this._initPage(roomId);
  },

  async _syncAvatarListFromResult(result) {
    if (!result || result.ok !== true) return;
    try {
      const avatarList = await buildAvatarListAsync(result.members || []);
      this.setData({ avatarList });
    } catch (e) {
      console.warn('confirmBG buildAvatarList', e);
    }
  },

  async _syncAvatarList() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      await this._syncAvatarListFromResult(result);
    } catch (e) {
      console.warn('confirmBG syncAvatarList', e);
    }
  },

  _buildCardsAndFullText(bg, selectedProblemText) {
    const cards = PARTNER_CARD_DEFS.map((item) => ({
      ...item,
      value: (bg && bg[item.type] || '').trim()
    })).filter((item) => item.value);

    // 完整设计问题 = 本轮最终选定的设计问题全文（非情境四项拼接）
    const fullProblemText = String(selectedProblemText || '').trim();
    const categories = buildCategoriesFromBG(normalizeBG(bg));
    return { cards, fullProblemText, categories };
  },

  async _initPage(roomId) {
    const fromGameView = this._fromGameView === true;
    let bg = getApp().globalData.selectedBG;
    let roomResult = null;
    if (fromGameView) {
      roomResult = await this._fetchRoomFull(roomId);
      bg = (roomResult && roomResult.selectedBG) || null;
      if (bg) {
        getApp().globalData.selectedBG = bg;
      }
    } else if (!isValidPartnerBG(bg, { requirePlatform: true })) {
      roomResult = await this._fetchRoomFull(roomId);
      bg = (roomResult && roomResult.selectedBG) || null;
      if (bg) getApp().globalData.selectedBG = bg;
    }

    if (!isValidPartnerBG(bg, { requirePlatform: true })) {
      wx.showToast({ title: '请先选择情境', icon: 'none' });
      setTimeout(() => {
        if (fromGameView) {
          this.handleReturnToGame();
          return;
        }
        const id = roomId || getApp().globalData.roomId || '';
        if (id) {
          wx.redirectTo({
            url: `/pages/main-pages/modeIndex/index?roomId=${encodeURIComponent(id)}&modeId=partner`
          });
        } else {
          wx.navigateBack();
        }
      }, 800);
      return;
    }

    if (roomResult) {
      this._syncAvatarListFromResult(roomResult);
    }

    const selectedProblem = resolveSelectedDesignProblem(getApp(), roomResult || {});
    const selectedProblemText = this._passedProblemText
      || (selectedProblem && selectedProblem.text)
      || (roomResult && roomResult.selectedDesignProblem && roomResult.selectedDesignProblem.text)
      || (getApp().globalData.selectedProblem && getApp().globalData.selectedProblem.text)
      || '';
    if (selectedProblemText && getApp().globalData) {
      getApp().globalData.selectedProblem = {
        id: (selectedProblem && selectedProblem.id)
          || (roomResult && roomResult.selectedDesignProblem && roomResult.selectedDesignProblem.id)
          || '',
        text: selectedProblemText
      };
    }
    const { cards, fullProblemText, categories } = this._buildCardsAndFullText(bg, selectedProblemText);
    const canConfirm = cards.length === PARTNER_CARD_DEFS.length;

    this.setData({
      roomId,
      cards,
      categories,
      fullProblemText,
      canConfirm: fromGameView ? false : canConfirm,
      isWaiting: false
    });

    if (fromGameView) {
      if (!roomResult) this._syncAvatarList();
      return;
    }

    this._fetchHostStatus();
  },

  async _fetchRoomFull(roomId) {
    if (!roomId) return null;
    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (result.ok === true) return result;
    } catch (e) {
      console.warn('confirmBG fetchRoomFull', e);
    }
    return null;
  },

  async _fetchSelectedBGFromRoom(roomId) {
    const result = await this._fetchRoomFull(roomId);
    return (result && result.selectedBG) || null;
  },

  onHide() {
    this._stopStatePolling();
  },

  onUnload() {
    this._stopStatePolling();
  },

  async _fetchHostStatus() {
    if (this._fromGameView) return;
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      this.setData({ isHost: true });
      return;
    }
    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (result.ok === true) {
        const isHost = result.isHost === true;
        this._syncAvatarListFromResult(result);
        this.setData({ isHost, roomId });
        if (!isHost) {
          this._startStatePolling();
        }
      }
    } catch (e) {
      this.setData({ isHost: true });
    }
  },

  _startStatePolling() {
    if (this._fromGameView) return;
    this._stopStatePolling();
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) return;
    bindPageToRoomSession(this, {
      getRoomId: () => roomId,
      followNavigation: true,
      onSnapshot: (result) => this._syncAvatarListFromResult(result)
    }).catch((e) => console.warn('confirmBG bind room', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
  },

  /** 按来源页返回：game → 对局；submit/select → 设计问题流程页 */
  handleReturnToGame() {
    return runPageInteraction(this, () => this._returnToGame(), {
      loadingText: '正在返回…'
    });
  },

  _returnToGame() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    const roomEnc = roomId ? encodeURIComponent(roomId) : '';
    const from = this._fromSource || '';
    if (from === 'submit') {
      safeNavigateBack({
        expectedPrev: 'pages/main-pages/submitProblem/index',
        fallbackUrl: roomEnc
          ? `/pages/main-pages/submitProblem/index?roomId=${roomEnc}`
          : '/pages/main-pages/submitProblem/index'
      });
      return;
    }
    if (from === 'select') {
      safeNavigateBack({
        expectedPrev: 'pages/main-pages/selectProblem/index',
        fallbackUrl: roomEnc
          ? `/pages/main-pages/selectProblem/index?roomId=${roomEnc}`
          : '/pages/main-pages/selectProblem/index'
      });
      return;
    }
    safeNavigateBack({
      expectedPrev: 'pages/main-pages/partnerMode/gamepage/index',
      fallbackUrl: roomEnc
        ? `/pages/main-pages/partnerMode/gamepage/index?roomId=${roomEnc}`
        : ''
    });
  },

  handleConfirm() {
    return runPageNavigation(this, () => this._confirm(), {
      loadingText: '正在进入提交…'
    });
  },

  async _confirm() {
    if (this.data.fromGameView) return;
    if (!this.data.isHost || !this.data.canConfirm) return;

    const bg = getApp().globalData.selectedBG;
    if (!bg) {
      wx.showToast({ title: '情境数据丢失', icon: 'none' });
      return;
    }

    const bgSource = getApp().globalData.selectedBGSource;
    if (shouldSaveSelectedBGToHistory(bgSource)) {
      saveHistoryScenario(bg);
    }

    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '缺少房间信息', icon: 'none' });
      return;
    }

    try {
      const result = await dispatchRoomCommand('SET_SCENARIO', {
        source: String(bgSource || 'CUSTOM').toUpperCase(),
        scenario: bg
      });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '操作失败', icon: 'none' });
        return;
      }
      await followRoomRouteAfterCommand(result, roomId);
      return null;
    } catch (e) {
      console.error('handleConfirm', e);
      wx.showToast({ title: e.errMsg || '操作失败', icon: 'none' });
    }
  },

  handleCardTap(e) {
    return runPageNavigation(this, async () => {
      if (this.data.fromGameView) return null;
      const index = parseInt(e.currentTarget.dataset.index || '0', 10);
      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      let url = `/pages/main-pages/selectBG/index?mode=partner&step=${index}`;
      if (roomId) url += `&roomId=${encodeURIComponent(roomId)}`;
      return { method: 'redirectTo', url };
    }, { loadingText: '正在打开情境…' });
  },

  handleGoBack() {
    if (this.data.fromGameView) {
      return runPageInteraction(this, () => this._returnToGame(), {
        loadingText: '正在返回…'
      });
    }
    return runPageInteraction(this, async () => {
      const roomId = this.data.roomId || '';
      const fallbackUrl = roomId
        ? `/pages/main-pages/modeIndex/index?roomId=${encodeURIComponent(roomId)}&modeId=partner`
        : '/pages/main-pages/modeIndex/index?modeId=partner';
      safeNavigateBack({
        expectedPrev: [
          'pages/main-pages/modeIndex/index',
          'pages/main-pages/selectBG/index'
        ],
        fallbackUrl
      });
    }, { loadingText: '正在返回…' });
  },

  handleGoRoom() {
    if (this.data.fromGameView) {
      // 回看情境时点房间入口：先回到游戏再进大厅，避免弄丢游戏页栈
      return runPageInteraction(this, () => this._returnToGame(), {
        loadingText: '正在返回游戏…'
      });
    }
    return runPageInteraction(this, () => goRoomPage(this.data.roomId), {
      loadingText: '正在返回房间…'
    });
  }
}, ['handleReturnToGame', 'handleCardTap', 'handleConfirm', 'handleGoBack', 'handleGoRoom']));
