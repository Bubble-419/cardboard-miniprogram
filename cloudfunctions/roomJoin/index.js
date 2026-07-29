const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

const AVATAR_COLORS = ['#5EC159', '#4A90E2', '#E24A4A', '#E2B84A', '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB'];
const AVATAR_INDEX_MAX = 8;

function isLocalTempAvatar(url) {
  if (typeof url !== 'string' || !url) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith('wxfile://') ||
    lower.startsWith('file://') ||
    lower.startsWith('http://tmp/') ||
    lower.startsWith('https://tmp/') ||
    lower.indexOf('://tmp/') !== -1
  );
}

function normalizeShareableAvatarUrl(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.trim()) return null;
  const trimmed = avatarUrl.trim();
  // 拒绝本机临时路径，避免其他成员无法加载
  if (isLocalTempAvatar(trimmed)) return null;
  return trimmed;
}

function pickAvatarColor(usedColors) {
  const available = AVATAR_COLORS.filter(c => !usedColors.includes(c));
  return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : AVATAR_COLORS[0];
}

function pickAvatarIndex(usedIndices) {
  const used = new Set(usedIndices.filter(i => i >= 0 && i <= AVATAR_INDEX_MAX));
  const available = [];
  for (let i = 0; i <= AVATAR_INDEX_MAX; i++) {
    if (!used.has(i)) available.push(i);
  }
  return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : 0;
}

function getUsedAvatarIndices(members) {
  return (members || [])
    .filter(m => !m.avatarUrl && m.avatarIndex != null)
    .map(m => m.avatarIndex);
}

exports.main = async (event, context) => {
  const { roomId, avatarUrl, nickName: clientNickName } = event || {};
  const normalizedAvatarUrl = normalizeShareableAvatarUrl(avatarUrl);
  const normalizedNickName = typeof clientNickName === 'string' && clientNickName.trim()
    ? clientNickName.trim()
    : '';

  if (!roomId || typeof roomId !== 'string') {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId is required'
    };
  }

  const wxContext = cloud.getWXContext();
  // 跨账号共享时调用方用户需用 FROM_OPENID
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      return {
        ok: false,
        errCode: 'ROOM_NOT_FOUND',
        errMsg: '房间不存在'
      };
    }

    const existing = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();

    if (existing.data && existing.data.length > 0) {
      const m = existing.data[0];
      const updateData = {};
      if (normalizedAvatarUrl && normalizedAvatarUrl !== m.avatarUrl) {
        updateData.avatarUrl = normalizedAvatarUrl;
      }
      if (normalizedNickName && normalizedNickName !== m.nickName) {
        updateData.nickName = normalizedNickName;
      }
      if (Object.keys(updateData).length > 0) {
        await db.collection(ROOM_MEMBERS_COLLECTION).doc(m._id).update({ data: updateData });
      }
      return {
        ok: true,
        playerIndex: m.playerIndex,
        nickName: updateData.nickName || m.nickName || `玩家${m.playerIndex}`,
        avatarColor: m.avatarColor || AVATAR_COLORS[0],
        avatarUrl: updateData.avatarUrl || m.avatarUrl || null,
        avatarIndex: m.avatarIndex != null ? m.avatarIndex : null,
        role: m.role
      };
    }

    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .orderBy('playerIndex', 'asc')
      .get();

    const members = membersRes.data || [];
    const usedColors = members.map(m => m.avatarColor).filter(Boolean);
    const nextIndex = members.length + 1;
    const avatarColor = pickAvatarColor(usedColors);
    const nickName = normalizedNickName || `玩家${nextIndex}`;
    const avatarIndex = normalizedAvatarUrl
      ? null
      : pickAvatarIndex(getUsedAvatarIndices(members));
    const now = Date.now();

    await db.collection(ROOM_MEMBERS_COLLECTION).add({
      data: {
        roomId,
        userId: currentUserId,
        role: 'PLAYER',
        nickName,
        avatarUrl: normalizedAvatarUrl,
        avatarColor,
        avatarIndex,
        joinedAt: now,
        lastSeenAt: now,
        playerIndex: nextIndex
      }
    });

    return {
      ok: true,
      playerIndex: nextIndex,
      nickName,
      avatarColor,
      avatarUrl: normalizedAvatarUrl,
      avatarIndex,
      role: 'PLAYER'
    };
  } catch (e) {
    console.error('roomJoin error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'ROOM_JOIN_ERROR',
      errMsg: e.errMsg || e.message || '加入房间失败'
    };
  }
};
