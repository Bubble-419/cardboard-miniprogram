const { navigateByRoomState, safeOpenUrl } = require('../../../utils/subAwaitRoutes');
const {
  followSubScreenRoomPoll,
  shouldSubScreenLeaveRoom
} = require('../../../utils/subScreenRoomPoll');
const {
  clearSpyLobbyStay,
  isSpyLobbyStayActive,
  setSpyLobbyStay
} = require('../../../utils/spyFollow');
const {
  exitRoomGone,
  handleRoomGoneFromResult,
  cancelDeferredExit
} = require('../../../utils/roomDissolved');
const { beginScanJoin, endScanJoin } = require('../../../utils/scanJoinGate');
const {
  beginUserAuthFlow,
  endUserAuthFlow
} = require('../../../utils/userAuthSession');
const { isValidPartnerBG, partnerPageNeedsBG } = require('../../../utils/partnerScenarios');
const { buildGamepageUrl, buildSpyPageUrl, buildClosingStatementUrl } = require('../../../utils/modeRoutes');
const {
  bindPageToRoomSession,
  unbindPageFromRoomSession,
  disposeRoomSession,
  getActiveRoomSession,
  dispatchRoomCommand,
  getRoomPageSnapshot
} = require('../../../modules/room-session/index');
const { normalizeModeDisplayTitle } = require('../../../utils/modeDisplayNames');
const { getDevRoomIdDisplayPatch } = require('../../../utils/devJoinRoomById');
const { assignAvatarImages, getMemberAvatarFingerprint } = require('../../../utils/avatars');
const {
  getStoredProfile,
  applyChooseAvatarEvent,
  getOptionalProfileForRoom,
  buildRoomJoinPayload,
  prepareProfileForRoom,
  syncRoomMemberProfile,
  isCloudFileId
} = require('../../../utils/wxUserAvatar');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');

const MEMBER_SLOTS = 6;   // 圆周展示的槽位数（含空位）
const CIRCLE_R = 310;     // 头像圆心半径 rpx（略放大，作为视觉主体）
const AVATAR_SIZE = 88;   // 头像直径 rpx
const CENTER_XY = 330;    // 圆心在 660rpx 区域内的坐标
const CIRCLE_WRAP_SIZE = 660;
const START_ANGLE = -Math.PI / 2; // 从顶部开始
/**
 * 长按进入拖拽的延时（毫秒）
 * 450ms 与手机桌面"长按图标进入编辑"体感一致：
 * - 短于此时间的轻触/快速滑动不会触发拖拽
 * - touchmove 超过 8px 阈值时会提前取消定时器，防止滑动误入拖拽
 */
const LONG_PRESS_ENTER_DRAG_MS = 450;

/**
 * touchmove 取消长按的位移阈值（px）
 * 手指移动超过此距离即视为"有意滑动"而非"长按静止"，立即取消长按定时器
 */
const DRAG_CANCEL_THRESHOLD_PX = 8;
/** 拖拽兜底超时：防止 touchend/cancel 丢失导致一直停在拖拽态 */
const DRAG_WATCHDOG_MS = 3000;

