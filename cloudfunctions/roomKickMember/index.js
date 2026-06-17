const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

exports.main = async (event, context) => {
  const { roomId, targetUserId } = event || {};

  if (!roomId || !targetUserId) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId and targetUserId are required'
    };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  if (targetUserId === currentUserId) {
    return {
      ok: false,
      errCode: 'CANNOT_KICK_SELF',
      errMsg: '不能踢出自己'
    };
  }

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
    }

    const room = roomRes.data[0];
    if (!room.creatorId || room.creatorId !== currentUserId) {
      return { ok: false, errCode: 'NO_PERMISSION', errMsg: '仅房主可踢出成员' };
    }

    const targetRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: targetUserId })
      .limit(1)
      .get();

    if (!targetRes.data || targetRes.data.length === 0) {
      return { ok: false, errCode: 'MEMBER_NOT_FOUND', errMsg: '成员不在房间中' };
    }

    await db.collection(ROOM_MEMBERS_COLLECTION).doc(targetRes.data[0]._id).remove();

    return { ok: true };
  } catch (e) {
    console.error('roomKickMember error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'KICK_MEMBER_ERROR',
      errMsg: e.errMsg || e.message || '踢出成员失败'
    };
  }
};
