const PROFILE_STORAGE_KEY = 'wxUserProfile';
const DEFAULT_AVATAR = '/assets/home/user-avatar-default.png';
const OPTIONAL_PROFILE_TIMEOUT_MS = 6000;

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
  const { dispatchRoomCommand } = require('../modules/room-session/index');
  const data = {};
  if (profile.avatarUrl) data.avatarRef = profile.avatarUrl;
  if (profile.nickName) data.nickName = profile.nickName;
  return dispatchRoomCommand('UPDATE_MEMBER_PROFILE', data, {}, { roomId });
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

function waitForOptionalProfile(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error('头像上传超时');
      error.code = 'AVATAR_UPLOAD_TIMEOUT';
      reject(error);
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getOptionalProfileForRoom(options = {}) {
  const stored = getStoredProfile();
  if (!stored || !stored.avatarUrl) return null;
  const requestedTimeoutMs = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? requestedTimeoutMs
    : OPTIONAL_PROFILE_TIMEOUT_MS;
  try {
    return await waitForOptionalProfile(prepareProfileForRoom(stored), timeoutMs);
  } catch (e) {
    console.warn('getOptionalProfileForRoom fail', e);
    return null;
  }
}

function buildRoomJoinPayload(profile) {
  const data = {};
  if (profile && profile.avatarUrl) {
    data.avatarRef = profile.avatarUrl;
    if (profile.nickName) data.nickName = profile.nickName;
  }
  return data;
}

module.exports = {
  PROFILE_STORAGE_KEY,
  DEFAULT_AVATAR,
  OPTIONAL_PROFILE_TIMEOUT_MS,
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