Page(withPageInteractionLock({
  data: {
    roomId: '',
    formattedRoomId: '',
    workshopName: '脑暴工作坊',
    isEditingRoomName: false,
    editingRoomName: '',
    isSavingRoomName: false,
    qrcodeUrl: '',
    qrcodeStatus: 'loading',
    qrcodeErrorHint: '',
    members: [],
    memberSlots: [],
    isFromScan: false,
    isHost: false,
    membershipConfirmed: false,
    memberCount: 0,
    maxMembers: MEMBER_SLOTS,
    memberCountBounce: false,
    hasSelectedMode: false,
    brainstormSessionEnded: false,
    selectedModeId: '',
    selectedModeTitle: '',
    selectedModeDesc: '',
    isDragging: false,
    draggingSlotIndex: null,
    /** 跟手：浮动头像用 px 定位，手指位置 = 头像位置 */
    dragPosX: null,
    dragPosY: null,
    draggingMember: null,
    draggingMemberId: null,
    dragFromIndex: null,
    dropTargetIndex: null,
    // 进入可拖拽态的短暂动画标记（用于视觉反馈）
    dragEnterAnimating: false,
    // 拖拽悬停在底部踢出区
    overKickZone: false,
    showQRCodeModal: false,
    showAvatarAuth: false,
    pendingJoinRoomId: '',
    navFreeze: false,
    primaryBtnText: '开始游戏',
    primaryBtnDisabled: false,
    primaryBtnAction: 'selectMode',
    showExitText: false,
    exitTextLabel: '退出房间',
    exitTextAction: 'leave',
    showWaitingHint: false,
    waitingHintText: '等待房主选择模式',
    showModeActionSheet: false,
    showExitModeConfirm: false
  },

  _computeFooterActions(patch = {}) {
    const isHost = patch.isHost != null ? patch.isHost : this.data.isHost;
    const hasSelectedMode = patch.hasSelectedMode != null
      ? patch.hasSelectedMode
      : this.data.hasSelectedMode;
    const brainstormSessionEnded = patch.brainstormSessionEnded != null
      ? patch.brainstormSessionEnded
      : this.data.brainstormSessionEnded;
    const memberCount = patch.memberCount != null ? patch.memberCount : this.data.memberCount;

    let primaryBtnText = '选择模式';
    let primaryBtnDisabled = false;
    let primaryBtnAction = 'selectMode';
    // 底部次级文案：房主恒为「解散房间」，成员恒为「退出房间」
    let showExitText = true;
    let exitTextLabel = isHost ? '解散房间' : '退出房间';
    let exitTextAction = isHost ? 'dissolve' : 'leave';

    let showWaitingHint = false;
    const waitingHintText = '等待房主选择模式';

    if (hasSelectedMode && !brainstormSessionEnded) {
      primaryBtnText = '继续游戏';
      primaryBtnAction = 'continue';
      primaryBtnDisabled = false;
    } else if (brainstormSessionEnded && hasSelectedMode) {
      // 上一局结束且模式仍在：同模式再开一局
      primaryBtnText = '再来一轮';
      primaryBtnAction = 'anotherRound';
      primaryBtnDisabled = false;
    } else if (isHost) {
      // 未选模式 / 回大厅已清模式：应进选模式页，不能走 anotherRound
      primaryBtnText = memberCount < 2 ? '等待成员加入' : '选择模式';
      primaryBtnDisabled = memberCount < 2;
      primaryBtnAction = 'selectMode';
    } else {
      primaryBtnText = '';
      primaryBtnDisabled = true;
      primaryBtnAction = '';
      showWaitingHint = true;
    }

    return {
      primaryBtnText,
      primaryBtnDisabled,
      primaryBtnAction,
      showExitText,
      exitTextLabel,
      exitTextAction,
      showWaitingHint,
      waitingHintText
    };
  },

  _syncLobbyRoomState(result) {
    // V3 路由来自 View；进入大厅不再通过通用写接口改房间状态。
  },

  _formatRoomId(roomId) {
    if (!roomId || typeof roomId !== 'string') return '';
    const digits = roomId.replace(/\D/g, '');
    if (digits.length <= 4) return digits;
    const padded = digits.padStart(8, '0').slice(-8);
    return `${padded.slice(0, 4)}-${padded.slice(4)}`;
  },

  onLoad(options) {
    this._pageAlive = true;
    let roomId = (options && options.roomId) || '';
    const scene = options && options.scene;
    const fromScanQuery = options && (options.fromScan === '1' || options.fromScan === 'true');
    const stayLobby = options
      && (options.stayLobby === '1' || options.stayLobby === 'true');
    // 主动回大厅（如卧底页点房间入口）：本页停留期间不跟随 currentPage 拉回游戏
    this._stayOnLobby = stayLobby === true;

    if (scene) {
      try {
        const decoded = decodeURIComponent(scene);
        const match = decoded.match(/rid=([^&]+)/);
        if (match && match[1]) roomId = match[1].trim();
      } catch (e) {
        console.error('scene decode error', e);
      }
    }

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.reLaunch({ url: '/pages/main-pages/modeIndex/index?modeId=halliGalli' }), 1500);
      return;
    }

    if (this._stayOnLobby) {
      setSpyLobbyStay(roomId);
    } else {
      // 扫码加入等正常进大厅：允许跟随进入进行中的游戏
      clearSpyLobbyStay();
    }

    const fromScan = !!scene || fromScanQuery;

    // 扫码入房：join 成功前不写 joinedRoomId，避免首页/轮询误判 NOT_IN_ROOM
    this._joinInFlight = fromScan === true;
    if (fromScan) beginScanJoin(roomId);
    if (!fromScan) {
      getApp().globalData.roomId = roomId;
      try {
        wx.setStorageSync('joinedRoomId', roomId);
      } catch (e) {
        console.warn('setStorage joinedRoomId failed', e);
      }
    } else {
      // 仅内存暂存，便于失败提示；持久化延后到 join 成功
      getApp().globalData.roomId = roomId;
    }

    this.setData({
      roomId,
      formattedRoomId: this._formatRoomId(roomId),
      isFromScan: fromScan,
      isHost: false,
      membershipConfirmed: false,
      ...getDevRoomIdDisplayPatch(roomId)
    });

    if (fromScan) {
      this._beginScanJoinWithAvatarPrompt(roomId);
    } else {
      this.loadRoomData(roomId).then((result) => {
        if (!this._pageAlive || !result) return;
        this._joinInFlight = false;
        this.setData({ membershipConfirmed: true });
        if (result.isHost === true) {
          this._syncLobbyRoomState(result);
        } else {
          // 房间已推进到游戏页时尽快跟随，避免成员卡在大厅需手动点「继续游戏」
          this._followRoomPageFromResult(result, roomId);
        }
        this._startMemberPolling();
        this._preloadBrainstormMode();
      });
    }
  },

  _preloadBrainstormMode() {
    if (typeof wx.preloadPage !== 'function') return;
    try {
      wx.preloadPage({ url: '/pages/main-pages/brainstormMode/index' });
    } catch (e) {
      // preload 非关键路径，忽略
    }
  },

  onShow() {
    if (!this._pageAlive || this._navigatingToBrainstorm) return;
    this.setData({ navFreeze: false });
    // 扫码 join 未完成前禁止轮询，否则会把 NOT_IN_ROOM 误判成退出房间
    if (this.data.roomId && !this._joinInFlight) {
      this._startMemberPolling();
    }
  },

  onHide() {
    // 进入子页（如选择脑暴模式）时必须停掉轮询，否则后台 setData 易导致目标页白屏
    this._stopMemberPolling();
    wx.hideLoading();
  },

  onUnload() {
    this._pageAlive = false;
    if (this._joinInFlight) {
      endScanJoin(this.data.roomId);
    }
    this._stopMemberPolling();
    this._clearLongPressTimer();
    this._clearDragWatchdog();
    this._clearDragEnterAnimTimer();
  },

  _applyRoomMeta(result, dedupedMembers) {
    const memberCount = result.memberCount != null
      ? result.memberCount
      : (dedupedMembers || []).length;
    const meta = {
      memberCount,
      hasSelectedMode: result.hasSelectedMode === true,
      brainstormSessionEnded: !!(result.roomState && result.roomState.brainstormSessionEnded),
      selectedModeId: result.selectedModeId || '',
      selectedModeTitle: normalizeModeDisplayTitle(
        result.selectedModeTitle || '',
        result.selectedModeId
      ),
      selectedModeDesc: result.selectedModeDesc || '',
      workshopName: result.workshopName || this.data.workshopName
    };
    return {
      ...meta,
      ...this._computeFooterActions({
        ...meta,
        isHost: result.isHost != null ? result.isHost === true : this.data.isHost
      })
    };
  },

  _triggerCountBounceIfNeeded(newCount) {
    if (newCount > this.data.memberCount) {
      this.setData({ memberCountBounce: true });
      clearTimeout(this._countBounceTimer);
      this._countBounceTimer = setTimeout(() => {
        this.setData({ memberCountBounce: false });
      }, 600);
    }
  },

  _handleMembershipLost(reason = 'left') {
    // join 闸门期间忽略误踢
    if (this._joinInFlight) {
      console.warn('[addPlayer] ignore membership lost during join', reason);
      return;
    }
    disposeRoomSession();
    if (reason === 'dissolved') {
      handleRoomGoneFromResult(
        { ok: false, errCode: 'ROOM_DISSOLVED', roomDissolved: true, event: 'room_dissolved' },
        this.data.roomId
      );
      return;
    }
    exitRoomGone(
      { ok: false, errCode: 'NOT_IN_ROOM', errMsg: '您已不在该房间' },
      { roomId: this.data.roomId }
    );
  },

  _followRoomPageFromResult(result, roomId) {
    const page = (result && result.roomState && result.roomState.currentPage || 'addPlayer').toLowerCase();
    // 主动停留大厅时：只处理被踢/解散，不跟随游戏页
    if (this._stayOnLobby || isSpyLobbyStayActive(roomId)) {
      this._stayOnLobby = true;
      if (shouldSubScreenLeaveRoom(result)) {
        clearSpyLobbyStay();
        followSubScreenRoomPoll(result, roomId);
        return;
      }
      // 房主正在确认游戏模式：非房主仍统一进空状态等待页
      if (page === 'brainstormmode') {
        followSubScreenRoomPoll(result, roomId);
      }
      return;
    }
    if (!result || result.ok !== true || !result.roomState) {
      followSubScreenRoomPoll(result, roomId);
      return;
    }
    if (result.roomState.brainstormSessionEnded === true) {
      const stalePages = ['closingstatement', 'gamepage'];
      if (stalePages.includes(page)) return;
    }
    // 房主在脑暴模式页：优先进等待空状态，避免被卧底跟随抢走
    if (page === 'brainstormmode') {
      followSubScreenRoomPoll(result, roomId);
      return;
    }
    // 谁是卧底：走专用跟随，避免 reLaunch 白屏 / 进错共用页
    const modeId = result.selectedModeId
      || (result.roomState && result.roomState.selectedModeId)
      || '';
    if (modeId === 'spy' || page.indexOf('spy') === 0) {
      const { followSpyRoomState } = require('../../../utils/spyFollow');
      followSpyRoomState(result, roomId);
      return;
    }
    followSubScreenRoomPoll(result, roomId);
  },

  _startMemberPolling() {
    if (this._joinInFlight) return;
    this._stopMemberPolling();
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || getApp().globalData.roomId,
      intervalMs: this.data.isHost ? 4000 : 2500,
      // join 成功后不要回放 join 前的 NOT_IN_ROOM 脏快照
      emitCurrent: this.data.membershipConfirmed === true,
      onSnapshot(snapshot) {
        if (!this._pageAlive || this._navigatingToBrainstorm || this._joinInFlight) return;
        const roomId = this.data.roomId || getApp().globalData.roomId;
        if (!roomId || !snapshot) return;
        const raw = snapshot.raw || snapshot;
        this.loadRoomData(roomId, { silent: true, cachedResult: raw }).then((result) => {
          if (!this._pageAlive || this._navigatingToBrainstorm || this._joinInFlight) return;
          if (!this.data.isHost && result) {
            this._followRoomPageFromResult(result, roomId);
          }
        });
      }
    }).catch((e) => console.warn('addPlayer roomSession', e));
  },

  _stopMemberPolling() {
    unbindPageFromRoomSession(this);
    if (this._memberPollTimer) {
      clearInterval(this._memberPollTimer);
      this._memberPollTimer = null;
    }
  },

  /** 为成员列表补充 avatarImage（微信头像优先，否则随机头像） */
  _assignAvatarImages(members) {
    return assignAvatarImages(members);
  },

  /** 本人优先使用本地已选微信头像（wxfile 临时路径），避免等待云同步 */
  _applyLocalAvatarForMe(members) {
    const stored = getStoredProfile();
    const localUrl = stored && stored.avatarUrl;
    if (!localUrl || isCloudFileId(localUrl)) return members;
    return (members || []).map((m) => {
      if (m && m.isMe) {
        return { ...m, avatarUrl: localUrl };
      }
      return m;
    });
  },

  async _prepareMembersForDisplay(rawMembers) {
    const deduped = this._dedupeMembersById(rawMembers);
    const withLocalMe = this._applyLocalAvatarForMe(deduped);
    const { prepareMembersForDisplay } = require('../../../utils/avatars');
    return prepareMembersForDisplay(withLocalMe);
  },

  _hasAuthorizedWechatAvatar() {
    const stored = getStoredProfile();
    return !!(stored && stored.avatarUrl);
  },

  _hasScanAvatarPrompted() {
    try {
      return wx.getStorageSync('scanAvatarAuthPrompted') === true;
    } catch (e) {
      return false;
    }
  },

  _markScanAvatarPrompted() {
    try {
      wx.setStorageSync('scanAvatarAuthPrompted', true);
    } catch (e) {
      // ignore
    }
  },

  _beginScanJoinWithAvatarPrompt(roomId) {
    this._joinInFlight = true;
    if (this._hasAuthorizedWechatAvatar() || this._hasScanAvatarPrompted()) {
      this.joinRoomThenLoad(roomId);
      return;
    }
    this._markScanAvatarPrompted();
    beginUserAuthFlow();
    this.setData({
      showAvatarAuth: true,
      pendingJoinRoomId: roomId
    });
  },

  onChooseAvatarAuth(e) {
    return runPageInteraction(this, () => this._chooseAvatarAndJoin(e), {
      loadingText: '正在加入房间…'
    });
  },

  async _chooseAvatarAndJoin(e) {
    clearTimeout(this._authReleaseTimer);
    const roomId = this.data.pendingJoinRoomId || this.data.roomId;
    try {
      applyChooseAvatarEvent(e && e.detail);
    } catch (err) {
      console.warn('onChooseAvatarAuth', err);
    }
    this.setData({ showAvatarAuth: false, pendingJoinRoomId: '' });
    endUserAuthFlow();
    cancelDeferredExit();
    if (roomId) await this.joinRoomThenLoad(roomId);
  },

  onSkipAvatarAuth() {
    return runPageInteraction(this, () => this._skipAvatarAndJoin(), {
      loadingText: '正在加入房间…'
    });
  },

  async _skipAvatarAndJoin() {
    clearTimeout(this._authReleaseTimer);
    const roomId = this.data.pendingJoinRoomId || this.data.roomId;
    this.setData({ showAvatarAuth: false, pendingJoinRoomId: '' });
    endUserAuthFlow();
    cancelDeferredExit();
    if (roomId) await this.joinRoomThenLoad(roomId);
  },

  async _ensureMyAvatarSynced(roomId, result) {
    if (!roomId || !result) return;
    const me = (result.members || []).find((m) => m.isMe);
    if (me && me.avatarUrl) return;

    const stored = getStoredProfile();
    if (!stored || !stored.avatarUrl) return;

    try {
      const profile = await prepareProfileForRoom(stored);
      if (!profile) return;
      await syncRoomMemberProfile(roomId, profile);
      this.loadRoomData(roomId, { silent: true });
    } catch (e) {
      console.warn('_ensureMyAvatarSynced', e);
    }
  },

  /** 将成员列表扩展为固定 6 槽位，空位填 null，保证拖拽后“空位”正确挤到玩家原位置 */
  _getMemberId(m) {
    if (!m) return null;
    return m.openid || m.userId || (m.playerIndex != null ? String(m.playerIndex) : null);
  },

  _expandMembersToSlots(members) {
    const arr = [...(members || [])];
    while (arr.length < MEMBER_SLOTS) arr.push(null);
    return arr.slice(0, MEMBER_SLOTS);
  },

  /** 按用户去重，避免同一人占多槽导致空位变少（保证 1 人时显示 5 个空位） */
  _dedupeMembersById(members) {
    const seen = new Set();
    return (members || []).filter((m) => {
      if (!m) return true;
      const id = m.userId || m.openid || (m.playerIndex != null ? `p${m.playerIndex}` : null);
      const key = id != null ? id : `i${seen.size}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  async joinRoomThenLoad(roomId) {
    this._joinInFlight = true;
    beginScanJoin(roomId);
    this._stopMemberPolling();
    const profile = await getOptionalProfileForRoom();

    try {
      const joinPayload = buildRoomJoinPayload(profile, { roomId });
      delete joinPayload.roomId;
      const result = await dispatchRoomCommand('JOIN_ROOM', joinPayload, {}, { roomId });
      if (result.ok !== true) {
        this._joinInFlight = false;
        endScanJoin(roomId);
        wx.showToast({ title: result.errMsg || '加入失败', icon: 'none' });
        return;
      }
      // join 成功后再持久化，并取消授权期间挂起的误踢
      getApp().globalData.roomId = roomId;
      try {
        wx.setStorageSync('joinedRoomId', roomId);
      } catch (e) {
        console.warn('setStorage joinedRoomId failed', e);
      }
      cancelDeferredExit();

      const loaded = await this._loadRoomDataAfterJoin(roomId);
      if (!this._pageAlive) return;
      if (!loaded) {
        this._joinInFlight = false;
        endScanJoin(roomId);
        wx.showToast({ title: '加入失败，请重试', icon: 'none' });
        return;
      }
      this._joinInFlight = false;
      this.setData({ membershipConfirmed: true });
      endScanJoin(roomId);
      if (loaded.isHost === true) {
        this._syncLobbyRoomState(loaded);
      } else {
        // 房间已推进到游戏页时尽快跟随，避免成员卡在大厅需手动点「继续游戏」
        this._followRoomPageFromResult(loaded, roomId);
      }
      this._startMemberPolling();
      this._ensureMyAvatarSynced(roomId, loaded);
      this._preloadBrainstormMode();
    } catch (err) {
      this._joinInFlight = false;
      endScanJoin(roomId);
      wx.showToast({ title: err.errMsg || '加入失败', icon: 'none' });
    }
  },

  async _loadRoomDataAfterJoin(roomId) {
    // 成员刚写入时云库偶发读不到，重试避免误报「您已不在该房间」
    for (let i = 0; i < 4; i += 1) {
      const loaded = await this.loadRoomData(roomId, { silent: true });
      if (loaded && loaded.ok !== false) return loaded;
      if (!this._pageAlive) return null;
      await new Promise((resolve) => setTimeout(resolve, 220 + i * 180));
    }
    return this.loadRoomData(roomId, { silent: true });
  },

  async loadRoomData(roomId, opts = {}) {
    const silent = opts && opts.silent === true;
    const forceRegenQr = opts && opts.forceRegenQr === true;
    if (!silent) {
      this.setData({ qrcodeStatus: 'loading', qrcodeErrorHint: '' });
      wx.showLoading({ title: '加载中…' });
    }

    try {
      let result = opts.cachedResult || null;
      if (!result) {
        result = await getRoomPageSnapshot(roomId, { refresh: true });
      }
      if (!silent) wx.hideLoading();

      if (result.ok !== true) {
        // join 完成前忽略 NOT_IN_ROOM / 解散误判
        if (this._joinInFlight) {
          if (!silent) {
            this.setData({
              qrcodeStatus: 'loading',
              qrcodeErrorHint: ''
            });
          }
          return null;
        }
        // 主机退出/解散/踢出：不依赖 membershipConfirmed（偶发场景下该值未及时更新）
        if (result.errCode === 'ROOM_DISSOLVED' || result.roomDissolved === true) {
          this._handleMembershipLost('dissolved');
          return null;
        }
        if (['NOT_IN_ROOM', 'NOT_MEMBER'].includes(result.errCode)) {
          this._handleMembershipLost('left');
          return null;
        }
        if (!silent) {
          this.setData({
            qrcodeStatus: 'load_error',
            qrcodeErrorHint: result.errMsg || '请重新部署 roomQuery 与 roomMedia 后重试'
          });
          wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        }
        return null;
      }

      const rawMembers = result.members || [];
      const deduped = this._dedupeMembersById(rawMembers);
      const isStillMember = deduped.some((m) => m.isMe);
      if (!result.isHost && !isStillMember) {
        if (this._joinInFlight || !this.data.membershipConfirmed) {
          return null;
        }
        // 已确认成员后才判定离开；勿标成「房间已解散」
        this._handleMembershipLost('left');
        return null;
      }

      const roomMeta = this._applyRoomMeta(result, deduped);
      const withAvatars = await this._prepareMembersForDisplay(rawMembers);
      /* 仅创建者为主屏，其余（含扫码/输入加入）均为副屏 */
      const isHost = result.isHost === true;
      const roomState = result.roomState || {
        currentPage: 'addPlayer',
        currentPlayerIndex: 1,
        currentPlayerName: '玩家1'
      };
      const hasSelectedMode = result.hasSelectedMode === true;
      // 恢复流程只使用 V3 View，禁止本地进度覆盖服务端状态。
      const resolvedState = roomState;
      if (silent) {
        // 跳转脑暴模式途中禁止 setData，否则主线程被拖死易触发 navigateTo:fail timeout
        if (
          !this._pageAlive
          || this.data.isDragging
          || this._navigatingToBrainstorm
          || this._reorderInFlight
        ) {
          return result;
        }
        // 座位顺序以服务端 playerIndex 为准，保证房主拖拽后多端同步
        const expanded = this._expandMembersToSlots(withAvatars);

        const memberSlots = this.buildMemberSlots(expanded);
        const fingerprint = [
          roomMeta.memberCount,
          roomMeta.hasSelectedMode ? 1 : 0,
          roomMeta.workshopName || '',
          roomMeta.selectedModeTitle || '',
          resolvedState.currentPage || '',
          expanded.map((m) => (m
            ? `${this._getMemberId(m)}:${m.playerIndex || ''}:${m.nickName || ''}:${getMemberAvatarFingerprint(m)}`
            : '-'
          )).join('|')
        ].join('#');
        if (fingerprint !== this._silentMembersFingerprint) {
          this._silentMembersFingerprint = fingerprint;
          this._triggerCountBounceIfNeeded(roomMeta.memberCount);
          const nowHost = result.isHost === true;
          const patch = {
            members: expanded,
            memberSlots,
            roomState: resolvedState,
            isHost: nowHost,
            membershipConfirmed: true,
            ...roomMeta
          };
          // 编辑房间名时不覆盖本地输入，避免轮询打断
          if (this.data.isEditingRoomName) {
            delete patch.workshopName;
          }
          this.setData(patch);
        }
        return result;
      }

      const members = this._expandMembersToSlots(withAvatars);
      const memberSlots = this.buildMemberSlots(members);

      let qrcodeFileID = forceRegenQr ? null : result.qrcodeFileID;
      let qrResolved = {
        qrcodeUrl: (!forceRegenQr && result.qrcodeUrl) || '',
        qrcodeStatus: (!forceRegenQr && result.qrcodeUrl) ? 'success' : 'no_qr',
        qrcodeErrorHint: ''
      };

      if (!qrResolved.qrcodeUrl) {
        if (!qrcodeFileID) {
          const regen = await this._regenerateRoomQrcode(roomId, forceRegenQr);
          qrcodeFileID = regen.qrcodeFileID;
          if (regen.qrcodeUrl) {
            qrResolved = {
              qrcodeUrl: regen.qrcodeUrl,
              qrcodeStatus: 'success',
              qrcodeErrorHint: ''
            };
          } else if (regen.errMsg) {
            qrResolved = {
              qrcodeUrl: '',
              qrcodeStatus: 'error',
              qrcodeErrorHint: regen.errMsg
            };
          }
        }

        if (!qrResolved.qrcodeUrl && qrcodeFileID) {
          qrResolved = await this._resolveQrcodeUrl(roomId, qrcodeFileID);
        }

        // 已有 fileID 但临时链接失效时，强制补生成一次
        if (qrResolved.qrcodeStatus === 'error' && !forceRegenQr) {
          const regen = await this._regenerateRoomQrcode(roomId, true);
          if (regen.qrcodeUrl) {
            qrResolved = {
              qrcodeUrl: regen.qrcodeUrl,
              qrcodeStatus: 'success',
              qrcodeErrorHint: ''
            };
          } else if (regen.qrcodeFileID) {
            qrResolved = await this._resolveQrcodeUrl(roomId, regen.qrcodeFileID);
          } else if (regen.errMsg) {
            qrResolved.qrcodeErrorHint = regen.errMsg;
          }
        }
      }

      this._triggerCountBounceIfNeeded(roomMeta.memberCount);
      this.setData({
        qrcodeUrl: qrResolved.qrcodeUrl,
        qrcodeStatus: qrResolved.qrcodeStatus,
        qrcodeErrorHint: qrResolved.qrcodeErrorHint || '',
        members,
        memberSlots,
        isHost,
        membershipConfirmed: true,
        roomState: resolvedState,
        ...roomMeta
      });
      this._ensureMyAvatarSynced(roomId, result);
      return {
        ...result,
        roomState: resolvedState,
        hasSelectedMode
      };
    } catch (err) {
      if (!silent) {
        wx.hideLoading();
        const errMsg = (err && (err.errMsg || err.message)) || '加载失败';
        const hint = /SyntaxError|functions execute fail|-504002/i.test(String(errMsg))
          ? '云函数执行失败，请重新上传部署 roomQuery'
          : errMsg;
        this.setData({
          qrcodeStatus: 'load_error',
          qrcodeErrorHint: hint
        });
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
      return null;
    }
  },

  async _regenerateRoomQrcode(roomId, force = false) {
    try {
      const regenRes = await wx.cloud.callFunction({
        name: 'roomMedia',
        data: { action: 'qrcode', roomId, force: force === true }
      });
      const regenResult = (regenRes && regenRes.result) || {};
      if (regenResult.ok === true && regenResult.qrcodeFileID) {
        return {
          qrcodeFileID: regenResult.qrcodeFileID,
          qrcodeUrl: regenResult.qrcodeUrl || '',
          errMsg: ''
        };
      }
      const errMsg = regenResult.errMsg || '生成二维码失败，请部署 roomMedia';
      console.warn('roomMedia fail', errMsg, regenResult);
      return { qrcodeFileID: null, qrcodeUrl: '', errMsg };
    } catch (e) {
      const errMsg = (e && (e.errMsg || e.message)) || 'roomMedia 调用失败';
      console.warn('roomMedia 调用失败', e);
      return { qrcodeFileID: null, qrcodeUrl: '', errMsg };
    }
  },

  async _resolveQrcodeUrl(roomId, qrcodeFileID) {
    if (!qrcodeFileID) {
      return {
        qrcodeUrl: '',
        qrcodeStatus: 'no_qr',
        qrcodeErrorHint: ''
      };
    }
    try {
      const tempRes = await wx.cloud.getTempFileURL({
        fileList: [qrcodeFileID]
      });
      const first = tempRes && tempRes.fileList && tempRes.fileList[0];
      if (first && first.tempFileURL) {
        return {
          qrcodeUrl: first.tempFileURL,
          qrcodeStatus: 'success',
          qrcodeErrorHint: ''
        };
      }
      const errDetail = (first && (first.errMsg || first.status)) || '临时链接为空';
      console.error('getTempFileURL err', errDetail, roomId);
      return {
        qrcodeUrl: '',
        qrcodeStatus: 'error',
        qrcodeErrorHint: String(errDetail)
      };
    } catch (e) {
      console.error('getTempFileURL exception', e);
      return {
        qrcodeUrl: '',
        qrcodeStatus: 'error',
        qrcodeErrorHint: (e && (e.errMsg || e.message)) || '读取二维码文件失败'
      };
    }
  },

  onPullDownRefresh() {
    if (this.data.isDragging) {
      wx.stopPullDownRefresh();
      return;
    }
    const roomId = this.data.roomId;
    if (roomId) {
      this.loadRoomData(roomId).finally(() => {
        wx.stopPullDownRefresh();
      });
    } else {
      wx.stopPullDownRefresh();
    }
  },

  handleRetryQrcode() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    return runPageInteraction(
      this,
      () => this.loadRoomData(roomId, { forceRegenQr: true, silent: true }),
      { loadingText: '正在刷新二维码…' }
    );
  },

  buildMemberSlots(members) {
    const n = MEMBER_SLOTS;
    const slots = [];
    const half = AVATAR_SIZE / 2;
    const centerX = CENTER_XY;
    const centerY = CENTER_XY;

    for (let i = 0; i < n; i++) {
      const angle = START_ANGLE + (i * 2 * Math.PI) / n;
      const member = members[i] || null;
      const left = Math.round(centerX + CIRCLE_R * Math.cos(angle) - half);
      const top = Math.round(centerY + CIRCLE_R * Math.sin(angle) - half);
      const slotCenterX = left + half;
      const slotCenterY = top + half;
      const dx = slotCenterX - centerX;
      const dy = slotCenterY - centerY;
      const lineLength = Math.round(Math.sqrt(dx * dx + dy * dy));
      const lineAngleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);

      slots.push({
        index: i,
        left,
        top,
        member,
        lineLength: member ? lineLength : 0,
        lineAngleDeg: member ? lineAngleDeg : 0
      });
    }
    return slots;
  },

  onSlotTap() {},

  _showKickConfirm(member) {
    if (this.data.isHost !== true || this.data.isDragging === true) return;
    if (!member || member.isMe === true) return;
    this._clearLongPressTimer();
    this._slotTouchStart = null;
    this._lastTouch = null;

    wx.showModal({
      title: '踢出成员',
      content: `确定将「${member.nickName}」移出房间吗？`,
      confirmText: '踢出',
      confirmColor: '#dc2626',
      success: (res) => {
        if (res.confirm) {
          runPageInteraction(this, () => this._kickMember(member), {
            loadingText: '正在移出成员…'
          });
        }
      }
    });
  },

  async _kickMember(member) {
    const roomId = this.data.roomId || getApp().globalData.roomId;
    if (this.data.isHost !== true) {
      wx.showToast({ title: '仅房主可踢出成员', icon: 'none' });
      return;
    }
    if (!roomId || !member || !member.userId || member.isMe === true) return;

    try {
      const result = await dispatchRoomCommand('KICK_MEMBER', { memberId: member.memberId || member.userId });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '踢出失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已踢出', icon: 'success' });
      this.loadRoomData(roomId, { silent: true });
    } catch (err) {
      wx.showToast({ title: err.errMsg || '踢出失败', icon: 'none' });
    }
  },

  onSlotTouchStart(e) {
    if (!this.data.isHost) return;
    const index = e.currentTarget.dataset.index;
    const slot = (this.data.memberSlots || [])[index];
    if (!slot || !slot.member) return;

    const touch = e.touches && e.touches[0];
    if (!touch) return;

    // 记录下「按下时」的坐标，用于后续没有 move 事件时也能推算初始拖拽位置
    this._slotTouchStart = { clientX: touch.clientX, clientY: touch.clientY };
    // 以当前按下手指为准，避免复用历史触点导致进入拖拽时头像瞬移
    this._lastTouch = { clientX: touch.clientX, clientY: touch.clientY };
    this._longPressSlotIndex = index;
    this._longPressSlot = slot;
    // 预加载圆圈区域的 DOM 尺寸，后续把 rpx 坐标换算为 px 时会用到
    this._preloadCircleRect();
    // 每次新的 touchstart 先清理旧的长按定时器，防止多指或快速点击时重复触发
    this._clearLongPressTimer();
    this._longPressTimer = setTimeout(() => {
      this._longPressTimer = null;
      // 长按任意已占用槽位（自己或他人）且为房主 → 进入拖拽：拖到座位调序，拖到底部踢出区可踢出他人
      if (this.data.isHost && slot.member) {
        this._enterDragMode(index, slot);
      }
    }, LONG_PRESS_ENTER_DRAG_MS);
  },

  _clearLongPressTimer() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  },

  _clearDragWatchdog() {
    if (this._dragWatchdogTimer) {
      clearTimeout(this._dragWatchdogTimer);
      this._dragWatchdogTimer = null;
    }
  },

  _armDragWatchdog() {
    this._clearDragWatchdog();
    this._dragWatchdogTimer = setTimeout(() => {
      if (this.data.isDragging) {
        // 兜底收口：事件链断掉时强制结束，保证头像回到槽位布局
        this._finishDrag();
      }
    }, DRAG_WATCHDOG_MS);
  },

  _clearDragEnterAnimTimer() {
    if (this._dragEnterAnimTimer) {
      clearTimeout(this._dragEnterAnimTimer);
      this._dragEnterAnimTimer = null;
    }
  },

  _trackPendingLongPressMove(x, y) {
    this._lastTouch = { clientX: x, clientY: y };
    if (this.data.isDragging) return;
    // 未进入拖拽时，只要位移超过阈值就取消长按，避免“滑动过程中误入拖拽”
    const start = this._slotTouchStart;
    if (!start) return;
    if (
      Math.abs(x - start.clientX) > DRAG_CANCEL_THRESHOLD_PX ||
      Math.abs(y - start.clientY) > DRAG_CANCEL_THRESHOLD_PX
    ) {
      this._clearLongPressTimer();
    }
  },

  /**
   * 进入拖拽模式：
   * - 根据最新的触点位置计算浮动头像的起始坐标（手指位置 = 头像位置）
   * - 初始化被拖拽成员、起始槽位、当前目标槽位等状态
   * - 存储「去除被拖成员后」的成员快照 _dragBaseMembers，后续重排以此为基准而非实时 data
   * - 后续由 _updateDragPosition 根据手指移动实时更新位置与重排结果
   */
  _enterDragMode(index, slot) {
    if (this.data.isHost !== true || !slot || !slot.member) return;
    // 优先使用最新触点，保证长按到可拖拽的衔接连续；没有 move 时回退到按下坐标
    const touch = this._lastTouch || this._slotTouchStart;
    let initX = null, initY = null;
    if (touch) {
      initX = touch.clientX != null ? touch.clientX : touch.pageX;
      initY = touch.clientY != null ? touch.clientY : touch.pageY;
    }

    // 取当前布局的快照，移除被拖拽成员后固定下来
    // 后续每帧重排都基于这份快照 + 目标槽位做插入，而不是对上一帧结果再 splice
    // 这样无论手指怎么移动，结果都是幂等的，不会出现位置漂移
    const baseArr = this._expandMembersToSlots(this.data.members || []);
    const dragId = this._getMemberId(slot.member);
    const baseFromIdx = baseArr.findIndex(
      (m) => m && (this._getMemberId(m) === dragId || m === slot.member)
    );
    if (baseFromIdx >= 0) baseArr.splice(baseFromIdx, 1);
    this._dragBaseMembers = baseArr; // 5 个元素（被拖成员已移除）

    // 若 circleRect 已缓存则直接用，避免重置缓存导致拖拽开始阶段频繁查询 DOM
    const doEnter = (rect) => {
      if (!rect) {
        // 未拿到 circleWrap 的几何信息时不进入拖拽，避免出现半拖拽态
        return;
      }
      if (initX == null && rect) {
        // 当没有手指坐标（例如仅有长按而无 move）时，用头像中心点作为初始拖拽位置
        const half = AVATAR_SIZE / 2;
        const rpxToPx = rect.width / 600;
        initX = rect.left + (slot.left + half) * rpxToPx;
        initY = rect.top + (slot.top + half) * rpxToPx;
      }
      this.setData({
        isDragging: true,
        draggingSlotIndex: index,
        draggingMember: slot.member,
        draggingMemberId: this._getMemberId(slot.member),
        dragPosX: initX,
        dragPosY: initY,
        dragFromIndex: index,
        dropTargetIndex: index,
        dragEnterAnimating: true
      });
      // 进入拖拽后立刻用当前坐标对齐首帧，避免“已进入但位置不同步”
      if (initX != null && initY != null) {
        this._updateDragPosition(initX, initY);
      }
      this._clearDragEnterAnimTimer();
      this._dragEnterAnimTimer = setTimeout(() => {
        this._dragEnterAnimTimer = null;
        if (this.data.isDragging) {
          this.setData({ dragEnterAnimating: false });
        }
      }, 180);
      this._armDragWatchdog();
      // 踢出区在进入拖拽后才渲染，需等下一帧再查询其几何信息
      wx.nextTick(() => this._preloadKickZoneRect());
    };

    if (this._circleRect) {
      doEnter(this._circleRect);
    } else {
      // 没有缓存时才发起 DOM 查询（_preloadCircleRect 不再清空已有缓存）
      this._preloadCircleRect(doEnter);
    }
  },

  _preloadCircleRect(cb) {
    // 已有缓存时直接复用，避免重复清空导致拖拽开始阶段频繁发起异步 DOM 查询
    if (this._circleRect) {
      if (typeof cb === 'function') cb(this._circleRect);
      return;
    }
    const q = wx.createSelectorQuery().in(this);
    q.select('#circleWrap').boundingClientRect();
    q.exec((res) => {
      this._circleRect = res && res[0];
      if (typeof cb === 'function') cb(this._circleRect);
    });
  },

  _preloadKickZoneRect() {
    const q = wx.createSelectorQuery().in(this);
    q.select('#kickZone').boundingClientRect();
    q.exec((res) => {
      this._kickZoneRect = res && res[0];
    });
  },

  _isPointInRect(x, y, rect) {
    if (!rect || x == null || y == null) return false;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  },

  onSlotTouchMove(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return false;
    const x = touch.clientX != null ? touch.clientX : touch.pageX;
    const y = touch.clientY != null ? touch.clientY : touch.pageY;
    this._trackPendingLongPressMove(x, y);

    if (!this.data.isDragging) {
      return false;
    }
    this._updateDragPosition(x, y);
    return false;
  },

  onWrapTouchMove(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return false;
    const x = touch.clientX != null ? touch.clientX : touch.pageX;
    const y = touch.clientY != null ? touch.clientY : touch.pageY;
    this._trackPendingLongPressMove(x, y);
    if (!this.data.isDragging) return false;
    this._updateDragPosition(x, y);
    return false;
  },

  onDragMaskTouchMove(e) {
    if (!this.data.isDragging) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const x = touch.clientX != null ? touch.clientX : touch.pageX;
    const y = touch.clientY != null ? touch.clientY : touch.pageY;
    this._lastTouch = touch;
    this._updateDragPosition(x, y);
  },

  onDragMaskTouchEnd(e) {
    if (this.data.isDragging) {
      this._finishDrag(e);
    } else {
      this._clearLongPressTimer();
      this._slotTouchStart = null;
      this._lastTouch = null;
    }
  },

  onContentTouchMove(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const x = touch.clientX != null ? touch.clientX : touch.pageX;
    const y = touch.clientY != null ? touch.clientY : touch.pageY;
    this._trackPendingLongPressMove(x, y);
    if (!this.data.isDragging) return;
    this._updateDragPosition(x, y);
  },

  onContentTouchEnd(e) {
    if (this.data.isDragging) {
      this._finishDrag(e);
    } else {
      this._clearLongPressTimer();
      this._slotTouchStart = null;
      this._lastTouch = null;
    }
  },

  _updateDragPosition(clientX, clientY) {
    if (this.data.draggingSlotIndex == null) return;
    this._armDragWatchdog();

    const overKickZone = this._isPointInRect(clientX, clientY, this._kickZoneRect);
    const draggingSelf = !!(this.data.draggingMember && this.data.draggingMember.isMe);
    const nextOverKick = draggingSelf ? false : overKickZone;
    if (nextOverKick !== this.data.overKickZone) {
      this.setData({ overKickZone: nextOverKick });
    }

    // 位置节流：变化不足 1px 时跳过，减少无意义的跨线程通信
    if (
      Math.abs(clientX - this.data.dragPosX) < 1 &&
      Math.abs(clientY - this.data.dragPosY) < 1
    ) return;

    const applyUpdate = () => {
      // 拖拽中只更新浮层坐标与落点高亮；原槽位布局在松手时一次性提交
      const patch = { dragPosX: clientX, dragPosY: clientY };
      if (!overKickZone && this._circleRect) {
        const idx = this._getSlotIndexByPoint(clientX, clientY, this._circleRect);
        if (idx != null && idx !== this.data.dropTargetIndex) {
          patch.dropTargetIndex = idx;
        }
      }
      this.setData(patch);
    };

    if (this._circleRect) {
      applyUpdate();
    } else {
      // 首次查询时先立即更新位置
      this.setData({ dragPosX: clientX, dragPosY: clientY });
      const q = wx.createSelectorQuery().in(this);
      q.select('#circleWrap').boundingClientRect();
      q.exec((res) => {
        const rect = res && res[0];
        if (rect) this._circleRect = rect;
        if (this.data.isDragging) applyUpdate();
      });
    }
  },

  _getSlotIndexByPoint(clientX, clientY, rect) {
    if (!rect || clientX == null || clientY == null) return null;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 10) return null;
    const theta = Math.atan2(dx, -dy);
    const thetaNorm = (theta + Math.PI * 2) % (Math.PI * 2);
    return Math.floor((thetaNorm + Math.PI / 6) / (Math.PI / 3)) % MEMBER_SLOTS;
  },

  onSlotTouchEnd(e) {
    if (this.data.isDragging) {
      this._finishDrag(e);
    } else {
      this._clearLongPressTimer();
      this._slotTouchStart = null;
      this._lastTouch = null;
    }
  },

  onWrapTouchEnd(e) {
    if (this.data.isDragging) {
      this._finishDrag(e);
    } else {
      this._clearLongPressTimer();
      this._slotTouchStart = null;
      this._lastTouch = null;
    }
  },

  _finishDrag(e) {
    if (!this.data.isDragging || this.data.draggingSlotIndex == null) {
      this._clearLongPressTimer();
      this._clearDragWatchdog();
      return;
    }
    this._lastDragEndTime = Date.now();
    const dragFromIndex = this.data.dragFromIndex;
    let dropTargetIndex = this.data.dropTargetIndex;
    const lastTouch = this._lastTouch;
    const draggingMember = this.data.draggingMember;
    const droppedOnKickZone = !(draggingMember && draggingMember.isMe) && this._isPointInRect(
      lastTouch && (lastTouch.clientX != null ? lastTouch.clientX : lastTouch.pageX),
      lastTouch && (lastTouch.clientY != null ? lastTouch.clientY : lastTouch.pageY),
      this._kickZoneRect
    );
    if (lastTouch && this._circleRect) {
      const x = lastTouch.clientX != null ? lastTouch.clientX : lastTouch.pageX;
      const y = lastTouch.clientY != null ? lastTouch.clientY : lastTouch.pageY;
      const idx = this._getSlotIndexByPoint(x, y, this._circleRect);
      if (idx != null) dropTargetIndex = idx;
    }
    const updates = {
      isDragging: false,
      draggingSlotIndex: null,
      dragPosX: null,
      dragPosY: null,
      draggingMember: null,
      draggingMemberId: null,
      dragFromIndex: null,
      dropTargetIndex: null,
      dragEnterAnimating: false,
      overKickZone: false
    };

    // 拖到底部踢出区：非自己 → 弹出踢出确认；自己 → 视为取消操作，不做任何变更
    if (droppedOnKickZone) {
      this.setData(updates);
      this._circleRect = null;
      this._kickZoneRect = null;
      this._lastTouch = null;
      this._slotTouchStart = null;
      this._dragBaseMembers = null;
      this._clearDragWatchdog();
      this._clearDragEnterAnimTimer();
      if (draggingMember && !draggingMember.isMe) {
        this._showKickConfirm(draggingMember);
      }
      return;
    }

    // 仅在松手时一次性提交重排，避免拖动中 slots 反复变化导致“卡住”
    let packed = null;
    if (dragFromIndex != null && dropTargetIndex != null && dragFromIndex !== dropTargetIndex) {
      const base = this._dragBaseMembers;
      if (base && draggingMember) {
        const arr = base.slice();
        arr.splice(dropTargetIndex, 0, draggingMember);
        packed = arr.filter(Boolean);
        const reordered = this._expandMembersToSlots(packed);
        updates.members = reordered;
        updates.memberSlots = this.buildMemberSlots(reordered);
      }
    }

    this.setData(updates);
    this._circleRect = null;
    this._kickZoneRect = null;
    this._lastTouch = null;
    this._slotTouchStart = null;
    this._dragBaseMembers = null; // 释放快照，避免内存残留
    this._clearDragWatchdog();
    this._clearDragEnterAnimTimer();
    if (packed && packed.length) {
      runPageInteraction(this, () => this._syncSeatOrder(packed), {
        loadingText: '正在同步座位顺序…'
      });
    }
  },

  _resetDragState(restoreLayout = false) {
    const updates = {
      isDragging: false,
      draggingSlotIndex: null,
      dragPosX: null,
      dragPosY: null,
      draggingMember: null,
      draggingMemberId: null,
      dragFromIndex: null,
      dropTargetIndex: null,
      dragEnterAnimating: false,
      overKickZone: false
    };
    if (restoreLayout) {
      updates.memberSlots = this.buildMemberSlots(this.data.members || []);
    }
    this.setData(updates);
    this._circleRect = null;
    this._kickZoneRect = null;
    this._lastTouch = null;
    this._slotTouchStart = null;
    this._dragBaseMembers = null; // 释放快照，避免内存残留
    this._clearDragWatchdog();
    this._clearDragEnterAnimTimer();
  },

  _dispatchRoomCommand(type, payload) {
    const roomId = this.data.roomId || '';
    if (!roomId || !type) return Promise.resolve({ ok: false, errMsg: '缺少房间或命令' });
    return dispatchRoomCommand(type, payload || {}).catch((e) => {
      console.warn('addPlayer roomCommand', type, e);
      return { ok: false, errMsg: (e && e.errMsg) || (e && e.message) || '命令失败' };
    });
  },

  async _syncSeatOrder(orderedMembers) {
    if (this.data.isHost !== true) return;
    const roomId = this.data.roomId || '';
    const packed = (orderedMembers || []).filter(Boolean);
    const userIdOrder = packed
      .map((m) => m.memberId || m.userId || m.openid)
      .filter((id) => !!id);
    if (!roomId || userIdOrder.length < 2) return;
    if (userIdOrder.length !== packed.length) {
      wx.showToast({ title: '顺序同步失败', icon: 'none' });
      this.loadRoomData(roomId, { silent: true });
      return;
    }

    this._reorderInFlight = true;
    try {
      const result = await this._dispatchRoomCommand('REORDER_SEATS', { userIdOrder });
      if (!result || result.ok !== true) {
        wx.showToast({
          title: (result && result.errMsg) || '顺序同步失败',
          icon: 'none'
        });
        await this.loadRoomData(roomId, { silent: true });
        return;
      }
      wx.showToast({ title: '顺序已同步', icon: 'none', duration: 800 });
    } finally {
      this._reorderInFlight = false;
    }
  },

  startEditRoomName() {
    if (!this.data.isHost || this.data.isSavingRoomName) return;
    this.setData({
      isEditingRoomName: true,
      editingRoomName: this.data.workshopName || '脑暴工作坊'
    });
  },

  onRoomNameInput(e) {
    this.setData({
      editingRoomName: (e.detail && e.detail.value) || ''
    });
  },

  confirmEditRoomName() {
    return runPageInteraction(this, () => this._confirmEditRoomName(), {
      loadingText: '正在保存房间名称…'
    });
  },

  async _confirmEditRoomName() {
    if (!this.data.isHost || this.data.isSavingRoomName) return;

    const roomId = this.data.roomId || getApp().globalData.roomId;
    if (!roomId) {
      wx.showToast({ title: '房间参数错误', icon: 'none' });
      return;
    }

    let name = (this.data.editingRoomName || '').trim();
    if (!name) name = '脑暴工作坊';
    if (name.length > 20) {
      wx.showToast({ title: '房间名称不超过20字', icon: 'none' });
      return;
    }

    if (name === (this.data.workshopName || '')) {
      this.setData({ isEditingRoomName: false });
      return;
    }

    this.setData({ isSavingRoomName: true });
    try {
      const result = await dispatchRoomCommand('UPDATE_ROOM_PROFILE', { workshopName: name });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '保存失败', icon: 'none' });
        this.setData({ isSavingRoomName: false });
        return;
      }
      const savedName = name;
      getApp().globalData.workshopName = savedName;
      this.setData({
        workshopName: savedName,
        isEditingRoomName: false,
        isSavingRoomName: false
      });
      wx.showToast({ title: '已更新', icon: 'success' });
    } catch (err) {
      this.setData({ isSavingRoomName: false });
      wx.showToast({ title: err.errMsg || '保存失败', icon: 'none' });
    }
  },

  handleGoBack() {
    return this.handleExitBrainstorm();
  },

  handleGoBrainstormMode() {
    return runPageInteraction(this, () => this._goBrainstormMode(), {
      loadingText: '正在打开模式…'
    });
  },

  _goBrainstormMode() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '房间参数错误', icon: 'none' });
      return;
    }
    if (this._navigatingToBrainstorm) return;

    this._navigatingToBrainstorm = true;
    this._stopMemberPolling();
    wx.hideLoading();
    // 停掉大厅重动画，给路由让出主线程（模拟器尤其明显）
    this.setData({ navFreeze: true });

    const url = `/pages/main-pages/brainstormMode/index?roomId=${encodeURIComponent(roomId)}&isHost=${this.data.isHost ? '1' : '0'}`;

    return new Promise((resolve) => {
      const onNavOk = () => {
        this._navigatingToBrainstorm = false;
        resolve({ ok: true });
      };
      const onNavFatal = (err, stage) => {
        this._navigatingToBrainstorm = false;
        console.error(`${stage} brainstormMode fail:`, err && err.errMsg, err);
        if (this._pageAlive) {
          this.setData({ navFreeze: false });
          this._startMemberPolling();
        }
        wx.showToast({ title: '打开失败，请重试', icon: 'none' });
        resolve({ ok: false, error: err });
      };

      const openWithReLaunch = () => {
        wx.reLaunch({
          url,
          success: onNavOk,
          fail: (err) => onNavFatal(err, 'reLaunch')
        });
      };

      // 房主优先 redirectTo：卸载大厅页（动画/轮询/大 DOM），比 navigateTo 叠层更稳
      const openPage = () => {
        const preferRedirect = this.data.isHost === true;
        const primary = preferRedirect ? wx.redirectTo : wx.navigateTo;
        const primaryName = preferRedirect ? 'redirectTo' : 'navigateTo';
        primary({
          url,
          success: onNavOk,
          fail: (err) => {
            const msg = (err && err.errMsg) || '';
            console.error(`${primaryName} brainstormMode fail:`, msg, err);
            if (/timeout|busy/i.test(msg)) {
              setTimeout(openWithReLaunch, 400);
              return;
            }
            const secondary = preferRedirect ? wx.navigateTo : wx.redirectTo;
            secondary({
              url,
              success: onNavOk,
              fail: (err2) => {
                const msg2 = (err2 && err2.errMsg) || '';
                console.error('fallback brainstormMode fail:', msg2, err2);
                if (/timeout|busy|limit/i.test(msg2)) {
                  setTimeout(openWithReLaunch, 400);
                } else {
                  onNavFatal(err2, 'fallback');
                }
              }
            });
          }
        });
      };

      const waitAndGo = (attempt = 0) => {
        if (!this._memberPollInFlight || attempt >= 20) {
          setTimeout(openPage, 80);
          return;
        }
        setTimeout(() => waitAndGo(attempt + 1), 50);
      };
      waitAndGo();
    });
  },

  handleAnotherRound() {
    return runPageInteraction(this, () => this._handleAnotherRound(), {
      loadingText: '正在准备新一轮…'
    });
  },

  async _handleAnotherRound() {
    const roomId = this.data.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '房间参数错误', icon: 'none' });
      return;
    }

    try {
      // 以云端身份为准，避免本地 isHost 过期/误判导致房主进副屏
      const check = await getRoomPageSnapshot(roomId, { refresh: true });
      if (check.ok !== true) {
        wx.showToast({ title: check.errMsg || '状态获取失败', icon: 'none' });
        return;
      }
      if (check.isHost !== true) {
        this.setData({ isHost: false });
        wx.showToast({ title: '请等待房主开始新一轮', icon: 'none' });
        return;
      }
      if (check.hasSelectedMode !== true && !this.data.hasSelectedMode) {
        // 模式已被清掉（如只剩一人回大厅）：改为重新选模式，而不是卡住提示
        this.setData({ isHost: true, hasSelectedMode: false, brainstormSessionEnded: true });
        await this._goBrainstormMode();
        return;
      }

      this.setData({ isHost: true });

      const modeId = check.selectedModeId || this.data.selectedModeId || 'partner';
      const app = getApp();
      if (!app.globalData) app.globalData = {};
      app.globalData.gameMode = modeId;
      app.globalData.roomId = roomId;
      if (check.selectedBG) {
        app.globalData.selectedBG = check.selectedBG;
      }
      const problem = (check.roomState && check.roomState.selectedDesignProblem)
        || check.selectedDesignProblem
        || null;
      if (problem) {
        app.globalData.selectedProblem = problem;
      }

      const currentSession = check.view && check.view.session;
      const updateRes = currentSession && currentSession.status === 'COMPLETED'
        ? await dispatchRoomCommand('REPLAY_WORKSHOP_SESSION', {}, { sessionId: currentSession.sessionId })
        : { ok: false, errMsg: '当前场次尚未完成' };
      if (updateRes && updateRes.ok !== true) {
        wx.showToast({ title: updateRes.errMsg || '状态同步失败', icon: 'none' });
        return;
      }

      const refreshed = await getRoomPageSnapshot(roomId, { refresh: true });
      if (!refreshed || refreshed.ok !== true || !refreshed.roomState) {
        wx.showToast({ title: refreshed && refreshed.errMsg || '恢复新场次失败', icon: 'none' });
        return;
      }
      const target = this._resolveContinueBrainstormTarget(
        roomId,
        refreshed.selectedModeId || modeId,
        refreshed.roomState,
        refreshed.selectedBG
      );
      const opened = safeOpenUrl(target.path, { immediate: true });
      if (!opened) {
        wx.redirectTo({
          url: target.path,
          fail: () => {
            wx.reLaunch({ url: target.path });
          }
        });
      }
    } catch (e) {
      console.warn('handleAnotherRound', e);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  /** 根据已选模式与房间进度，解析「继续脑暴」跳转目标 */
  _resolveContinueBrainstormTarget(roomId, selectedModeId, roomState, selectedBG) {
    const roomIdEnc = encodeURIComponent(roomId);
    const modeId = selectedModeId || 'halliGalli';
    const state = roomState || {};
    let page = (state.currentPage || 'addPlayer').toLowerCase();
    const idx = state.currentPlayerIndex != null ? state.currentPlayerIndex : 1;
    const bg = selectedBG || (getApp().globalData && getApp().globalData.selectedBG);

    const modeIndexRoute = {
      path: `/pages/main-pages/modeIndex/index?roomId=${roomIdEnc}&modeId=${encodeURIComponent(modeId)}`,
      nextPage: 'auth'
    };

    const spyModeIndexRoute = {
      path: buildSpyPageUrl('intro', roomId),
      nextPage: 'spymodeindex'
    };

    if (modeId === 'spy') {
      const spyResumeRoutes = {
        spymodeindex: spyModeIndexRoute,
        spyspeak: { path: buildSpyPageUrl('speak', roomId), nextPage: 'spyspeak' },
        spyvote: { path: buildSpyPageUrl('vote', roomId), nextPage: 'spyvote' },
        spyresult: { path: buildSpyPageUrl('result', roomId), nextPage: 'spyresult' },
        spysettle: { path: buildSpyPageUrl('settle', roomId), nextPage: 'spysettle' }
      };
      if (page !== 'addplayer' && spyResumeRoutes[page]) {
        return spyResumeRoutes[page];
      }
      return spyModeIndexRoute;
    }

    if (
      modeId === 'partner'
      && partnerPageNeedsBG(page)
      && !isValidPartnerBG(bg, { requirePlatform: page === 'confirmbg' })
    ) {
      return modeIndexRoute;
    }

    const resumeRoutes = {
      auth: {
        path: `/pages/main-pages/modeIndex/index?roomId=${roomIdEnc}&modeId=${encodeURIComponent(modeId)}`,
        nextPage: 'auth'
      },
      submitproblem: {
        path: `/pages/main-pages/submitProblem/index?roomId=${roomIdEnc}`,
        nextPage: 'submitProblem'
      },
      selectproblem: {
        path: `/pages/main-pages/selectProblem/index?roomId=${roomIdEnc}`,
        nextPage: 'selectProblem'
      },
      selectbg: {
        path: `/pages/main-pages/selectBG/index?mode=${modeId === 'partner' ? 'partner' : 'halliGalli'}&roomId=${roomIdEnc}`,
        nextPage: 'selectBG'
      },
      confirmbg: {
        path: `/pages/main-pages/partnerMode/confirmBG/index?roomId=${roomIdEnc}`,
        nextPage: 'confirmBG'
      },
      selectplayer: {
        path: `/pages/main-pages/selectPlayer/index?roomId=${roomIdEnc}`,
        nextPage: 'selectPlayer'
      },
      confirmfirstplayer: {
        path: `/pages/main-pages/partnerMode/confirmFirstPlayer/index?roomId=${roomIdEnc}`,
        nextPage: 'confirmFirstPlayer'
      },
      gamepage: {
        path: buildGamepageUrl(roomId, idx, modeId, {
          phase: state.partnerGamePhase === 'discussion'
            ? 'discussion'
            : (state.partnerGamePhase === 'closing' ? 'closing' : undefined),
          closingStep: state.partnerClosingStep || undefined
        }),
        nextPage: 'gamepage'
      },
      closingstatement: {
        path: buildClosingStatementUrl(roomId, {
          closingVoteSessionId: state.closingVoteSessionId || '',
          _t: Date.now()
        }),
        nextPage: 'closingStatement'
      },
      specialmove: {
        path: buildGamepageUrl(roomId, idx, modeId, {
          phase: state.partnerGamePhase === 'discussion'
            ? 'discussion'
            : (state.partnerGamePhase === 'closing' ? 'closing' : undefined),
          closingStep: state.partnerClosingStep || undefined
        }),
        nextPage: 'gamepage'
      },
      creativeinput: {
        path: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}`,
        nextPage: 'creativeInput'
      },
      creativesummary: {
        path: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}`,
        nextPage: 'creativeSummary'
      }
    };

    if (page !== 'addplayer' && resumeRoutes[page]) {
      return resumeRoutes[page];
    }

    if (modeId === 'halliGalli') {
      return {
        path: `/pages/main-pages/halliGalli/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`,
        nextPage: 'gamepage'
      };
    }

    return {
      path: `/pages/main-pages/modeIndex/index?roomId=${roomIdEnc}&modeId=${encodeURIComponent(modeId)}`,
      nextPage: 'auth'
    };
  },

  handleContinueBrainstorm() {
    return runPageInteraction(this, () => this._handleContinueBrainstorm(), {
      loadingText: '正在同步进度…'
    });
  },

  async _handleContinueBrainstorm() {
    const roomId = this.data.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '房间参数错误', icon: 'none' });
      return;
    }
    if (!this.data.hasSelectedMode) {
      // 无已选模式时「继续」无意义，引导房主重新选模式
      if (this.data.isHost) {
        await this._goBrainstormMode();
      } else {
        wx.showToast({ title: '请等待房主选择脑暴模式', icon: 'none' });
      }
      return;
    }

    let roomState = this.data.roomState;
    let selectedModeId = this.data.selectedModeId || 'halliGalli';
    let hasSelectedMode = this.data.hasSelectedMode;
    let selectedBG = (getApp().globalData && getApp().globalData.selectedBG) || null;
    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (result.ok === true) {
        hasSelectedMode = result.hasSelectedMode === true;
        if (result.roomState) {
          roomState = result.roomState;
        }
        if (result.selectedModeId) {
          selectedModeId = result.selectedModeId;
        }
        if (result.selectedBG) {
          selectedBG = result.selectedBG;
          getApp().globalData.selectedBG = result.selectedBG;
        }
        this.setData({
          roomState,
          selectedModeId,
          hasSelectedMode,
          selectedModeTitle: normalizeModeDisplayTitle(
            result.selectedModeTitle || this.data.selectedModeTitle,
            selectedModeId
          ),
          selectedModeDesc: result.selectedModeDesc || this.data.selectedModeDesc
        });
      }
    } catch (e) {
      console.warn('handleContinueBrainstorm fetch state', e);
    }

    getApp().globalData.gameMode = selectedModeId;

    if (!this.data.isHost) {
      // 用户主动继续：解除大厅停留锁，允许回到当前游戏页
      this._stayOnLobby = false;
      clearSpyLobbyStay();
      const page = (roomState && roomState.currentPage) || 'addPlayer';
      const modeId = selectedModeId || '';
      if (modeId === 'spy' || String(page).toLowerCase().indexOf('spy') === 0) {
        const { followSpyRoomState } = require('../../../utils/spyFollow');
        followSpyRoomState(
          {
            ok: true,
            isHost: false,
            selectedModeId: modeId,
            roomState: roomState || { currentPage: page }
          },
          roomId,
          { force: true }
        );
        return;
      }
      navigateByRoomState(page, roomState, roomId);
      return;
    }

    const target = this._resolveContinueBrainstormTarget(
      roomId,
      selectedModeId,
      roomState,
      selectedBG
    );

    const resumeInGame = ['gamepage', 'closingStatement'].includes(target.nextPage);
    safeOpenUrl(target.path, resumeInGame
      ? { immediate: true, preferReLaunch: true }
      : { immediate: true });
  },

  /** 左上角出口：回到小程序首页（保留房间，可从历史工作坊再进） */
  handleExitBrainstorm() {
    return runPageNavigation(this, async () => {
      this._stopMemberPolling();
      try {
        const { setSpyLobbyStay, clearSpyFollowLock } = require('../../../utils/spyFollow');
        const { clearPendingNavigation } = require('../../../utils/pageNavigate');
        if (this.data.roomId) setSpyLobbyStay(this.data.roomId);
        clearSpyFollowLock();
        clearPendingNavigation();
      } catch (e) {
        // ignore
      }
      return { method: 'reLaunch', url: '/pages/main-pages/aaa/index' };
    }, { loadingText: '正在返回首页…' });
  },

  onTapModePill() {
    if (!this.data.isHost) {
      wx.showToast({ title: '仅房主可以更换游戏模式', icon: 'none' });
      return;
    }
    if (!this.data.hasSelectedMode) {
      this.handleGoBrainstormMode();
      return;
    }
    this.setData({ showModeActionSheet: true });
  },

  closeModeActionSheet() {
    this.setData({ showModeActionSheet: false });
  },

  onTapExitModeFromSheet() {
    this.setData({
      showModeActionSheet: false,
      showExitModeConfirm: true
    });
  },

  closeExitModeConfirm() {
    this.setData({ showExitModeConfirm: false });
  },

  confirmExitMode() {
    return runPageInteraction(this, () => this._confirmExitMode(), {
      loadingText: '正在退出当前模式…'
    });
  },

  async _confirmExitMode() {
    if (!this.data.isHost || this._exitingMode) return;
    this._exitingMode = true;
    this.setData({ showExitModeConfirm: false, showModeActionSheet: false });
    try {
      const current = getActiveRoomSession() && getActiveRoomSession().getView();
      const currentSession = current && current.session;
      const result = !currentSession
        ? { ok: true }
        : await dispatchRoomCommand(currentSession.status === 'COMPLETED' ? 'RETURN_TO_LOBBY' : 'CANCEL_WORKSHOP_SESSION',
          {}, { sessionId: currentSession.sessionId });
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '操作失败', icon: 'none' });
        return;
      }
      try {
        const app = getApp();
        if (app.globalData) {
          app.globalData.gameMode = '';
          app.globalData.selectedMode = null;
          app.globalData.selectedBG = null;
        }
      } catch (e) {
        // ignore
      }
      wx.showToast({ title: '已退出当前模式', icon: 'success' });
      await this.loadRoomData(this.data.roomId, { silent: true });
    } catch (err) {
      wx.showToast({ title: (err && err.errMsg) || '操作失败', icon: 'none' });
    } finally {
      this._exitingMode = false;
    }
  },

  onTapPrimaryAction() {
    if (this.data.primaryBtnDisabled) return;
    const action = this.data.primaryBtnAction;
    if (action === 'continue') {
      return this.handleContinueBrainstorm();
    } else if (action === 'selectMode') {
      return this.handleGoBrainstormMode();
    } else if (action === 'anotherRound') {
      return this.handleAnotherRound();
    }
  },

  onTapExitText() {
    const action = this.data.exitTextAction;
    if (action === 'dissolve') {
      this.handleDissolveRoom();
    } else {
      this.handleLeaveRoom();
    }
  },

  handleDissolveRoom() {
    if (!this.data.isHost) return;
    wx.showModal({
      title: '解散房间',
      content: '解散后所有成员将退出房间，当前游戏进度会被清除且无法恢复。确定要解散吗？',
      confirmText: '解散',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        runPageInteraction(this, () => this._dissolveRoom(), {
          loadingText: '正在解散房间…'
        });
      }
    });
  },

  async _dissolveRoom() {
    try {
      const result = await dispatchRoomCommand('DISSOLVE_ROOM', {});
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '解散失败', icon: 'none' });
        return;
      }
      disposeRoomSession();
      // 全房间事件：清本地态 + 回首页提示「房间已解散」（成员靠轮询同步）
      exitRoomGone(
        { ...result, event: 'room_dissolved', roomDissolved: true },
        { roomId: this.data.roomId, forceDissolved: true, title: '房间已解散' }
      );
    } catch (err) {
      wx.showToast({ title: err.errMsg || '解散失败', icon: 'none' });
    }
  },

  handleLeaveRoom() {
    wx.showModal({
      title: '退出房间',
      content: '确定要退出当前房间吗？',
      confirmText: '退出',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        runPageInteraction(this, () => this._leaveRoom(), {
          loadingText: '正在退出房间…'
        });
      }
    });
  },

  async _leaveRoom() {
    try {
      const result = await dispatchRoomCommand('LEAVE_ROOM', {});
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '退出失败', icon: 'none' });
        return;
      }
      disposeRoomSession();
      try {
        wx.removeStorageSync('joinedRoomId');
      } catch (e) {
        console.warn('removeStorage joinedRoomId failed', e);
      }
      getApp().globalData.roomId = null;
      wx.showToast({ title: '已退出房间', icon: 'success' });
      await new Promise((resolve) => {
        setTimeout(() => {
          wx.reLaunch({
            url: '/pages/main-pages/aaa/index',
            success: resolve,
            fail: resolve
          });
        }, 1200);
      });
    } catch (err) {
      wx.showToast({ title: err.errMsg || '退出失败', icon: 'none' });
    }
  },

  /* DEV_TEST_START: 显示房间号（测试用） */
  handleDevCopyRoomId() {
    const roomId = this.data.devRoomIdDisplay || this.data.roomId;
    if (!roomId) return;
    wx.setClipboardData({
      data: String(roomId),
      success: () => {
        wx.showToast({ title: '已复制房间号', icon: 'none' });
      }
    });
  },
  /* DEV_TEST_END */

  noop() {}
}, [
  'handleGoBack',
  'startEditRoomName',
  'onRoomNameInput',
  'confirmEditRoomName',
  'onTapModePill',
  'handleDevCopyRoomId',
  'onContentTouchMove',
  'onContentTouchEnd',
  'onWrapTouchMove',
  'onWrapTouchEnd',
  'handleRetryQrcode',
  'onSlotTap',
  'onSlotTouchStart',
  'onSlotTouchMove',
  'onSlotTouchEnd',
  'onDragMaskTouchMove',
  'onDragMaskTouchEnd',
  'onTapPrimaryAction',
  'onTapExitText',
  'closeModeActionSheet',
  'onTapExitModeFromSheet',
  'closeExitModeConfirm',
  'confirmExitMode',
  'onChooseAvatarAuth',
  'onSkipAvatarAuth'
]));
