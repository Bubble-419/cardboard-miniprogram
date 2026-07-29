const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

/**
 * 房主解散房间：全员清出；状态 DISSOLVED。
 * 客户端通过轮询 getAddPlayerData 收到 ROOM_DISSOLVED（等同 room_dissolved 广播）。
 */
exports.main = async (event, context) => {
  const { roomId } = event || {};

  if (!roomId || typeof roomId !== 'string') {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId is required' };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      // 幂等：房间已不存在，视为已解散
      return {
        ok: true,
        event: 'room_dissolved',
        roomId,
        alreadyDissolved: true
      };
    }

    const room = roomRes.data[0];
    if (!room.creatorId || String(room.creatorId) !== String(currentUserId)) {
      return { ok: false, errCode: 'NO_PERMISSION', errMsg: '仅房主可解散房间' };
    }

    if (room.status === 'DISSOLVED') {
      return {
        ok: true,
        event: 'room_dissolved',
        roomId,
        alreadyDissolved: true
      };
    }

    const now = Date.now();
    // 先改房间状态，确保轮询能立刻读到 DISSOLVED
    await db.collection(ROOMS_COLLECTION).doc(room._id).update({
      data: {
        status: 'DISSOLVED',
        dissolvedAt: now,
        updatedAt: now,
        currentPage: 'addPlayer',
        brainstormProgressPage: '',
        lastEvent: {
          type: 'room_dissolved',
          at: now,
          by: currentUserId
        }
      }
    });

    try {
      await db.collection(ROOM_MEMBERS_COLLECTION).where({ roomId }).remove();
    } catch (e) {
      console.warn('roomDissolve remove members', e);
    }

    return {
      ok: true,
      event: 'room_dissolved',
      roomId,
      alreadyDissolved: false
    };
  } catch (e) {
    console.error('roomDissolve error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'ROOM_DISSOLVE_ERROR',
      errMsg: e.errMsg || e.message || '解散房间失败'
    };
  }
};
