const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

const MAX_SEATS = 6;
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

/** 从 1..6 中分配最小空闲席位；已满则返回 null */
function allocateSeatNo(members) {
  const used = new Set(
    (members || [])
      .map((m) => parseInt(m && m.playerIndex, 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= MAX_SEATS)
  );
  for (let seat = 1; seat <= MAX_SEATS; seat += 1) {
    if (!used.has(seat)) return seat;
  }
  return null;
}

function collectCallerUserIds(wxContext) {
  const ids = [];
  const fromOpenid = wxContext && wxContext.FROM_OPENID;
  const openid = wxContext && wxContext.OPENID;
  if (fromOpenid) ids.push(String(fromOpenid));
  if (openid && ids.indexOf(String(openid)) === -1) ids.push(String(openid));
  return ids;
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
  const callerIds = collectCallerUserIds(wxContext);
  const currentUserId = callerIds[0];
  if (!currentUserId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  try {
    // 幂等：已在房间则只刷新资料，不占新席位（兼容 FROM_OPENID / OPENID）
    const existing = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({
        roomId,
        userId: callerIds.length > 1 ? _.in(callerIds) : currentUserId
      })
      .limit(1)
      .get();

    if (existing.data && existing.data.length > 0) {
      const m = existing.data[0];
      const updateData = { lastSeenAt: Date.now() };
      if (normalizedAvatarUrl && normalizedAvatarUrl !== m.avatarUrl) {
        updateData.avatarUrl = normalizedAvatarUrl;
      }
      if (normalizedNickName && normalizedNickName !== m.nickName) {
        updateData.nickName = normalizedNickName;
      }
      await db.collection(ROOM_MEMBERS_COLLECTION).doc(m._id).update({ data: updateData });
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

    const joinResult = await db.runTransaction(async (transaction) => {
      const roomRes = await transaction
        .collection(ROOMS_COLLECTION)
        .where({ roomId })
        .limit(1)
        .get();
      if (!roomRes.data || roomRes.data.length === 0) {
        const err = new Error('房间不存在');
        err.errCode = 'ROOM_NOT_FOUND';
        throw err;
      }
      const room = roomRes.data[0];
      if (room.status === 'DISSOLVED') {
        const err = new Error('房间已解散');
        err.errCode = 'ROOM_DISSOLVED';
        throw err;
      }

      const again = await transaction
        .collection(ROOM_MEMBERS_COLLECTION)
        .where({
          roomId,
          userId: callerIds.length > 1 ? _.in(callerIds) : currentUserId
        })
        .limit(1)
        .get();
      if (again.data && again.data.length > 0) {
        return { already: true, member: again.data[0] };
      }

      const membersRes = await transaction
        .collection(ROOM_MEMBERS_COLLECTION)
        .where({ roomId })
        .get();
      const members = membersRes.data || [];
      if (members.length >= MAX_SEATS) {
        const err = new Error('房间已满');
        err.errCode = 'ROOM_FULL';
        throw err;
      }

      const nextIndex = allocateSeatNo(members);
      if (nextIndex == null) {
        const err = new Error('房间已满');
        err.errCode = 'ROOM_FULL';
        throw err;
      }

      const usedColors = members.map(m => m.avatarColor).filter(Boolean);
      const avatarColor = pickAvatarColor(usedColors);
      const nickName = normalizedNickName || `玩家${nextIndex}`;
      const avatarIndex = normalizedAvatarUrl
        ? null
        : pickAvatarIndex(getUsedAvatarIndices(members));
      const now = Date.now();

      await transaction.collection(ROOM_MEMBERS_COLLECTION).add({
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
        already: false,
        playerIndex: nextIndex,
        nickName,
        avatarColor,
        avatarUrl: normalizedAvatarUrl,
        avatarIndex,
        role: 'PLAYER'
      };
    });

    if (joinResult.already && joinResult.member) {
      const m = joinResult.member;
      return {
        ok: true,
        playerIndex: m.playerIndex,
        nickName: m.nickName || `玩家${m.playerIndex}`,
        avatarColor: m.avatarColor || AVATAR_COLORS[0],
        avatarUrl: m.avatarUrl || null,
        avatarIndex: m.avatarIndex != null ? m.avatarIndex : null,
        role: m.role
      };
    }

    return {
      ok: true,
      playerIndex: joinResult.playerIndex,
      nickName: joinResult.nickName,
      avatarColor: joinResult.avatarColor,
      avatarUrl: joinResult.avatarUrl,
      avatarIndex: joinResult.avatarIndex,
      role: joinResult.role
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
