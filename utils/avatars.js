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
/**
 * 玩家已授权头像的展示 URL。
 * value: { url, stableKey, savedAt }
 * 过期后改用最新临时链，避免粘性旧签名导致裂图。
 */
const stickyCustomAvatarByUser = new Map();
/** 云临时链粘性最长复用时间（签名通常约 2h，提前刷新） */
const STICKY_MAX_AGE_MS = 50 * 60 * 1000;

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
    const noQuery = q >= 0 ? url.slice(0, q) : url;
    // 云存储临时链换 CDN 主机时路径不变，去掉 host 才能命中粘性、避免整页重绘裂图
    const hostStart = noQuery.indexOf('://');
    if (hostStart < 0) return noQuery;
    const pathStart = noQuery.indexOf('/', hostStart + 3);
    return pathStart >= 0 ? noQuery.slice(pathStart) : noQuery;
  }
  return url;
}

function isPackagedAvatar(url) {
  return typeof url === 'string' && (url.startsWith('/assets/') || url === DEFAULT_AVATAR);
}

function isCustomDisplayAvatar(url) {
  return isDisplayableAvatarUrl(url) && !isPackagedAvatar(url);
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

function _readSticky(userKey) {
  if (!userKey || !stickyCustomAvatarByUser.has(userKey)) return null;
  const raw = stickyCustomAvatarByUser.get(userKey);
  if (!raw) return null;
  if (typeof raw === 'string') {
    return { url: raw, stableKey: getAvatarStableKey(raw), savedAt: 0 };
  }
  return raw;
}

function _writeSticky(userKey, url) {
  if (!userKey || !isCustomDisplayAvatar(url)) return;
  stickyCustomAvatarByUser.set(userKey, {
    url,
    stableKey: getAvatarStableKey(url),
    savedAt: Date.now()
  });
}

function _readStickyForMember(member) {
  const userKey = getMemberAvatarUserKey(member);
  const byUser = _readSticky(userKey);
  if (byUser && isCustomDisplayAvatar(byUser.url)) return byUser;
  if (member && member.playerIndex != null) {
    const bySeat = _readSticky(`p${member.playerIndex}`);
    if (bySeat && isCustomDisplayAvatar(bySeat.url)) return bySeat;
  }
  return byUser;
}

function _writeStickyForMember(member, url) {
  if (!isCustomDisplayAvatar(url)) return;
  const userKey = getMemberAvatarUserKey(member);
  _writeSticky(userKey, url);
  if (member && member.playerIndex != null) {
    _writeSticky(`p${member.playerIndex}`, url);
  }
}

/** 加载失败时清掉该用户粘性，避免一直挂坏链 */
function clearStickyAvatar(userKey) {
  if (userKey == null || userKey === '') return;
  const key = String(userKey);
  stickyCustomAvatarByUser.delete(key);
  if (/^\d+$/.test(key)) {
    stickyCustomAvatarByUser.delete(`p${key}`);
  } else if (/^p\d+$/i.test(key)) {
    stickyCustomAvatarByUser.delete(key.slice(1));
  }
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
      // 转换失败：保留 cloud:// 由 sticky / 回退兜底，避免直接抹成 null 造成「消失」
      return m;
    });
  } catch (e) {
    console.warn('resolveCloudAvatarUrls failed', e);
    return list.map((m) => {
      if (!m || !isCloudFileId(m.avatarUrl)) return m;
      const cached = cloudTempUrlCache.get(m.avatarUrl);
      if (cached) return { ...m, avatarUrl: cached };
      return m;
    });
  }
}

/** 为成员列表补充 avatarImage（优先可共享微信头像，否则按 avatarIndex 映射随机头像） */
function assignAvatarImages(members) {
  const now = Date.now();
  return (members || []).map((m, i) => {
    if (!m) return m;
    const sticky = _readStickyForMember(m);
    // 包内占位图不得当作自定义头像写入粘性，否则会把已设置头像盖掉
    const canUseUrl =
      isCustomDisplayAvatar(m.avatarUrl) &&
      (m.isMe === true || isShareableAvatarUrl(m.avatarUrl) || isLocalTempAvatar(m.avatarUrl));
    if (canUseUrl) {
      const incoming = m.avatarUrl;
      const incomingKey = getAvatarStableKey(incoming);
      // 稳定键相同且粘性未过期：复用旧 URL，避免轮询换签名/CDN 主机闪烁；过期则改用最新链
      if (
        sticky &&
        isCustomDisplayAvatar(sticky.url) &&
        sticky.stableKey === incomingKey &&
        sticky.savedAt > 0 &&
        now - sticky.savedAt < STICKY_MAX_AGE_MS
      ) {
        return { ...m, avatarUrl: sticky.url, avatarImage: sticky.url };
      }
      _writeStickyForMember(m, incoming);
      return { ...m, avatarImage: incoming };
    }
    if (sticky && isCustomDisplayAvatar(sticky.url)) {
      return { ...m, avatarImage: sticky.url };
    }
    return { ...m, avatarImage: pickFallbackAvatarImage(m, i) };
  });
}

/**
 * 新快照变成占位图时，保留上一帧已成功展示的自定义头像。
 * 一轮结束整页 setData / 临时链失败时，避免把已设置头像打回默认图。
 */
function preserveMemberAvatars(nextMembers, prevMembers) {
  const prevByUser = new Map();
  const prevBySeat = new Map();
  (prevMembers || []).forEach((m) => {
    if (!m) return;
    const url = m.avatarImage || m.avatarUrl || '';
    if (!isCustomDisplayAvatar(url)) return;
    const userKey = getMemberAvatarUserKey(m);
    if (userKey) prevByUser.set(userKey, url);
    if (m.playerIndex != null) prevBySeat.set(String(m.playerIndex), url);
  });
  return (nextMembers || []).map((m) => {
    if (!m) return m;
    const current = m.avatarImage || m.avatarUrl || '';
    if (isCustomDisplayAvatar(current)) return m;
    const userKey = getMemberAvatarUserKey(m);
    const preserved = (userKey && prevByUser.get(userKey))
      || (m.playerIndex != null ? prevBySeat.get(String(m.playerIndex)) : '');
    if (!preserved) return m;
    _writeStickyForMember(m, preserved);
    return { ...m, avatarImage: preserved };
  });
}

function memberHasCloudAvatar(member) {
  return !!(member && isCloudFileId(member.avatarUrl));
}

/**
 * 展示前统一入口：先 resolve cloud://，再 assign 粘性/回退。
 * 各页轮询/首屏应优先走这里，避免只 assign 漏转临时链。
 */
async function prepareMembersForDisplay(members) {
  const resolved = await resolveCloudAvatarUrls(members || []);
  return assignAvatarImages(resolved);
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

async function buildAvatarListAsync(members) {
  const enriched = await prepareMembersForDisplay(members);
  return buildAvatarList(enriched);
}

module.exports = {
  AVATAR_IMAGES,
  DEFAULT_AVATAR,
  getAvatarStableKey,
  getMemberAvatarFingerprint,
  getMemberAvatarUserKey,
  resolveCloudAvatarUrls,
  assignAvatarImages,
  preserveMemberAvatars,
  memberHasCloudAvatar,
  pickFallbackAvatarImage,
  prepareMembersForDisplay,
  clearStickyAvatar,
  buildAvatarList,
  buildAvatarListAsync
};
