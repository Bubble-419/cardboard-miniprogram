const JOINED_ROOM_STORAGE_KEY = 'joinedRoomId';
const HOME_PROFILE_AUTH_KEY = 'homeProfileAuthPrompted';
const DEFAULT_ROOM_DESC = '邀请成员扫码加入，一起进行头脑风暴';
const { getDevJoinPageData } = require('../../../utils/devJoinRoomById');
const {
  DEFAULT_AVATAR,
  getStoredProfile,
  saveStoredProfile,
  applyChooseAvatarEvent,
  getOptionalProfileForRoom,
  buildRoomJoinPayload
} = require('../../../utils/wxUserAvatar');
const {
  isCloudFileId,
  sanitizeImageSrc,
  resolveCloudDisplayUrl
} = require('../../../utils/cloudDisplayUrl');
const { AVATAR_IMAGES } = require('../../../utils/avatars');
const {
  handleRoomGoneFromResult,
  consumePendingRoomGoneToast,
  isRoomDissolvedResult
} = require('../../../utils/roomDissolved');
const {
  beginScanJoin,
  isScanJoinActive
} = require('../../../utils/scanJoinGate');
const {
  beginUserAuthFlow,
  endUserAuthFlow,
  forceEndUserAuthFlow,
  isUserAuthInProgress
} = require('../../../utils/userAuthSession');
const {
  getHistoryWorkshops,
  upsertHistoryWorkshop,
  removeHistoryWorkshops,
  formatTime: formatHistoryTime
} = require('../../../utils/historyWorkshops');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../utils/pageInteractionLock');
const {
  dispatchRoomCommand,
  getCurrentRoomPageSnapshot,
  getRoomPageSnapshot
} = require('../../../modules/room-session/index');
const { EMPTY_HISTORY_SRC } = require('../../../utils/staticCdn');

/** 扫码跳转中：避免 onShow 用未 join 的 roomId 误踢 */
let _scanJoinNavigatingRoomId = '';

function describeRoomCloudError(error, fallback) {
  const errCode = error && (error.errCode != null ? error.errCode : error.code);
  const errMsg = String((error && (error.errMsg || error.message)) || '');
  const blob = `${errCode || ''} ${errMsg}`;
  if (/-504002|functions execute fail|SyntaxError|Cannot find module|MODULE_NOT_FOUND|CloudBase transaction database required/i.test(blob)) {
    return '云函数执行失败，请重新部署';
  }
  if (/-504003|timed out after/i.test(blob)) {
    return '服务响应超时，请稍后重试';
  }
  if (/-501005|function not exist/i.test(blob)) {
    return '云函数未部署';
  }
  if (errMsg && !/cloud\.callFunction:fail|errCode\s*:/i.test(errMsg)) {
    return errMsg;
  }
  return fallback || '操作失败，请重试';
}

function _hasCompleteLocalProfile(stored) {
  if (!stored) return false;
  const nick = (stored.nickName || '').trim();
  const hasNick = !!nick && nick !== '微信用户';
  const hasAvatar = !!(stored.avatarUrl || stored.avatarFileID);
  return hasNick && hasAvatar;
}

