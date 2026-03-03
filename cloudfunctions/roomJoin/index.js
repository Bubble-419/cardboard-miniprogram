const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

const AVATAR_COLORS = ['#5EC159', '#4A90E2', '#E24A4A', '#E2B84A', '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB'];

function pickAvatarColor(usedColors) {
  const available = AVATAR_COLORS.filter(c => !usedColors.includes(c));
  return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : AVATAR_COLORS[0];
}

exports.main = async (event, context) => {
  const { roomId } = event || {};

  if (!roomId || typeof roomId !== 'string') {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId is required'
    };
  }

  const { OPENID } = cloud.getWXContext();

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
      .where({ roomId, userId: OPENID })
      .limit(1)
      .get();

    if (existing.data && existing.data.length > 0) {
      const m = existing.data[0];
      return {
        ok: true,
        playerIndex: m.playerIndex,
        nickName: m.nickName || `玩家${m.playerIndex}`,
        avatarColor: m.avatarColor || AVATAR_COLORS[0],
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
    const nickName = `玩家${nextIndex}`;
    const now = Date.now();

    await db.collection(ROOM_MEMBERS_COLLECTION).add({
      data: {
        roomId,
        userId: OPENID,
        role: 'PLAYER',
        nickName,
        avatarUrl: null,
        avatarColor,
        joinedAt: now,
        playerIndex: nextIndex
      }
    });

    return {
      ok: true,
      playerIndex: nextIndex,
      nickName,
      avatarColor,
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
