const { navigateByRoomState } = require('../../../utils/subAwaitRoutes');
const {
  saveLocalBrainstormProgress,
  clearLocalBrainstormProgress,
  resolveBrainstormProgress
} = require('../../../utils/roomBrainstormProgress');
const { isValidPartnerBG, partnerPageNeedsBG } = require('../../../utils/partnerScenarios');
const { buildGamepageUrl, buildStatementUrl } = require('../../../utils/modeRoutes');

const MEMBER_SLOTS = 6;   // 圆周展示的槽位数（含空位）
const CIRCLE_R = 280;     // 头像圆心半径 rpx
const AVATAR_SIZE = 80;   // 头像直径 rpx
const CENTER_XY = 300;    // 圆心在 600rpx 区域内的坐标
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

/** 头像图片列表，按 avatarIndex 分配给成员 */
const AVATAR_IMAGES = [
  '/assets/avatar/Frame 2085662241.png',
  '/assets/avatar/Frame 2085662242.png',
  '/assets/avatar/Frame 2085662243.png',
  '/assets/avatar/Frame 2085662244.png',
  '/assets/avatar/Frame 2085662245.png',
  '/assets/avatar/Frame 2085662246.png',
  '/assets/avatar/Frame 2085662247.png',
  '/assets/avatar/Frame 2085662248.png',
  '/assets/avatar/Frame 2085662249.png'
];