Page(withPageInteractionLock({
  data: {
    headerPaddingTop: 24,
    userNickName: '微信用户',
    userAvatarUrl: DEFAULT_AVATAR,
    isJoinedRoom: false,
    role: '',
    roleLabel: '未加入房间',
    roomId: '',
    roomName: '',
    roomDesc: '',
    roomTimeText: '',
    timeLabel: '创建/加入时间',
    loading: false,
    debugRoomIdInput: '',
    historyWorkshops: [],
    historyManageMode: false,
    selectedHistoryIds: {},
    selectedHistoryCount: 0,
    historyAllSelected: false,
    showProfileAuth: false,
    authDraftNick: '',
    authDraftAvatar: DEFAULT_AVATAR,
    emptyHistorySrc: EMPTY_HISTORY_SRC
  },

  onLoad() {
    let headerPaddingTop = 24;
    try {
      const sys = wx.getSystemInfoSync();
      headerPaddingTop = (sys.statusBarHeight || 0) + 24;
    } catch (e) {
      console.warn('getSystemInfo for header', e);
    }
    this.setData({ headerPaddingTop, ...getDevJoinPageData() });
    this._restoreUserProfile();
    this.loadJoinedRoomState();
    this._loadHistoryWorkshops();
    this._maybeShowFirstProfileAuth();
  },

  onShow() {
    // 系统头像选择面板关闭后 chooseavatar 可能不回调；拉长兜底，避免打断进行中的授权
    if (isUserAuthInProgress()) {
      clearTimeout(this._authReleaseTimer);
      this._authReleaseTimer = setTimeout(() => {
        if (isUserAuthInProgress()) forceEndUserAuthFlow();
      }, 2500);
    }
    consumePendingRoomGoneToast();
    this._restoreUserProfile();
    // 扫码跳转途中不要用「即将加入」的 roomId 跑成员校验，否则会误弹退出房间
    if (_scanJoinNavigatingRoomId || isScanJoinActive()) return;
    this.loadJoinedRoomState();
    this._loadHistoryWorkshops();
  },

  _decorateHistoryWorkshops(list, selectedIds) {
    const selected = selectedIds || {};
    return (Array.isArray(list) ? list : []).map((item) => ({
      ...item,
      selected: !!(item && item.roomId && selected[item.roomId])
    }));
  },

  _syncHistorySelection(list, selectedIds, manageMode) {
    const source = Array.isArray(list) ? list : [];
    const prevSelected = selectedIds || {};
    const nextSelected = {};
    let count = 0;
    if (manageMode) {
      source.forEach((item) => {
        const roomId = item && item.roomId;
        if (roomId && prevSelected[roomId]) {
          nextSelected[roomId] = true;
          count += 1;
        }
      });
    }
    return {
      historyWorkshops: this._decorateHistoryWorkshops(source, nextSelected),
      selectedHistoryIds: nextSelected,
      selectedHistoryCount: count,
      historyAllSelected: manageMode && source.length > 0 && count === source.length,
      historyManageMode: manageMode && source.length > 0
    };
  },

  _loadHistoryWorkshops() {
    const list = getHistoryWorkshops();
    this.setData(this._syncHistorySelection(
      list,
      this.data.selectedHistoryIds,
      this.data.historyManageMode === true
    ));
  },

  onTapHistoryManage() {
    if (!(this.data.historyWorkshops || []).length) return;
    this.setData(this._syncHistorySelection(this.data.historyWorkshops, {}, true));
  },

  onTapHistoryCancelManage() {
    this.setData(this._syncHistorySelection(this.data.historyWorkshops, {}, false));
  },

  onTapHistorySelectAll() {
    if (!this.data.historyManageMode) return;
    const list = this.data.historyWorkshops || [];
    if (!list.length) return;
    if (this.data.historyAllSelected) {
      this.setData(this._syncHistorySelection(list, {}, true));
      return;
    }
    const selected = {};
    list.forEach((item) => {
      if (item && item.roomId) selected[item.roomId] = true;
    });
    this.setData(this._syncHistorySelection(list, selected, true));
  },

  onTapHistoryCard(e) {
    const roomId = e.currentTarget.dataset.roomId;
    const sessionId = e.currentTarget.dataset.sessionId || '';
    if (!roomId) return;
    if (this.data.historyManageMode) {
      const selected = { ...(this.data.selectedHistoryIds || {}) };
      if (selected[roomId]) delete selected[roomId];
      else selected[roomId] = true;
      this.setData(this._syncHistorySelection(this.data.historyWorkshops, selected, true));
      return;
    }
    return runPageNavigation(this, async () => {
      getApp().globalData.roomId = roomId;
      const sessionQuery = sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : '';
      return {
        method: 'navigateTo',
        url: `/pages/main-pages/partnerMode/gamepage/index?roomId=${encodeURIComponent(roomId)}&mode=review${sessionQuery}`
      };
    }, { loadingText: '正在打开历史…' });
  },

  onTapHistoryDelete() {
    const count = this.data.selectedHistoryCount || 0;
    if (!this.data.historyManageMode || count < 1) {
      wx.showToast({ title: '请先选择要删除的记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除历史工作坊',
      content: count === 1
        ? '删除后将无法从首页再次打开该场次回顾，确定删除？'
        : `确定删除已选的 ${count} 条记录？删除后将无法从首页再次打开。`,
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: (res) => {
        if (res.confirm) this._deleteSelectedHistory();
      }
    });
  },

  _deleteSelectedHistory() {
    const selected = this.data.selectedHistoryIds || {};
    const roomIds = Object.keys(selected).filter((id) => selected[id]);
    if (!roomIds.length) return;
    const next = removeHistoryWorkshops(roomIds);
    const remainingIds = new Set((next || []).map((item) => item && item.roomId).filter(Boolean));
    if (roomIds.some((roomId) => remainingIds.has(roomId))) {
      this.setData(this._syncHistorySelection(next, selected, true));
      wx.showToast({ title: '删除失败，请重试', icon: 'none' });
      return;
    }
    this.setData(this._syncHistorySelection(next, {}, false));
    wx.showToast({ title: '已删除', icon: 'success' });
  },

  handleViewRoom() {
    const { roomId } = this.data;
    if (!roomId) {
      wx.showToast({ title: '房间信息缺失', icon: 'none' });
      return;
    }
    return runPageNavigation(this, async () => {
      // stayLobby：游戏进行中从首页再进大厅时，避免轮询立刻拉回游戏页
      try {
        const { setSpyLobbyStay, clearSpyFollowLock } = require('../../../utils/spyFollow');
        const { clearPendingNavigation } = require('../../../utils/pageNavigate');
        setSpyLobbyStay(roomId);
        clearSpyFollowLock();
        clearPendingNavigation();
      } catch (e) {
        // ignore
      }
      return {
        method: 'navigateTo',
        url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}&stayLobby=1`
      };
    }, { loadingText: '正在进入房间…' });
  },

  async loadJoinedRoomState() {
    if (_scanJoinNavigatingRoomId || isScanJoinActive()) return;
    const gen = (this._joinedStateGen || 0) + 1;
    this._joinedStateGen = gen;
    const storedRoomId = wx.getStorageSync(JOINED_ROOM_STORAGE_KEY)
      || getApp().globalData.roomId
      || '';

    let result = null;
    try {
      result = await getCurrentRoomPageSnapshot();
    } catch (error) {
      console.warn('discover current room fail', error);
    }
    if (gen !== this._joinedStateGen) return;
    if (_scanJoinNavigatingRoomId || isScanJoinActive()) return;

    if (result && result.ok === true && !result.roomId) {
      if (storedRoomId) this._clearJoinedRoom(storedRoomId);
      else this._setNotJoinedState();
      return;
    }

    if (!result || result.ok !== true) {
      if (isRoomDissolvedResult(result) || ['NOT_IN_ROOM', 'NOT_MEMBER'].includes(result && result.errCode)) {
        const goneId = (result && result.roomId) || storedRoomId;
        const handled = handleRoomGoneFromResult(result, goneId, {
          allowToastOnHome: true,
          title: isRoomDissolvedResult(result) ? '房间已解散' : '您已不在该房间'
        });
        if (!handled) this._clearJoinedRoom(goneId);
        else this._setNotJoinedState();
        return;
      }
      if (storedRoomId) {
        this._setJoinedFallbackState(storedRoomId);
        return;
      }
      this._setNotJoinedState();
      return;
    }

    const roomId = result.roomId;
    try {
      if (gen !== this._joinedStateGen) return;
      if (_scanJoinNavigatingRoomId || isScanJoinActive()) return;

      const isMember = (result.members || []).some(m => m.isMe);
      if (!isMember) {
        if (result.isHost !== true) {
          handleRoomGoneFromResult(
            { ok: false, errCode: 'NOT_IN_ROOM', errMsg: '您已不在该房间' },
            roomId,
            { allowToastOnHome: true }
          );
        } else {
          this._clearJoinedRoom(roomId);
        }
        this._setNotJoinedState();
        return;
      }

      const isHost = result.isHost === true || result.role === 'GOD';
      const role = isHost ? 'host' : 'member';
      const joinedAt = result.joinedAt;
      const createdAt = result.createdAt;
      const timeTs = isHost ? (createdAt || joinedAt) : (joinedAt || createdAt);
      const me = (result.members || []).find(m => m.isMe);
      const userPatch = this._getUserDisplayFromMember(me);

      getApp().globalData.roomId = roomId;
      wx.setStorageSync(JOINED_ROOM_STORAGE_KEY, roomId);

      this.setData({
        isJoinedRoom: true,
        role,
        roleLabel: isHost ? '房主' : '成员',
        roomId,
        roomName: result.workshopName || '脑暴工作坊',
        roomDesc: (result.workshopDesc || '').trim() || DEFAULT_ROOM_DESC,
        roomTimeText: this._formatTime(timeTs),
        timeLabel: isHost ? '创建时间' : '加入时间',
        ...userPatch
      });
      this._hydrateCloudAvatar(me && (me.avatarFileID || me.avatarUrl), ['userAvatarUrl']);
    } catch (err) {
      console.error('loadJoinedRoomState fail', err);
      if (roomId) {
        this._setJoinedFallbackState(roomId);
      } else {
        this._setNotJoinedState();
      }
    }
  },

  _setNotJoinedState() {
    const stored = getStoredProfile();
    this.setData({
      isJoinedRoom: false,
      role: '',
      roleLabel: '未加入房间',
      roomId: '',
      roomName: '',
      roomDesc: '',
      roomTimeText: '',
      timeLabel: '创建/加入时间',
      // 保留微信授权头像昵称，不因离开房间回到默认态
      userNickName: (stored && stored.nickName) || this.data.userNickName || '微信用户',
      userAvatarUrl: sanitizeImageSrc(
        stored && (stored.avatarFileID || stored.avatarUrl),
        this.data.userAvatarUrl || DEFAULT_AVATAR
      ) || DEFAULT_AVATAR
    });
    this._hydrateCloudAvatar(stored && (stored.avatarFileID || stored.avatarUrl), ['userAvatarUrl']);
  },

  _setJoinedFallbackState(roomId) {
    if (!roomId) {
      this._setNotJoinedState();
      return;
    }
    getApp().globalData.roomId = roomId;
    wx.setStorageSync(JOINED_ROOM_STORAGE_KEY, roomId);
    const hasKnownRole = this.data.role === 'host' || this.data.role === 'member';
    this.setData({
      isJoinedRoom: true,
      role: hasKnownRole ? this.data.role : 'member',
      roleLabel: hasKnownRole ? this.data.roleLabel : '成员',
      roomId,
      roomName: this.data.roomName || '脑暴工作坊',
      roomDesc: this.data.roomDesc || DEFAULT_ROOM_DESC,
      roomTimeText: this.data.roomTimeText || '',
      timeLabel: this.data.timeLabel === '创建/加入时间' ? '加入时间' : this.data.timeLabel
    });
  },

  _getUserDisplayFromMember(member) {
    if (!member) {
      return {
        userNickName: '微信用户',
        userAvatarUrl: DEFAULT_AVATAR
      };
    }
    const raw = member.avatarFileID || member.avatarUrl || '';
    let avatarUrl = sanitizeImageSrc(raw, '');
    if (!avatarUrl && member.avatarIndex != null) {
      avatarUrl = AVATAR_IMAGES[member.avatarIndex % AVATAR_IMAGES.length] || '';
    }
    return {
      userNickName: member.nickName || '微信用户',
      userAvatarUrl: avatarUrl || DEFAULT_AVATAR
    };
  },

  _hydrateCloudAvatar(fileID, fields) {
    if (!isCloudFileId(fileID)) return;
    const keys = Array.isArray(fields) ? fields : [fields || 'userAvatarUrl'];
    resolveCloudDisplayUrl(fileID).then((display) => {
      if (!display) return;
      const patch = {};
      keys.forEach((field) => {
        patch[field] = display;
      });
      this.setData(patch);
    }).catch((e) => {
      console.warn('hydrateCloudAvatar fail', e);
    });
  },

  _restoreUserProfile() {
    const stored = getStoredProfile();
    if (!stored) return;
    const raw = stored.avatarFileID || stored.avatarUrl || '';
    this.setData({
      userAvatarUrl: sanitizeImageSrc(raw, this.data.userAvatarUrl || DEFAULT_AVATAR) || DEFAULT_AVATAR,
      userNickName: stored.nickName || this.data.userNickName || '微信用户'
    });
    this._hydrateCloudAvatar(raw, ['userAvatarUrl']);
  },

  _markHomeProfileAuthPrompted() {
    try {
      wx.setStorageSync(HOME_PROFILE_AUTH_KEY, true);
    } catch (e) {
      // ignore
    }
  },

  _maybeShowFirstProfileAuth() {
    let prompted = false;
    try {
      prompted = wx.getStorageSync(HOME_PROFILE_AUTH_KEY) === true;
    } catch (e) {
      prompted = false;
    }
    const stored = getStoredProfile();
    if (prompted || _hasCompleteLocalProfile(stored)) {
      if (_hasCompleteLocalProfile(stored)) this._markHomeProfileAuthPrompted();
      return;
    }

    beginUserAuthFlow();
    const rawAvatar = stored && (stored.avatarFileID || stored.avatarUrl);
    this.setData({
      showProfileAuth: true,
      authDraftNick: (stored && stored.nickName) || '',
      authDraftAvatar: sanitizeImageSrc(rawAvatar, DEFAULT_AVATAR) || DEFAULT_AVATAR
    });
    this._hydrateCloudAvatar(rawAvatar, ['authDraftAvatar']);
  },

  onProfileAuthAvatarTap() {
    clearTimeout(this._authReleaseTimer);
    beginUserAuthFlow();
  },

  onProfileAuthChooseAvatar(e) {
    clearTimeout(this._authReleaseTimer);
    try {
      const profile = applyChooseAvatarEvent(e && e.detail);
      if (!profile) return;
      this.setData({
        authDraftAvatar: sanitizeImageSrc(profile.avatarUrl, DEFAULT_AVATAR) || DEFAULT_AVATAR,
        userAvatarUrl: sanitizeImageSrc(profile.avatarUrl, DEFAULT_AVATAR) || DEFAULT_AVATAR,
        userNickName: profile.nickName || this.data.authDraftNick || this.data.userNickName || '微信用户',
        authDraftNick: profile.nickName || this.data.authDraftNick || ''
      });
    } finally {
      // 弹层仍开着，保持闸门；完成/跳过时再 end
      if (!this.data.showProfileAuth) endUserAuthFlow();
    }
  },

  onProfileAuthNickInput(e) {
    const nickName = (e.detail && e.detail.value) || '';
    this.setData({ authDraftNick: nickName });
  },

  onConfirmProfileAuth() {
    clearTimeout(this._authReleaseTimer);
    const nickName = (this.data.authDraftNick || '').trim();
    const avatarUrl = this.data.authDraftAvatar || this.data.userAvatarUrl || '';
    const stored = getStoredProfile() || {};
    const next = {
      ...stored,
      nickName: nickName || stored.nickName || '微信用户',
      avatarUrl: avatarUrl && avatarUrl !== DEFAULT_AVATAR ? avatarUrl : (stored.avatarUrl || '')
    };
    if (next.avatarUrl || next.nickName) {
      saveStoredProfile(next);
    }
    this._markHomeProfileAuthPrompted();
    this.setData({
      showProfileAuth: false,
      userNickName: next.nickName || '微信用户',
      userAvatarUrl: sanitizeImageSrc(next.avatarUrl, DEFAULT_AVATAR) || DEFAULT_AVATAR
    });
    this._hydrateCloudAvatar(next.avatarUrl, ['userAvatarUrl']);
    forceEndUserAuthFlow();
  },

  onSkipProfileAuth() {
    clearTimeout(this._authReleaseTimer);
    this._markHomeProfileAuthPrompted();
    this.setData({ showProfileAuth: false });
    forceEndUserAuthFlow();
  },

  onAvatarAuthTap() {
    clearTimeout(this._authReleaseTimer);
    beginUserAuthFlow();
  },

  onChooseAvatar(e) {
    clearTimeout(this._authReleaseTimer);
    try {
      const profile = applyChooseAvatarEvent(e.detail);
      if (!profile) return;
      this.setData({
        userAvatarUrl: sanitizeImageSrc(profile.avatarUrl, DEFAULT_AVATAR) || DEFAULT_AVATAR,
        userNickName: profile.nickName || this.data.userNickName || '微信用户'
      });
    } finally {
      endUserAuthFlow();
    }
  },

  onNickNameInput(e) {
    const nickName = (e.detail && e.detail.value) || '';
    const stored = getStoredProfile() || {};
    saveStoredProfile({ ...stored, nickName });
    this.setData({ userNickName: nickName || '微信用户' });
  },

  _clearJoinedRoom(roomId) {
    const stored = wx.getStorageSync(JOINED_ROOM_STORAGE_KEY);
    if (stored === roomId) {
      wx.removeStorageSync(JOINED_ROOM_STORAGE_KEY);
    }
    if (getApp().globalData.roomId === roomId) {
      getApp().globalData.roomId = null;
    }
    this._setNotJoinedState();
  },

  _formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  _persistRoomAndRefresh(roomId) {
    getApp().globalData.roomId = roomId;
    wx.setStorageSync(JOINED_ROOM_STORAGE_KEY, roomId);
    return this.loadJoinedRoomState();
  },

  _goToRoomPage(roomId) {
    if (!roomId) return;
    getApp().globalData.roomId = roomId;
    wx.setStorageSync(JOINED_ROOM_STORAGE_KEY, roomId);
    const url = `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}`;
    return new Promise((resolve) => {
      wx.redirectTo({
        url,
        success: (result) => resolve({ ok: true, result }),
        fail: (err) => {
          console.warn('redirectTo addPlayer failed, try reLaunch', err);
          wx.reLaunch({
            url,
            success: (result) => resolve({ ok: true, result }),
            fail: (error) => resolve({ ok: false, error })
          });
        }
      });
    });
  },

  handleCreateRoom() {
    return runPageInteraction(
      this,
      () => this._handleCreateRoom(),
      { loadingText: '正在创建房间…' }
    );
  },

  async _recoverExistingRoom() {
    try {
      const current = await getRoomPageSnapshot('', { refresh: true });
      if (current && current.ok === true && current.roomId) {
        await this._goToRoomPage(current.roomId);
        return true;
      }
    } catch (error) {
      console.warn('recover existing room fail', error);
    }
    return false;
  },

  async _handleCreateRoom() {
    if (this.data.loading) return;

    this.setData({ loading: true });
    const profile = await getOptionalProfileForRoom();

    try {
      const payload = buildRoomJoinPayload(profile);
      const result = await dispatchRoomCommand('CREATE_ROOM', payload);
      const roomId = result && result.outcome && result.outcome.roomId;

      if (result.ok === false || !roomId) {
        // 创建超时或账号已有开放房间时，都以服务端当前房间为准，避免卡在首页。
        if (await this._recoverExistingRoom()) return;
        console.error('roomCreate error', result);
        wx.showToast({
          title: describeRoomCloudError(result, (result && result.errMsg) || '创建失败，请重试'),
          icon: 'none'
        });
        return;
      }

      upsertHistoryWorkshop({
        roomId,
        name: this.data.roomName || '脑暴工作坊',
        creator: this.data.userNickName,
        time: formatHistoryTime(Date.now())
      });
      await this._goToRoomPage(roomId);
    } catch (err) {
      console.error('roomCreate fail', { errMsg: err.errMsg, errCode: err.errCode });
      if (await this._recoverExistingRoom()) return;
      wx.showToast({
        title: describeRoomCloudError(err, '创建失败，请重试'),
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onDebugRoomIdInput(e) {
    const value = ((e.detail && e.detail.value) || '').replace(/\D/g, '').slice(0, 8);
    this.setData({ debugRoomIdInput: value });
  },

  handleJoinByRoomId() {
    return runPageInteraction(
      this,
      () => this._handleJoinByRoomId(),
      { loadingText: '正在加入房间…' }
    );
  },

  async _handleJoinByRoomId() {
    if (this.data.loading) return;
    const roomId = (this.data.debugRoomIdInput || '').trim();
    if (!this._isValidRoomId(roomId)) {
      wx.showToast({ title: '请输入8位房间号', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      await this._joinRoomAndGo(roomId);
    } finally {
      this.setData({ loading: false });
    }
  },

  handleScanJoin() {
    return runPageInteraction(
      this,
      () => this._handleScanJoin(),
      { loadingText: '正在扫码加入…' }
    );
  },

  async _handleScanJoin() {
    try {
      const res = await wx.scanCode({
        onlyFromCamera: true
      });
      try {
        console.log('[scanCode success]', JSON.stringify(res));
      } catch (_) {
        console.log('[scanCode success raw]', res);
      }

      if (res && res.path) {
        const handled = await this._handleMiniProgramPathScan(res.path);
        if (handled) return;
      }

      const inferredPath = this._inferPathFromScanResult(res);
      if (inferredPath) {
        const handled = await this._handleMiniProgramPathScan(inferredPath);
        if (handled) return;
      }

      const roomId = this._parseRoomIdFromScanResult(res);
      if (!this._isValidRoomId(roomId)) {
        wx.showToast({ title: '未识别到有效房间号，请扫描正确的房间码', icon: 'none' });
        return;
      }
      // 原始扫码结果只解析出了房间号，交给 addPlayer 完成唯一一次 JOIN_ROOM。
      await this._goToScanJoinRoom(roomId);
    } catch (err) {
      if (err.errMsg && err.errMsg.includes('cancel')) {
        wx.showToast({ title: '已取消扫码', icon: 'none' });
        return;
      }
      wx.showToast({
        title: err.errMsg || '扫码失败',
        icon: 'none'
      });
    }
  },

  async _handleMiniProgramPathScan(path) {
    const normalizedUrl = this._normalizeScannedPathToUrl(path);
    if (!normalizedUrl) return false;

    const roomId = this._parseRoomIdFromPath(path) || this._parseRoomId(path);
    if (this._isValidRoomId(roomId)) {
      await this._goToScanJoinRoom(roomId);
      return true;
    }

    await this._openScannedPath(normalizedUrl);
    return true;
  },

  _normalizeScannedPathToUrl(path) {
    if (!path || typeof path !== 'string') return '';
    return `/${path.replace(/^\/+/, '')}`;
  },

  _openScannedPath(url) {
    return new Promise((resolve) => {
      wx.navigateTo({
        url,
        success: () => resolve(true),
        fail: () => {
          wx.reLaunch({
            url,
            success: () => resolve(true),
            fail: () => {
              wx.showToast({ title: '扫码跳转失败', icon: 'none' });
              resolve(false);
            }
          });
        }
      });
    });
  },

  _inferPathFromScanResult(scanRes) {
    if (!scanRes || typeof scanRes !== 'object') return '';
    const result = ((scanRes.result || '') + '').trim();
    if (!result) return '';

    if (/^\/?pages\//i.test(result)) {
      return result;
    }

    const pagesMatch = result.match(/\/?pages\/[^\s"'<>]*/i);
    if (pagesMatch && pagesMatch[0]) {
      return pagesMatch[0];
    }

    try {
      const u = new URL(result);
      const pathParam = u.searchParams.get('path');
      if (pathParam && /^\/?pages\//i.test(pathParam)) {
        return pathParam;
      }
    } catch (_) {}

    if (/scene=|rid=|roomId=|\b\d{8}\b/i.test(result)) {
      const query = /[=&]/.test(result)
        ? `scene=${encodeURIComponent(result)}`
        : `scene=${encodeURIComponent(`rid=${result}`)}`;
      return `pages/main-pages/addPlayer/index?${query}`;
    }

    return '';
  },

  _isValidRoomId(roomId) {
    return /^\d{8}$/.test(roomId || '');
  },

  _parseRoomIdFromScanResult(scanRes) {
    if (!scanRes || typeof scanRes !== 'object') return '';

    const pathRoomId = this._parseRoomIdFromPath(scanRes.path || '');
    if (pathRoomId) return pathRoomId;

    const candidates = [
      scanRes.path || '',
      scanRes.result || '',
      scanRes.rawData || ''
    ];
    for (let i = 0; i < candidates.length; i++) {
      const text = (candidates[i] || '').trim();
      if (!text) continue;
      const roomId = this._parseRoomId(text);
      if (roomId) return roomId;
    }
    return '';
  },

  _parseRoomIdFromPath(path) {
    if (!path || typeof path !== 'string') return '';
    const qIndex = path.indexOf('?');
    if (qIndex < 0) return this._parseRoomId(path);
    const query = path.slice(qIndex + 1);
    const params = this._parseQuery(query);
    const roomId = (
      params.roomId ||
      params.rid ||
      this._extractRoomIdFromScene(params.scene) ||
      ''
    ).trim();
    return roomId;
  },

  _parseQuery(query) {
    const obj = {};
    if (!query || typeof query !== 'string') return obj;
    query.split('&').forEach(item => {
      if (!item) return;
      const eqIndex = item.indexOf('=');
      const key = eqIndex >= 0 ? item.slice(0, eqIndex) : item;
      const value = eqIndex >= 0 ? item.slice(eqIndex + 1) : '';
      if (!key) return;
      const safeKey = this._safeDecodeURIComponent(key);
      const safeValue = this._safeDecodeURIComponent(value);
      obj[safeKey] = safeValue;
    });
    return obj;
  },

  _safeDecodeURIComponent(value) {
    if (typeof value !== 'string') return '';
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  },

  _extractRoomIdFromScene(scene) {
    if (!scene || typeof scene !== 'string') return '';
    const decoded = this._safeDecodeURIComponent(scene);
    if (/^\d{8}$/.test(decoded)) return decoded;
    return this._parseRoomId(decoded);
  },

  _parseRoomId(content) {
    if (!content || typeof content !== 'string') return '';
    const s = content.trim();

    let m = s.match(/(?:^|[?&])rid=([^&?#\s]+)/i) || s.match(/rid=([^&?#\s]+)/i);
    if (m) return this._safeDecodeURIComponent(m[1]).trim();
    m = s.match(/(?:^|[?&])roomId=([^&?#\s]+)/i) || s.match(/roomId=([^&?#\s]+)/i);
    if (m) return this._safeDecodeURIComponent(m[1]).trim();

    const decodedCandidates = [s];
    let decoded = s;
    for (let i = 0; i < 2; i++) {
      try {
        const next = decodeURIComponent(decoded);
        if (!next || next === decoded) break;
        decodedCandidates.push(next);
        decoded = next;
      } catch (_) {
        break;
      }
    }

    for (let i = 0; i < decodedCandidates.length; i++) {
      const text = decodedCandidates[i];
      let mm = text.match(/scene=([^&?#\s]+)/i);
      if (mm) {
        const byScene = this._extractRoomIdFromScene(mm[1]);
        if (byScene) return byScene;
      }
      mm = text.match(/rid=([^&?#\s]+)/i);
      if (mm) return mm[1].trim();
      mm = text.match(/roomId=([^&?#\s]+)/i);
      if (mm) return mm[1].trim();
      mm = text.match(/\b(\d{8})\b/);
      if (mm) return mm[1];
    }

    m = s.match(/scene=([^&?#\s]+)/i);
    if (m) {
      const byScene = this._extractRoomIdFromScene(m[1]);
      if (byScene) return byScene;
    }
    m = s.match(/rid=([^&?#\s]+)/i);
    if (m) return m[1].trim();
    m = s.match(/roomId=([^&?#\s]+)/i);
    if (m) return m[1].trim();
    try {
      const url = s.startsWith('http') ? s : `https://x/?${s}`;
      const u = new URL(url);
      const rid = u.searchParams.get('rid') || u.searchParams.get('roomId');
      if (rid) return rid;
    } catch (_) {}
    if (/^\d{8}$/.test(s)) return s;
    return '';
  },

  _goToScanJoinRoom(roomId) {
    if (!roomId) return;
    // 禁止 join 前写入 joinedRoomId：否则首页 onShow / 轮询会把「未入房」误判成退出房间
    _scanJoinNavigatingRoomId = roomId;
    this._joinedStateGen = (this._joinedStateGen || 0) + 1;
    beginScanJoin(roomId);
    upsertHistoryWorkshop({
      roomId,
      name: this.data.roomName || '脑暴工作坊',
      creator: this.data.userNickName,
      time: formatHistoryTime(Date.now())
    });
    const url = `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}&fromScan=1`;
    return new Promise((resolve) => {
      wx.redirectTo({
        url,
        success: (result) => {
          // 跳转成功后短暂保留标记，避免本页 onShow 抢跑
          setTimeout(() => {
            if (_scanJoinNavigatingRoomId === roomId) _scanJoinNavigatingRoomId = '';
          }, 800);
          resolve({ ok: true, result });
        },
        fail: (err) => {
          console.warn('redirectTo addPlayer failed, try reLaunch', err);
          wx.reLaunch({
            url,
            success: (result) => resolve({ ok: true, result }),
            fail: (error) => resolve({ ok: false, error }),
            complete: () => {
              setTimeout(() => {
                if (_scanJoinNavigatingRoomId === roomId) _scanJoinNavigatingRoomId = '';
              }, 800);
            }
          });
        }
      });
    });
  },

  async _joinRoomAndGo(roomId) {
    const profile = await getOptionalProfileForRoom();

    try {
      const result = await dispatchRoomCommand(
        'JOIN_ROOM',
        buildRoomJoinPayload(profile),
        {},
        { roomId }
      );
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '加入失败', icon: 'none' });
        return;
      }

      upsertHistoryWorkshop({
        roomId,
        name: result.workshopName || '脑暴工作坊',
        creator: this.data.userNickName,
        time: formatHistoryTime(Date.now())
      });
      // 当前命令已经完成加入，直接进入大厅，避免 fromScan 再提交一次 JOIN_ROOM。
      await this._goToRoomPage(roomId);
    } catch (err) {
      wx.showToast({ title: err.errMsg || '加入失败', icon: 'none' });
    }
  },

  /* DEV_TEST_START: 输入房间号加入（测试用） */
  onDevJoinRoomIdInput(e) {
    this.setData({ devJoinRoomIdInput: (e.detail.value || '').trim() });
  },

  handleDevJoinByRoomId() {
    return runPageInteraction(
      this,
      () => this._handleDevJoinByRoomId(),
      { loadingText: '正在加入房间…' }
    );
  },

  async _handleDevJoinByRoomId() {
    const roomId = (this.data.devJoinRoomIdInput || '').trim();
    if (!this._isValidRoomId(roomId)) {
      wx.showToast({ title: '请输入8位房间号', icon: 'none' });
      return;
    }
    await this._joinRoomAndGo(roomId);
  }
  /* DEV_TEST_END */
}, [
  'onTapHistoryCard', 'onTapHistoryManage', 'onTapHistoryCancelManage',
  'onTapHistorySelectAll', 'onTapHistoryDelete',
  'handleViewRoom', 'onProfileAuthAvatarTap',
  'onProfileAuthChooseAvatar', 'onProfileAuthNickInput', 'onConfirmProfileAuth',
  'onSkipProfileAuth', 'onAvatarAuthTap', 'onChooseAvatar', 'onNickNameInput',
  'handleCreateRoom', 'onDebugRoomIdInput', 'handleJoinByRoomId', 'handleScanJoin',
  'onDevJoinRoomIdInput', 'handleDevJoinByRoomId'
]));
