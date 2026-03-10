const MEMBER_SLOTS = 6;   // 圆周展示的槽位数（含空位）
const CIRCLE_R = 280;     // 头像圆心半径 rpx
const AVATAR_SIZE = 80;   // 头像直径 rpx
const CENTER_XY = 300;    // 圆心在 600rpx 区域内的坐标
const START_ANGLE = -Math.PI / 2; // 从顶部开始
/** 长按进入拖拽的时长（毫秒），与手机桌面长按调整图标一致 */
const LONG_PRESS_ENTER_DRAG_MS = 800;

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
    workshopName: '脑暴工作坊',
    qrcodeUrl: '',
    qrcodeStatus: 'loading',
    members: [],
    memberSlots: [],
    isFromScan: false,
    isHost: true,
    isDragging: false,
    draggingSlotIndex: null,
    /** 跟手：浮动头像用 px 定位，手指位置 = 头像位置 */
    dragPosX: null,
    dragPosY: null,
    draggingMember: null,
    draggingMemberId: null,
    dragFromIndex: null,
    dropTargetIndex: null
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
      setTimeout(() => wx.reLaunch({ url: '/pages/auth/index' }), 1500);
      return;
    }

    getApp().globalData.roomId = roomId;

    this.setData({
      roomId,
      isFromScan: !!scene
    });

    if (scene) {
      this.joinRoomThenLoad(roomId);
    } else {
      this.loadRoomData(roomId).then((result) => {
        if (result && result.isHost) {
          this._updateRoomState('addPlayer');
          this._startMemberPolling();
        } else if (result && !result.isHost) {
          this._startStatePolling();
        }
      });
    }
  },

  onUnload() {
    this._stopMemberPolling();
    this._stopStatePolling();
  },

  async _updateRoomState(currentPage, currentPlayerIndex, currentPlayerName) {
    const roomId = this.data.roomId;
    if (!roomId) return;
    try {
      await wx.cloud.callFunction({
        name: 'updateRoomState',
        data: { roomId, currentPage, currentPlayerIndex, currentPlayerName }
      });
    } catch (e) {
      console.warn('updateRoomState', e);
    }
  },

  _startStatePolling() {
    this._stopStatePolling();
    const poll = async () => {
      const roomId = this.data.roomId;
      if (!roomId) return;
      try {
        const res = await wx.cloud.callFunction({
          name: 'getAddPlayerData',
          data: { roomId }
        });
        const result = (res && res.result) || {};
        if (result.ok !== true || !result.roomState) return;
        const page = (result.roomState.currentPage || 'addPlayer').toLowerCase();
        const roomIdEnc = encodeURIComponent(roomId);

        if (page === 'auth' || page === 'selectbg' || page === 'selectproblem') {
          wx.redirectTo({ url: `/pages/sub-pages/awaitBG/index?roomId=${roomIdEnc}` });
        } else if (page === 'selectmode') {
          wx.redirectTo({ url: `/pages/sub-pages/awaitMode/index?roomId=${roomIdEnc}` });
        } else if (page === 'selectplayer') {
          wx.redirectTo({ url: `/pages/sub-pages/awaitPlayer/index?roomId=${roomIdEnc}` });
        } else if (page === 'gamepage') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          wx.redirectTo({ url: `/pages/main-pages/normal-gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}` });
        } else if (page === 'statement') {
          const idx = result.roomState.currentPlayerIndex != null ? result.roomState.currentPlayerIndex : 1;
          const name = encodeURIComponent(result.roomState.currentPlayerName || `玩家${idx}`);
          wx.redirectTo({ url: `/pages/main-pages/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}&isWaiting=1` });
        } else if (page === 'leaderboard') {
          wx.redirectTo({ url: `/pages/leaderboard/index?roomId=${roomIdEnc}&isSubScreen=1` });
        }
      } catch (e) {
        console.warn('state poll', e);
      }
    };
    this._statePollTimer = setInterval(poll, 2000);
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
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
        if (result && !result.isHost) this._startStatePolling();
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
      const withAvatars = this._assignAvatarImages(deduped);
      const members = this._expandMembersToSlots(withAvatars);
      const memberSlots = this.buildMemberSlots(members);
      const isHost = result.isHost !== false;
      const roomState = result.roomState || {
        currentPage: 'addPlayer',
        currentPlayerIndex: 1,
        currentPlayerName: '玩家1'
      };

      if (silent) {
        if (!this.data.isDragging) {
          const deduped = this._dedupeMembersById(rawMembers);
          const withAvatars = this._assignAvatarImages(deduped);
          const localList = (this.data.members || []).filter((m) => m);
          // 仅当有人新加入时用服务端顺序；否则保留本地拖拽顺序
          let expanded;
          if (deduped.length > localList.length) {
            expanded = this._expandMembersToSlots(withAvatars);
          } else if (localList.length > 0) {
            const serverById = new Map();
            withAvatars.forEach((m) => {
              const id = this._getMemberId(m);
              if (id) serverById.set(id, m);
            });
            const canMerge = serverById.size > 0 && localList.every((m) => this._getMemberId(m));
            const merged = canMerge
              ? localList.map((m) => {
                  const s = serverById.get(this._getMemberId(m));
                  return s ? { ...s } : m;
                })
              : localList;
            expanded = this._expandMembersToSlots(merged);
          } else {
            expanded = this._expandMembersToSlots(withAvatars);
          }
          this.setData({ members: expanded, memberSlots: this.buildMemberSlots(expanded) });
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
        roomState
      });
      return { isHost: result.isHost };
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

  onSlotTouchStart(e) {
    if (!this.data.isHost) return;
    const index = e.currentTarget.dataset.index;
    const slot = (this.data.memberSlots || [])[index];
    if (!slot || !slot.member) return;

    const touch = e.touches && e.touches[0];
    if (!touch) return;

    this._slotTouchStart = { clientX: touch.clientX, clientY: touch.clientY };
    this._longPressSlotIndex = index;
    this._longPressSlot = slot;
    this._preloadCircleRect();
    this._clearLongPressTimer();
    this._longPressTimer = setTimeout(() => {
      this._longPressTimer = null;
      this._enterDragMode(index, slot);
    }, LONG_PRESS_ENTER_DRAG_MS);
  },

  _clearLongPressTimer() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  },

  /** 长按 0.8 秒后进入拖拽：头像跟手（手指位置=头像位置），拖到某槽位会挤开该位置玩家 */
  _enterDragMode(index, slot) {
    const touch = this._lastTouch || this._slotTouchStart;
    let initX = null, initY = null;
    if (touch) {
      initX = touch.clientX != null ? touch.clientX : touch.pageX;
      initY = touch.clientY != null ? touch.clientY : touch.pageY;
    }

    // 若 circleRect 已缓存则直接用，避免重置缓存导致拖拽开始阶段频繁查询 DOM
    const doEnter = (rect) => {
      if (initX == null && rect) {
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
        dropTargetIndex: index
      });
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
    this._lastTouch = touch;

    if (!this.data.isDragging) return false;
    this._updateDragPosition(x, y);
    return false;
  },

  onWrapTouchMove(e) {
    if (!this.data.isDragging) return false;
    const touch = e.touches && e.touches[0];
    if (!touch) return false;
    const x = touch.clientX != null ? touch.clientX : touch.pageX;
    const y = touch.clientY != null ? touch.clientY : touch.pageY;
    this._lastTouch = touch;
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
    }
  },

  onContentTouchMove(e) {
    if (!this.data.isDragging) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const x = touch.clientX != null ? touch.clientX : touch.pageX;
    const y = touch.clientY != null ? touch.clientY : touch.pageY;
    this._lastTouch = touch;
    this._updateDragPosition(x, y);
  },

  onContentTouchEnd(e) {
    if (this.data.isDragging) {
      this._finishDrag(e);
    } else {
      this._clearLongPressTimer();
    }
  },

  _updateDragPosition(clientX, clientY) {
    if (this.data.draggingSlotIndex == null) return;

    const applyUpdate = (rect) => {
      // 计算重排结果（不触发 setData，先收集变更）
      let reorderPatch = null;
      if (rect) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = clientX - cx;
        const dy = clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= 10) {
          // atan2(dx, -dy) 使 theta=0 对应正上方（槽位 0），顺时针递增
          const theta = Math.atan2(dx, -dy);
          const thetaNorm = (theta + Math.PI * 2) % (Math.PI * 2);
          // 使用居中分区：在 theta 上加半个区间偏移，使每个区间以槽位为中心
          const slotIndex = Math.floor((thetaNorm + Math.PI / 6) / (Math.PI / 3)) % MEMBER_SLOTS;
          if (slotIndex !== this.data.dropTargetIndex) {
            const draggingMemberId = this.data.draggingMemberId;
            const draggingMember = this.data.draggingMember;
            const members = this._expandMembersToSlots(this.data.members || []);
            const fromIdx = members.findIndex(
              (m) => m && (this._getMemberId(m) === draggingMemberId || m === draggingMember)
            );
            if (fromIdx >= 0) {
              members.splice(fromIdx, 1);
              members.splice(slotIndex, 0, draggingMember);
              const reordered = this._expandMembersToSlots(members);
              reorderPatch = {
                members: reordered,
                memberSlots: this.buildMemberSlots(reordered),
                dropTargetIndex: slotIndex
              };
            }
          }
        }
      }

      // 合并为一次 setData，减少跨线程通信次数
      const patch = { dragPosX: clientX, dragPosY: clientY, ...reorderPatch };
      this.setData(patch);
    };

    if (this._circleRect) {
      applyUpdate(this._circleRect);
    } else {
      // 首次查询时先立即更新位置，reorder 等查询完再处理
      this.setData({ dragPosX: clientX, dragPosY: clientY });
      const q = wx.createSelectorQuery().in(this);
      q.select('#circleWrap').boundingClientRect();
      q.exec((res) => {
        const rect = res && res[0];
        if (rect) this._circleRect = rect;
        // 仅在成员还在拖拽时才补做重排（避免 touchend 后回调才到）
        if (this.data.isDragging) applyUpdate(rect);
      });
    }
  },

  onSlotTouchEnd(e) {
    if (this.data.isDragging) {
      this._finishDrag(e);
    } else {
      this._clearLongPressTimer();
    }
  },

  onWrapTouchEnd(e) {
    if (this.data.isDragging) {
      this._finishDrag(e);
    } else {
      this._clearLongPressTimer();
    }
  },

  _finishDrag(e) {
    if (!this.data.isDragging || this.data.draggingSlotIndex == null) {
      this._clearLongPressTimer();
      return;
    }
    this._lastDragEndTime = Date.now();
    const dragFromIndex = this.data.dragFromIndex;
    const dropTargetIndex = this.data.dropTargetIndex;
    this.setData({
      isDragging: false,
      draggingSlotIndex: null,
      dragPosX: null,
      dragPosY: null,
      draggingMember: null,
      draggingMemberId: null,
      dragFromIndex: null,
      dropTargetIndex: null
    });
    this._circleRect = null;
    this._lastTouch = null;
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
      dropTargetIndex: null
    };
    if (restoreLayout) {
      updates.memberSlots = this.buildMemberSlots(this.data.members || []);
    }
    this.setData(updates);
    this._circleRect = null;
    this._lastTouch = null;
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: '/pages/main-pages/setRoom/index'
        });
      }
    });
  },

  handleComplete() {
    const roomId = this.data.roomId || '';
    if (roomId) getApp().globalData.roomId = roomId;
    this._updateRoomState('auth');
    wx.navigateTo({
      url: '/pages/auth/index'
    });
  }
});
