const {
  DEFAULT_AVATAR,
  isCloudFileId,
  isLocalTempAvatar,
  isShareableAvatarUrl
} = require('./wxUserAvatar');

/** 本地随机头像池，按 avatarIndex 分配（房间内不重复） */
const AVATAR_IMAGES = [
  '/assets/avatar/frame_2085662311_1x.webp',
  '/assets/avatar/frame_2085662312_1x.webp',
  '/assets/avatar/frame_2085662313_1x.webp',
  '/assets/avatar/frame_2085662314_1x.webp',
  '/assets/avatar/frame_2085662315_1x.webp',
  '/assets/avatar/frame_2085662316_1x.webp',
  '/assets/avatar/frame_2085662317_1x.webp',
  '/assets/avatar/frame_2085662318_1x.webp',
  '/assets/avatar/frame_2085662319_1x.webp'
];

function pickFallbackAvatarImage(member, index) {
  const idx =
    member && member.avatarIndex != null
      ? member.avatarIndex
      : index % AVATAR_IMAGES.length;
  return AVATAR_IMAGES[idx % AVATAR_IMAGES.length] || DEFAULT_AVATAR;
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
      }
    });
    return list.map((m) => {
      if (m && isCloudFileId(m.avatarUrl) && urlMap[m.avatarUrl]) {
        return { ...m, avatarUrl: urlMap[m.avatarUrl] };
      }
      // 转换失败的 cloud:// 或本机临时路径不能给他人展示
      if (m && (isCloudFileId(m.avatarUrl) || isLocalTempAvatar(m.avatarUrl))) {
        return { ...m, avatarUrl: null };
      }
      return m;
    });
  } catch (e) {
    console.warn('resolveCloudAvatarUrls failed', e);
    return list.map((m) => {
      if (m && (isCloudFileId(m.avatarUrl) || isLocalTempAvatar(m.avatarUrl))) {
        return { ...m, avatarUrl: null };
      }
      return m;
    });
  }
}

/** 为成员列表补充 avatarImage（优先可共享微信头像，否则按 avatarIndex 映射随机头像） */
function assignAvatarImages(members) {
  return (members || []).map((m, i) => {
    if (!m) return m;
    // 本人可用本机临时路径；其他人必须用可共享 URL，否则回退随机头像
    const canUseUrl =
      m.avatarUrl &&
      (m.isMe === true || isShareableAvatarUrl(m.avatarUrl));
    if (canUseUrl) {
      return { ...m, avatarImage: m.avatarUrl };
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
  resolveCloudAvatarUrls,
  assignAvatarImages,
  buildAvatarList
};
