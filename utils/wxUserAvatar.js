const PROFILE_STORAGE_KEY = 'wxUserProfile';
const DEFAULT_AVATAR = '/assets/home/user-avatar-default.svg';

function getStoredProfile() {
  try {
    return wx.getStorageSync(PROFILE_STORAGE_KEY) || null;
  } catch (e) {
    return null;
  }
}

function saveStoredProfile(profile) {
  if (!profile) return;
  try {
    wx.setStorageSync(PROFILE_STORAGE_KEY, profile);
  } catch (e) {
    console.warn('saveStoredProfile failed', e);
  }
}

function isCloudFileId(path) {
  return typeof path === 'string' && path.startsWith('cloud://');
}

/** chooseAvatar 等产生的本机临时路径，仅当前设备可加载，不能写入房间给他人看 */
function isLocalTempAvatar(path) {
  if (typeof path !== 'string' || !path) return false;
  const lower = path.toLowerCase();
  return (
    lower.startsWith('wxfile://') ||
    lower.startsWith('file://') ||
    lower.startsWith('http://tmp/') ||
    lower.startsWith('https://tmp/') ||
    lower.indexOf('://tmp/') !== -1
  );
}

function isRemoteUrl(path) {
  return (
    typeof path === 'string' &&
    (path.startsWith('http://') || path.startsWith('https://')) &&
    !isLocalTempAvatar(path)
  );
}

/** 他人设备也可展示的头像地址（cloud fileID / 公网 https / 包内资源） */
function isShareableAvatarUrl(path) {
  if (typeof path !== 'string' || !path) return false;
  if (isLocalTempAvatar(path)) return false;
  if (isCloudFileId(path)) return true;
  if (path.startsWith('/')) return true;
  return isRemoteUrl(path);
}

async function uploadAvatarToCloud(tempFilePath) {
  if (!tempFilePath) return '';
  if (isCloudFileId(tempFilePath)) return tempFilePath;

  const extMatch = tempFilePath.match(/\.(\w+)(?:\?|$)/);
  const ext = (extMatch && extMatch[1]) || 'png';
  const cloudPath = `avatars/${Date.now()}_${Math.floor(Math.random() * 1000000)}.${ext}`;
  const uploadRes = await wx.cloud.uploadFile({
    cloudPath,
    filePath: tempFilePath
  });
  return (uploadRes && uploadRes.fileID) || '';
}

/**
 * 将本地缓存的头像（含 chooseAvatar 临时路径）上传云存储，供房间成员写入 avatarUrl
 */
async function prepareProfileForRoom(localProfile) {
  const profile = localProfile || getStoredProfile();
  if (!profile || !profile.avatarUrl) return null;

  const nickName = (profile.nickName || '').trim();
  let avatarUrl = profile.avatarFileID || profile.avatarUrl;

  // 已有云 fileID 可直接用；本机临时路径 / 非公网地址必须上传后才能给其他成员看
  if (!isCloudFileId(avatarUrl) && (isLocalTempAvatar(avatarUrl) || !isRemoteUrl(avatarUrl))) {
    avatarUrl = await uploadAvatarToCloud(avatarUrl);
  }

  if (!avatarUrl || isLocalTempAvatar(avatarUrl)) return null;

  const nextProfile = {
    ...profile,
    nickName,
    avatarUrl,
    avatarFileID: isCloudFileId(avatarUrl) ? avatarUrl : profile.avatarFileID || ''
  };
  saveStoredProfile(nextProfile);

  return {
    nickName: nickName || '',
    avatarUrl
  };
}

async function syncRoomMemberProfile(roomId, profile) {
  if (!roomId || !profile) return null;
  const data = { roomId };
  if (profile.avatarUrl) data.avatarUrl = profile.avatarUrl;
  if (profile.nickName) data.nickName = profile.nickName;

  const res = await wx.cloud.callFunction({
    name: 'updateRoomMemberProfile',
    data
  });
  return (res && res.result) || {};
}

function applyChooseAvatarEvent(detail) {
  const avatarUrl = detail && detail.avatarUrl;
  if (!avatarUrl) return null;

  const stored = getStoredProfile() || {};
  const next = {
    ...stored,
    avatarUrl,
    avatarFileID: isCloudFileId(avatarUrl) ? avatarUrl : ''
  };
  saveStoredProfile(next);
  return next;
}

async function getOptionalProfileForRoom() {
  const stored = getStoredProfile();
  if (!stored || !stored.avatarUrl) return null;
  try {
    return await prepareProfileForRoom(stored);
  } catch (e) {
    console.warn('getOptionalProfileForRoom fail', e);
    return null;
  }
}

function buildRoomJoinPayload(profile, extra = {}) {
  const data = { ...extra };
  if (profile && profile.avatarUrl) {
    data.avatarUrl = profile.avatarUrl;
    if (profile.nickName) data.nickName = profile.nickName;
  }
  return data;
}

module.exports = {
  PROFILE_STORAGE_KEY,
  DEFAULT_AVATAR,
  getStoredProfile,
  saveStoredProfile,
  uploadAvatarToCloud,
  prepareProfileForRoom,
  getOptionalProfileForRoom,
  buildRoomJoinPayload,
  syncRoomMemberProfile,
  applyChooseAvatarEvent,
  isCloudFileId,
  isLocalTempAvatar,
  isRemoteUrl,
  isShareableAvatarUrl
};
