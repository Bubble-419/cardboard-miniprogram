const {
  DEFAULT_AVATAR,
  isCloudFileId,
  isLocalTempAvatar,
  isShareableAvatarUrl,
  isRemoteUrl
} = require('./wxUserAvatar');

/** 本地随机头像池，按 avatarIndex 分配（房间内不重复） */
/** PNG：真机对带 ICC+Alpha 的 VP8X WebP 常解码失败 */
const AVATAR_IMAGES = [
  '/assets/avatar/frame_2085662311_1x.png',
  '/assets/avatar/frame_2085662312_1x.png',
  '/assets/avatar/frame_2085662313_1x.png',
  '/assets/avatar/frame_2085662314_1x.png',
  '/assets/avatar/frame_2085662315_1x.png',
  '/assets/avatar/frame_2085662316_1x.png',
  '/assets/avatar/frame_2085662317_1x.png',
  '/assets/avatar/frame_2085662318_1x.png',
  '/assets/avatar/frame_2085662319_1x.png'
];

/**
 * cloud fileID -> 最近一次可用的 HTTPS 临时链
 * 仅用于减少重复 getTempFileURL；展示时仍以当前成员 avatarUrl 为准
 */
const cloudTempUrlCache = new Map();
/** 玩家已授权头像的展示 URL，避免轮询短暂丢链时回退随机头像 */
const stickyCustomAvatarByUser = new Map();

function getMemberAvatarUserKey(member) {
  if (!member) return '';
  if (member.userId) return String(member.userId);
  if (member.openid) return String(member.openid);
  if (member.playerIndex != null) return `p${member.playerIndex}`;
  return '';
}

/** 用于比对的稳定键：忽略临时链接 query 签名，避免轮询 setData 闪烁 */
function getAvatarStableKey(url) {
  if (!url || typeof url !== 'string') return '';
  if (isCloudFileId(url)) return url;
  if (isLocalTempAvatar(url)) return url;
  if (url.startsWith('/')) return url;
  if (isRemoteUrl(url)) {
    const q = url.indexOf('?');
    return q >= 0 ? url.slice(0, q) : url;
  }
  return url;
}

function getMemberAvatarFingerprint(member) {
  if (!member) return '-';
  const customKey = getAvatarStableKey(member.avatarUrl || member.avatarImage || '');
  if (customKey && !customKey.startsWith('/assets/avatar/') && customKey !== DEFAULT_AVATAR) {
    return `custom:${customKey}`;
  }
  return `fallback:${member.avatarIndex != null ? member.avatarIndex : ''}`;
}

function pickFallbackAvatarImage(member, index) {
  const idx =
    member && member.avatarIndex != null
      ? member.avatarIndex
      : index % AVATAR_IMAGES.length;
  return AVATAR_IMAGES[idx % AVATAR_IMAGES.length] || DEFAULT_AVATAR;
}

/** 是否可直接给 <image> 使用（cloud:// 不行） */
function isDisplayableAvatarUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (isCloudFileId(url)) return false;
  return isLocalTempAvatar(url) || isShareableAvatarUrl(url);
}

/**
 * 将成员列表中的 cloud:// 头像 fileID 批量转为可展示的 HTTPS 临时链接
 * （跨账号/跨用户无法直接加载他人上传的 cloud:// 路径）
 */
async function resolveCloudAvatarUrls(members) {
  const list = members || [];
  const fileIds = [];
  list.forEach((m) => {
    const url = m && m.avatarUrl;
    if (isCloudFileId(url) && !fileIds.includes(url)) {
      fileIds.push(url);
    }
  });
  if (!fileIds.length) return list;

  try {
    const res = await wx.cloud.getTempFileURL({ fileList: fileIds });
    const urlMap = {};
    (res.fileList || []).forEach((item) => {
      if (item.fileID && item.tempFileURL) {
        urlMap[item.fileID] = item.tempFileURL;
        cloudTempUrlCache.set(item.fileID, item.tempFileURL);
      }
    });
    return list.map((m) => {
      if (!m || !isCloudFileId(m.avatarUrl)) return m;
      if (urlMap[m.avatarUrl]) {
        return { ...m, avatarUrl: urlMap[m.avatarUrl] };
      }
      const cached = cloudTempUrlCache.get(m.avatarUrl);
      if (cached) return { ...m, avatarUrl: cached };
      // 转换失败：清掉不可展示的 cloud://，交给 assign 回退随机/粘性头像
      return { ...m, avatarUrl: null };
    });
  } catch (e) {
    console.warn('resolveCloudAvatarUrls failed', e);
    return list.map((m) => {
      if (!m || !isCloudFileId(m.avatarUrl)) return m;
      const cached = cloudTempUrlCache.get(m.avatarUrl);
      if (cached) return { ...m, avatarUrl: cached };
      return { ...m, avatarUrl: null };
    });
  }
}

/** 为成员列表补充 avatarImage（优先可共享微信头像，否则按 avatarIndex 映射随机头像） */
function assignAvatarImages(members) {
  return (members || []).map((m, i) => {
    if (!m) return m;
    const userKey = getMemberAvatarUserKey(m);
    // 本人可用本机临时路径；其他人必须用可共享且可展示的 URL
    const canUseUrl =
      isDisplayableAvatarUrl(m.avatarUrl) &&
      (m.isMe === true || isShareableAvatarUrl(m.avatarUrl) || isLocalTempAvatar(m.avatarUrl));
    if (canUseUrl) {
      // 临时链签名每轮变化；稳定键相同则复用旧 URL，避免 <image src> 重载闪烁
      if (userKey) {
        const sticky = stickyCustomAvatarByUser.get(userKey);
        if (sticky && getAvatarStableKey(sticky) === getAvatarStableKey(m.avatarUrl)) {
          return { ...m, avatarImage: sticky };
        }
        stickyCustomAvatarByUser.set(userKey, m.avatarUrl);
      }
      return { ...m, avatarImage: m.avatarUrl };
    }
    if (userKey && stickyCustomAvatarByUser.has(userKey)) {
      const sticky = stickyCustomAvatarByUser.get(userKey);
      if (isDisplayableAvatarUrl(sticky)) {
        return { ...m, avatarImage: sticky };
      }
    }
    return { ...m, avatarImage: pickFallbackAvatarImage(m, i) };
  });
}

/** 供 selectProblem / selectMode 等页面的头像条使用 */
function buildAvatarList(members) {
  return assignAvatarImages(members)
    .filter((m) => !!m)
    .map((m) => ({
      id: m.userId || String(m.playerIndex),
      nickName: m.nickName || `玩家${m.playerIndex}`,
      avatar: m.avatarImage,
      avatarImage: m.avatarImage,
      isMe: m.isMe === true
    }));
}

module.exports = {
  AVATAR_IMAGES,
  DEFAULT_AVATAR,
  getAvatarStableKey,
  getMemberAvatarFingerprint,
  resolveCloudAvatarUrls,
  assignAvatarImages,
  buildAvatarList
};
