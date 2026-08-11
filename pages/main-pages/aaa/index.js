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
const { AVATAR_IMAGES } = require('../../../utils/avatars');
const {
  handleRoomGoneFromResult,
  consumePendingRoomGoneToast,
  isRoomDissolvedResult
} = require('../../../utils/roomDissolved');
const {
  beginUserAuthFlow,
  endUserAuthFlow,
  forceEndUserAuthFlow,
  isUserAuthInProgress
} = require('../../../utils/userAuthSession');

/** 扫码跳转中：避免 onShow 用未 join 的 roomId 误踢 */
let _scanJoinNavigatingRoomId = '';

function _hasCompleteLocalProfile(stored) {
  if (!stored) return false;
  const nick = (stored.nickName || '').trim();
  const hasNick = !!nick && nick !== '微信用户';
  const hasAvatar = !!(stored.avatarUrl || stored.avatarFileID);
  return hasNick && hasAvatar;
}

Page({
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
    showProfileAuth: false,
    authDraftNick: '',
    authDraftAvatar: DEFAULT_AVATAR
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
    if (_scanJoinNavigatingRoomId) return;
    this.loadJoinedRoomState();
  },

  handleViewRoom() {
    const { roomId } = this.data;
    if (!roomId) {
      wx.showToast({ title: '房间信息缺失', icon: 'none' });
      return;
    }
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
    wx.navigateTo({
      url: `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}&stayLobby=1`
    });
  },

  async loadJoinedRoomState() {
    if (_scanJoinNavigatingRoomId) return;

    const roomId = wx.getStorageSync(JOINED_ROOM_STORAGE_KEY)
      || getApp().globalData.roomId
      || '';

    if (!roomId) {
      this._setNotJoinedState();
      return;
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};

      if (result.ok !== true) {
        // 断线重连：房间已解散/不存在 → 清状态并提示，勿恢复进房
        if (isRoomDissolvedResult(result) || result.errCode === 'NOT_IN_ROOM') {
          handleRoomGoneFromResult(result, roomId, {
            allowToastOnHome: true,
            title: isRoomDissolvedResult(result) ? '房间已解散' : '您已不在该房间'
          });
          this._setNotJoinedState();
          return;
        }
        this._clearJoinedRoom(roomId);
        this._setNotJoinedState();
        return;
      }

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
    } catch (err) {
      console.error('loadJoinedRoomState fail', err);
      if (roomId) {
        this.setData({
          isJoinedRoom: true,
          role: 'member',
          roleLabel: '成员',
          roomId,
          roomName: '脑暴工作坊',
          roomDesc: DEFAULT_ROOM_DESC,
          roomTimeText: '',
          timeLabel: '加入时间'
        });
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
      userAvatarUrl: (stored && stored.avatarUrl) || this.data.userAvatarUrl || DEFAULT_AVATAR
    });
  },

  _getUserDisplayFromMember(member) {
    if (!member) {
      return {
        userNickName: '微信用户',
        userAvatarUrl: DEFAULT_AVATAR
      };
    }
    let avatarUrl = member.avatarUrl || '';
    if (!avatarUrl && member.avatarIndex != null) {
      avatarUrl = AVATAR_IMAGES[member.avatarIndex % AVATAR_IMAGES.length] || '';
    }
    return {
      userNickName: member.nickName || '微信用户',
      userAvatarUrl: avatarUrl || DEFAULT_AVATAR
    };
  },

  _restoreUserProfile() {
    const stored = getStoredProfile();
    if (!stored) return;
    this.setData({
      userAvatarUrl: stored.avatarUrl || this.data.userAvatarUrl || DEFAULT_AVATAR,
      userNickName: stored.nickName || this.data.userNickName || '微信用户'
    });
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
    this.setData({
      showProfileAuth: true,
      authDraftNick: (stored && stored.nickName) || '',
      authDraftAvatar: (stored && stored.avatarUrl) || DEFAULT_AVATAR
    });
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
        authDraftAvatar: profile.avatarUrl,
        userAvatarUrl: profile.avatarUrl,
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
      userAvatarUrl: next.avatarUrl || DEFAULT_AVATAR
    });
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
        userAvatarUrl: profile.avatarUrl,
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
    wx.redirectTo({
      url,
      fail: (err) => {
        console.warn('redirectTo addPlayer failed, try reLaunch', err);
        wx.reLaunch({ url });
      }
    });
  },

  async handleCreateRoom() {
    if (this.data.loading) return;

    this.setData({ loading: true });
    const clientCreateId = `client-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const profile = await getOptionalProfileForRoom();

    try {
      const res = await wx.cloud.callFunction({
        name: 'roomCreate',
        data: buildRoomJoinPayload(profile, { clientCreateId })
      });

      const result = (res && res.result) || {};
      const roomId = result.roomId || (result.data && result.data.roomId);

      if (result.ok === false || !roomId) {
        console.error('roomCreate error', result);
        wx.showToast({
          title: result.errMsg || '创建失败，请重试',
          icon: 'none'
        });
        return;
      }

      this._goToRoomPage(roomId);
    } catch (err) {
      console.error('roomCreate fail', { errMsg: err.errMsg, errCode: err.errCode });
      wx.showToast({
        title: err.errMsg || '创建失败，请重试',
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

  async handleJoinByRoomId() {
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

  async handleScanJoin() {
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
    const url = `/pages/main-pages/addPlayer/index?roomId=${encodeURIComponent(roomId)}&fromScan=1`;
    wx.redirectTo({
      url,
      success: () => {
        // 跳转成功后短暂保留标记，避免本页 onShow 抢跑
        setTimeout(() => {
          if (_scanJoinNavigatingRoomId === roomId) _scanJoinNavigatingRoomId = '';
        }, 800);
      },
      fail: (err) => {
        console.warn('redirectTo addPlayer failed, try reLaunch', err);
        wx.reLaunch({
          url,
          complete: () => {
            setTimeout(() => {
              if (_scanJoinNavigatingRoomId === roomId) _scanJoinNavigatingRoomId = '';
            }, 800);
          }
        });
      }
    });
  },

  async _joinRoomAndGo(roomId) {
    const profile = await getOptionalProfileForRoom();

    wx.showLoading({ title: '加入中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'roomJoin',
        data: buildRoomJoinPayload(profile, { roomId })
      });
      const result = (res && res.result) || {};
      wx.hideLoading();
      if (result.ok !== true) {
        wx.showToast({ title: result.errMsg || '加入失败', icon: 'none' });
        return;
      }

      this._goToRoomPage(roomId);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.errMsg || '加入失败', icon: 'none' });
    }
  },

  /* DEV_TEST_START: 输入房间号加入（测试用） */
  onDevJoinRoomIdInput(e) {
    this.setData({ devJoinRoomIdInput: (e.detail.value || '').trim() });
  },

  async handleDevJoinByRoomId() {
    const roomId = (this.data.devJoinRoomIdInput || '').trim();
    if (!this._isValidRoomId(roomId)) {
      wx.showToast({ title: '请输入8位房间号', icon: 'none' });
      return;
    }
    await this._joinRoomAndGo(roomId);
  }
  /* DEV_TEST_END */
});