Page({
  data: {
    roomId: '',
    formattedRoomId: '',
    workshopName: '脑暴工作坊',
    qrcodeUrl: '',
    qrcodeStatus: 'loading',
    members: [],
    memberSlots: [],
    isFromScan: false,
    isHost: true,
    memberCount: 0,
    hasSelectedMode: false,
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
    showQRCodeModal: false
  },

  _syncLobbyRoomState(result) {
    const hasSelectedMode = result && result.hasSelectedMode === true;
    if (!hasSelectedMode) {
      this._updateRoomState('addPlayer');
    }
  },

  onLoad(options) {
    let roomId = (options && options.roomId) || '';
    const scene = options && options.scene;

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

    getApp().globalData.roomId = roomId;
    try {
      wx.setStorageSync('joinedRoomId', roomId);
    } catch (e) {
      console.warn('setStorage joinedRoomId failed', e);
    }

    this.setData({
      roomId,
      formattedRoomId: this._formatRoomId(roomId),
      isFromScan: !!scene
    });

    if (scene) {
      this.joinRoomThenLoad(roomId);
    } else {
      this.loadRoomData(roomId).then((result) => {
        if (!result) {
          console.log('[addPlayer] loadRoomData 返回空，跳过');
          return;
        }
        console.log('[addPlayer] loadRoomData 完成', { isHost: result.isHost });
        if (result.isHost === true) {
          this._syncLobbyRoomState(result);
          this._startMemberPolling();
        } else {
          console.log('[addPlayer] 副屏用户，启动页面状态轮询 + 成员列表轮询');
          this._startStatePolling();
          this._startMemberPolling();
        }
      });
    }
  },

  /**
   * 将 8 位数字房间号格式化为 0000-0000 形式，仅用于展示
   */
  _formatRoomId(roomId) {
    if (!roomId || typeof roomId !== 'string') return '';
    const digits = roomId.replace(/\D/g, '');
    if (digits.length <= 4) return digits;
    const padded = digits.padStart(8, '0').slice(-8);
    return `${padded.slice(0, 4)}-${padded.slice(4)}`;
  },

  onShow() {
    if (!this.data.isHost && this.data.roomId && this._statePollTimer && typeof this._statePollFn === 'function') {
      this._statePollFn();
    }
    if (this.data.roomId) {
      this.loadRoomData(this.data.roomId, { silent: true });
    }
  },

  onUnload() {
    this._stopMemberPolling();
    this._stopStatePolling();
    this._clearLongPressTimer();
    this._clearDragWatchdog();
    this._clearDragEnterAnimTimer();
  },

  _applyRoomMeta(result, dedupedMembers) {
    const memberCount = result.memberCount != null
      ? result.memberCount
      : (dedupedMembers || []).length;
    return {
      memberCount,
      hasSelectedMode: result.hasSelectedMode === true,
      selectedModeId: result.selectedModeId || '',
      selectedModeTitle: result.selectedModeTitle || '',
      selectedModeDesc: result.selectedModeDesc || '',
      workshopName: result.workshopName || this.data.workshopName
    };
  },

  _handleMembershipLost() {
    try {
      wx.removeStorageSync('joinedRoomId');
    } catch (e) {
      console.warn('removeStorage joinedRoomId failed', e);
    }
    getApp().globalData.roomId = null;
    wx.showToast({ title: '您已不在该房间', icon: 'none' });
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/main-pages/aaa/index' });
    }, 1500);
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName, extra = {}) {
    const roomId = this.data.roomId;
    if (!roomId) {
      console.warn('[主屏] updateRoomState 跳过：无 roomId');
      return { ok: false };
    }
    try {
      console.log('[主屏] 调用 updateRoomState', { roomId, currentPage });
      const data = { roomId, currentPage, ...extra };
      if (currentPlayerIndex != null) data.currentPlayerIndex = currentPlayerIndex;
      if (currentPlayerName != null) data.currentPlayerName = currentPlayerName;
      const res = await wx.cloud.callFunction({
        name: 'updateRoomState',
        data
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        console.log('[主屏] updateRoomState 成功', { currentPage: result.currentPage });
        if (currentPage && currentPage !== 'addPlayer') {
          saveLocalBrainstormProgress(roomId, currentPage);
        }
        return result;
      }
      console.warn('[主屏] updateRoomState 失败', {
        errCode: result.errCode,
        errMsg: result.errMsg,
        roomId,
        currentPage
      });
      return result;
    } catch (e) {
      console.warn('[主屏] updateRoomState 异常', e);
      return { ok: false, errMsg: e.errMsg };
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    console.log('[副屏轮询] 已启动 _startStatePolling');
    const poll = async () => {
      const roomId = this.data.roomId || getApp().globalData.roomId;
      if (!roomId) {
        console.log('[副屏轮询] 无 roomId，跳过', { dataRoomId: this.data.roomId, globalRoomId: getApp().globalData.roomId });
        return;
      }
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        console.log('[副屏轮询] getAddPlayerData 返回', {
          ok: result.ok,
          isHost: result.isHost,
          hasRoomState: !!result.roomState,
          currentPage: result.roomState && result.roomState.currentPage,
          raw: result
        });
        if (result.ok !== true || !result.roomState) {
          console.log('[副屏轮询] 数据无效，跳过', { ok: result.ok, errMsg: result.errMsg });
          return;
        }
        const page = (result.roomState.currentPage || 'addPlayer').toLowerCase();
        if (navigateByRoomState(page, result.roomState, roomId)) {
          console.log('[副屏轮询] 已跟随主屏跳转', { page });
        } else {
          console.log('[副屏轮询] 主屏在 addPlayer，保持当前页', { page });
        }
      } catch (e) {
        console.warn('[副屏轮询] 异常', e);
      }
    };
    this._statePollFn = poll;
    poll();
    this._statePollTimer = setInterval(poll, 1500);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
    this._statePollFn = null;
  },

  _startMemberPolling() {
    this._stopMemberPolling();
    const poll = () => {
      const roomId = this.data.roomId;
      if (roomId) this.loadRoomData(roomId, { silent: true });
    };
    this._memberPollTimer = setInterval(poll, 3000);
  },

  _stopMemberPolling() {
    if (this._memberPollTimer) {
      clearInterval(this._memberPollTimer);
      this._memberPollTimer = null;
    }
  },

  /** 为成员列表补充 avatarImage（按 avatarIndex 映射，无则按顺序分配） */
  _assignAvatarImages(members) {
    return (members || []).map((m, i) => {
      if (!m) return m;
      const idx = m.avatarIndex != null ? m.avatarIndex : i % AVATAR_IMAGES.length;
      const avatarImage = AVATAR_IMAGES[idx % AVATAR_IMAGES.length] || AVATAR_IMAGES[0];
      return { ...m, avatarImage };
    });
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
    wx.showLoading({ title: '加入中…' });
    try {
      const joinRes = await wx.cloud.callFunction({
        name: 'roomJoin',
        data: { roomId }
      });
      const result = (joinRes && joinRes.result) || {};
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '加入失败', icon: 'none' });
        return;
      }
      this.loadRoomData(roomId).then((result) => {
        if (!result) {
          console.log('[addPlayer] joinRoomThenLoad loadRoomData 返回空');
          return;
        }
        console.log('[addPlayer] joinRoomThenLoad 完成', { isHost: result.isHost });
        if (result.isHost === true) {
          this._syncLobbyRoomState(result);
          this._startMemberPolling();
        } else {
          console.log('[addPlayer] 副屏用户(扫码进入)，启动页面状态轮询 + 成员列表轮询');
          this._startStatePolling();
          this._startMemberPolling();
        }
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.errMsg || '加入失败', icon: 'none' });
    }
  },

  async loadRoomData(roomId, opts = {}) {
    const silent = opts && opts.silent === true;
    if (!silent) {
      this.setData({ qrcodeStatus: 'loading' });
      wx.showLoading({ title: '加载中…' });
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (!silent) wx.hideLoading();

      if (result.ok !== true) {
        if (!silent) {
          this.setData({ qrcodeStatus: 'error' });
          wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
        }
        return null;
      }

      const rawMembers = result.members || [];
      const deduped = this._dedupeMembersById(rawMembers);
      const isStillMember = deduped.some((m) => m.isMe);
      if (!result.isHost && !isStillMember) {
        this._handleMembershipLost();
        return null;
      }

      const roomMeta = this._applyRoomMeta(result, deduped);
      const withAvatars = this._assignAvatarImages(deduped);
      const members = this._expandMembersToSlots(withAvatars);
      const memberSlots = this.buildMemberSlots(members);
      /* 仅创建者为主屏，其余（含扫码/输入加入）均为副屏 */
      const isHost = result.isHost === true;
      const roomState = result.roomState || {
        currentPage: 'addPlayer',
        currentPlayerIndex: 1,
        currentPlayerName: '玩家1'
      };
      const hasSelectedMode = result.hasSelectedMode === true;
      const resolvedState = resolveBrainstormProgress(roomId, roomState, hasSelectedMode);
      if (resolvedState.currentPage && resolvedState.currentPage !== 'addPlayer') {
        saveLocalBrainstormProgress(roomId, resolvedState.currentPage);
      }

      if (silent) {
        if (!this.data.isDragging) {
          const deduped = this._dedupeMembersById(rawMembers);
          const withAvatars = this._assignAvatarImages(deduped);
          // 保留本地槽位布局（含空位），避免单人拖拽后被轮询刷回到默认位置
          const localExpanded = this._expandMembersToSlots(this.data.members || []);
          const localFilledCount = localExpanded.filter((m) => !!m).length;
          // 仅当有人新加入时用服务端顺序；否则保留本地拖拽顺序（位置不变，仅同步成员字段）
          let expanded;
          if (deduped.length !== localFilledCount) {
            expanded = this._expandMembersToSlots(withAvatars);
          } else if (localFilledCount > 0) {
            const serverById = new Map();
            withAvatars.forEach((m) => {
              const id = this._getMemberId(m);
              if (id) serverById.set(id, m);
            });
            const canMerge = serverById.size > 0;
            const merged = canMerge
              ? localExpanded.map((m) => {
                  if (!m) return null;
                  const id = this._getMemberId(m);
                  const s = id ? serverById.get(id) : null;
                  return s ? { ...s } : m;
                })
              : localExpanded;
            expanded = this._expandMembersToSlots(merged);
          } else {
            expanded = this._expandMembersToSlots(withAvatars);
          }
          this.setData({
            members: expanded,
            memberSlots: this.buildMemberSlots(expanded),
            roomState: resolvedState,
            ...roomMeta
          });
        }
        return result;
      }

      let qrcodeFileID = result.qrcodeFileID;
      if (!qrcodeFileID) {
        try {
          const regenRes = await wx.cloud.callFunction({
            name: 'regenerateRoomQrcode',
            data: { roomId }
          });
          const regenResult = (regenRes && regenRes.result) || {};
          if (regenResult.ok === true && regenResult.qrcodeFileID) {
            qrcodeFileID = regenResult.qrcodeFileID;
          }
        } catch (e) {
          console.warn('regenerateRoomQrcode 调用失败', e);
        }
      }

      let qrcodeUrl = '';
      let qrcodeStatus = 'no_qr';
      if (qrcodeFileID) {
        try {
          const tempRes = await wx.cloud.getTempFileURL({
            fileList: [qrcodeFileID]
          });
          const first = tempRes && tempRes.fileList && tempRes.fileList[0];
          if (first && first.tempFileURL) {
            qrcodeUrl = first.tempFileURL;
            qrcodeStatus = 'success';
          } else if (first && first.errMsg && first.errMsg !== 'ok') {
            console.error('getTempFileURL err', first.errMsg);
            qrcodeStatus = 'error';
          } else {
            qrcodeStatus = 'error';
          }
        } catch (e) {
          console.error('getTempFileURL exception', e);
          qrcodeStatus = 'error';
        }
      }

      this.setData({
        qrcodeUrl,
        qrcodeStatus,
        members,
        memberSlots,
        isHost,
        roomState: resolvedState,
        ...roomMeta
      });
      return {
        isHost: result.isHost,
        hasSelectedMode: result.hasSelectedMode === true
      };
    } catch (err) {
      if (!silent) {
        wx.hideLoading();
        this.setData({ qrcodeStatus: 'error' });
        wx.showToast({ title: err.errMsg || '加载失败', icon: 'none' });
      }
      return null;
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
    if (roomId) this.loadRoomData(roomId);
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
    const isHost = this.data.isHost;
    const isDragging = this.data.isDragging;
    if (isHost !== true || isDragging === true) return;
    this._clearLongPressTimer();
    this._slotTouchStart = null;
    this._lastTouch = null;

    wx.showModal({
      title: '踢出成员',
      content: `确定将「${member.nickName}」移出房间吗？`,
      confirmText: '踢出',
      confirmColor: '#dc2626',
      success: (res) => {
        if (res.confirm) this._kickMember(member);
      }
    });
  },

  async _kickMember(member) {
    const roomId = this.data.roomId || getApp().globalData.roomId;
    if (!roomId || !member || !member.userId) return;

    wx.showLoading({ title: '处理中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'roomKickMember',
        data: { roomId, targetUserId: member.userId }
      });
      const result = (res && res.result) || {};
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '踢出失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已踢出', icon: 'success' });
      this.loadRoomData(roomId, { silent: true });
    } catch (err) {
      wx.hideLoading();
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
      // 长按其他成员（非自己）且为房主时 → 显示踢出确认
      if (this.data.isHost && slot.member && !slot.member.isMe) {
        this._showKickConfirm(slot.member);
        return;
      }
      // 长按自己（房主） → 进入拖拽模式
      if (this.data.isHost && slot.member && slot.member.isMe) {
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

    // 位置节流：变化不足 1px 时跳过，减少无意义的跨线程通信
    if (
      Math.abs(clientX - this.data.dragPosX) < 1 &&
      Math.abs(clientY - this.data.dragPosY) < 1
    ) return;

    const applyUpdate = () => {
      // 拖拽中只更新浮层坐标；原槽位/原槽位动效保持不动
      this.setData({ dragPosX: clientX, dragPosY: clientY });
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
      dragEnterAnimating: false
    };

    // 仅在松手时一次性提交重排，避免拖动中 slots 反复变化导致“卡住”
    if (dragFromIndex != null && dropTargetIndex != null && dragFromIndex !== dropTargetIndex) {
      const base = this._dragBaseMembers;
      const draggingMember = this.data.draggingMember;
      if (base && draggingMember) {
        const arr = base.slice();
        arr.splice(dropTargetIndex, 0, draggingMember);
        const reordered = this._expandMembersToSlots(arr);
        updates.members = reordered;
        updates.memberSlots = this.buildMemberSlots(reordered);
      }
    }

    this.setData(updates);
    this._circleRect = null;
    this._lastTouch = null;
    this._slotTouchStart = null;
    this._dragBaseMembers = null; // 释放快照，避免内存残留
    this._clearDragWatchdog();
    this._clearDragEnterAnimTimer();
    if (dragFromIndex != null && dropTargetIndex != null && dragFromIndex !== dropTargetIndex) {
      wx.showToast({ title: '顺序已调整', icon: 'none', duration: 800 });
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
      dragEnterAnimating: false
    };
    if (restoreLayout) {
      updates.memberSlots = this.buildMemberSlots(this.data.members || []);
    }
    this.setData(updates);
    this._circleRect = null;
    this._lastTouch = null;
    this._slotTouchStart = null;
    this._dragBaseMembers = null; // 释放快照，避免内存残留
    this._clearDragWatchdog();
    this._clearDragEnterAnimTimer();
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: '/pages/main-pages/aaa/index'
        });
      }
    });
  },

  handleGoBrainstormMode() {
    const roomId = this.data.roomId || '';
    if (!roomId) return;
    wx.navigateTo({
      url: `/pages/main-pages/brainstormMode/index?roomId=${encodeURIComponent(roomId)}&isHost=${this.data.isHost ? '1' : '0'}`
    });
  },

  /** 根据已选模式与房间进度，解析「继续脑暴」跳转目标 */
  _resolveContinueBrainstormTarget(roomId, selectedModeId, roomState, selectedBG) {
    const roomIdEnc = encodeURIComponent(roomId);
    const modeId = selectedModeId || 'halliGalli';
    const state = roomState || {};
    const page = (state.currentPage || 'addPlayer').toLowerCase();
    const idx = state.currentPlayerIndex != null ? state.currentPlayerIndex : 1;
    const name = encodeURIComponent(state.currentPlayerName || `玩家${idx}`);
    const bg = selectedBG || (getApp().globalData && getApp().globalData.selectedBG);

    const modeIndexRoute = {
      path: `/pages/main-pages/modeIndex/index?roomId=${roomIdEnc}&modeId=${encodeURIComponent(modeId)}`,
      nextPage: 'auth'
    };

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
      selectmode: {
        path: `/pages/main-pages/selectMode/index?roomId=${roomIdEnc}`,
        nextPage: 'selectMode'
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
        path: buildGamepageUrl(roomId, idx, modeId),
        nextPage: 'gamepage'
      },
      creativeinput: {
        path: `/pages/main-pages/creativeInput/index?roomId=${roomIdEnc}`,
        nextPage: 'creativeInput'
      },
      creativesummary: {
        path: `/pages/main-pages/creativeSummary/index?roomId=${roomIdEnc}`,
        nextPage: 'creativeSummary'
      },
      statement: {
        path: buildStatementUrl(roomId, idx, state.currentPlayerName || `玩家${idx}`),
        nextPage: 'statement'
      },
      discussion: {
        path: `/pages/main-pages/discussion/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}`,
        nextPage: 'discussion'
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

  async handleContinueBrainstorm() {
    const roomId = this.data.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '房间参数错误', icon: 'none' });
      return;
    }
    if (!this.data.hasSelectedMode) {
      wx.showToast({ title: '请先选择脑暴模式', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '同步进度…', mask: true });
    let roomState = this.data.roomState;
    let selectedModeId = this.data.selectedModeId || 'halliGalli';
    let hasSelectedMode = this.data.hasSelectedMode;
    let selectedBG = (getApp().globalData && getApp().globalData.selectedBG) || null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      if (result.ok === true) {
        hasSelectedMode = result.hasSelectedMode === true;
        if (result.roomState) {
          roomState = resolveBrainstormProgress(roomId, result.roomState, hasSelectedMode);
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
          selectedModeTitle: result.selectedModeTitle || this.data.selectedModeTitle,
          selectedModeDesc: result.selectedModeDesc || this.data.selectedModeDesc
        });
      } else if (hasSelectedMode) {
        roomState = resolveBrainstormProgress(roomId, roomState, hasSelectedMode);
      }
    } catch (e) {
      console.warn('handleContinueBrainstorm fetch state', e);
      if (hasSelectedMode) {
        roomState = resolveBrainstormProgress(roomId, roomState, hasSelectedMode);
      }
    } finally {
      wx.hideLoading();
    }

    getApp().globalData.gameMode = selectedModeId;

    if (!this.data.isHost) {
      const page = (roomState && roomState.currentPage) || 'addPlayer';
      navigateByRoomState(page, roomState, roomId);
      return;
    }

    const target = this._resolveContinueBrainstormTarget(
      roomId,
      selectedModeId,
      roomState,
      selectedBG
    );

    if (target.nextPage) {
      const state = roomState || {};
      const updateRes = await this._updateRoomState(
        target.nextPage,
        state.currentPlayerIndex,
        state.currentPlayerName
      );
      if (updateRes && updateRes.ok !== true) {
        wx.showToast({ title: '状态同步失败', icon: 'none' });
      }
    }

    wx.redirectTo({
      url: target.path,
      fail: () => {
        wx.navigateTo({ url: target.path });
      }
    });
  },

  handleExitBrainstorm() {
    wx.showModal({
      title: '退出脑暴',
      content: '退出后将清除当前已选脑暴模式，成员需重新等待房主选择。',
      confirmText: '退出',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中…' });
        try {
          const callRes = await wx.cloud.callFunction({
            name: 'roomClearBrainstormMode',
            data: { roomId: this.data.roomId }
          });
          const result = (callRes && callRes.result) || {};
          wx.hideLoading();
          if (result.ok !== true) {
            wx.showToast({ title: result.errMsg || '操作失败', icon: 'none' });
            return;
          }
          clearLocalBrainstormProgress(this.data.roomId);
          wx.showToast({ title: '已退出脑暴', icon: 'success' });
          this.loadRoomData(this.data.roomId, { silent: true });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.errMsg || '操作失败', icon: 'none' });
        }
      }
    });
  },

  handleDissolveRoom() {
    wx.showModal({
      title: '解散房间',
      content: '解散后所有成员将被移出，此操作不可撤销。',
      confirmText: '解散',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '解散中…' });
        try {
          const callRes = await wx.cloud.callFunction({
            name: 'roomDissolve',
            data: { roomId: this.data.roomId }
          });
          const result = (callRes && callRes.result) || {};
          wx.hideLoading();
          if (result.ok !== true) {
            wx.showToast({ title: result.errMsg || '解散失败', icon: 'none' });
            return;
          }
          try {
            wx.removeStorageSync('joinedRoomId');
          } catch (e) {
            console.warn('removeStorage joinedRoomId failed', e);
          }
          getApp().globalData.roomId = null;
          wx.showToast({ title: '房间已解散', icon: 'success' });
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/main-pages/aaa/index' });
          }, 1200);
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.errMsg || '解散失败', icon: 'none' });
        }
      }
    });
  },

  handleLeaveRoom() {
    wx.showModal({
      title: '退出房间',
      content: '确定要退出当前房间吗？',
      confirmText: '退出',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '退出中…' });
        try {
          const callRes = await wx.cloud.callFunction({
            name: 'roomLeave',
            data: { roomId: this.data.roomId }
          });
          const result = (callRes && callRes.result) || {};
          wx.hideLoading();
          if (result.ok !== true) {
            wx.showToast({ title: result.errMsg || '退出失败', icon: 'none' });
            return;
          }
          try {
            wx.removeStorageSync('joinedRoomId');
          } catch (e) {
            console.warn('removeStorage joinedRoomId failed', e);
          }
          getApp().globalData.roomId = null;
          wx.showToast({ title: '已退出房间', icon: 'success' });
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/main-pages/aaa/index' });
          }, 1200);
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.errMsg || '退出失败', icon: 'none' });
        }
      }
    });
  },

});
