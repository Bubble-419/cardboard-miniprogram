const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';

/**
 * 房主更新房间当前页面状态，供普通玩家跟随跳转
 * 仅房间创建者可调用
 */
exports.main = async (event, context) => {
  const { roomId, currentPage, currentPlayerIndex, currentPlayerName, incrementRound } = event || {};

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
      console.warn('[updateRoomState] 房间不存在', roomId);
      return {
        ok: false,
        errCode: 'ROOM_NOT_FOUND',
        errMsg: '房间不存在'
      };
    }

    const room = roomRes.data[0];
    const creatorId = room.creatorId || room.creator_id;
    const isCreator = !creatorId || String(creatorId) === String(OPENID);
    const membersRes = creatorId && !isCreator
      ? await db.collection('roomMembers').where({ roomId, userId: OPENID }).limit(1).get()
      : { data: [] };
    const isMember = membersRes.data && membersRes.data.length > 0;
    if (!isCreator && !isMember) {
      console.warn('[updateRoomState] 无权限', { roomCreatorId: creatorId, callerOpenId: OPENID });
      return {
        ok: false,
        errCode: 'NO_PERMISSION',
        errMsg: '仅房主可更新房间状态'
      };
    }

    let currentRound = room.currentRound != null ? room.currentRound : 1;
    if (incrementRound === true) {
      currentRound += 1;
    }
    if (currentPage === 'auth') {
      currentRound = 1;
    }

    const updateData = {
      currentPage: currentPage || 'addPlayer',
      currentRound,
      updatedAt: Date.now()
    };
    if (currentPlayerIndex != null) updateData.currentPlayerIndex = currentPlayerIndex;
    if (currentPlayerName != null) updateData.currentPlayerName = currentPlayerName;

    const updateRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
      data: updateData
    });
    const updated = (updateRes && updateRes.stats && updateRes.stats.updated) || 0;
    if (updated === 0) {
      console.warn('[updateRoomState] 未更新到任何记录', { roomId, updateRes });
    }
    console.log('[updateRoomState] 更新完成', { roomId, currentPage: updateData.currentPage, updated });

    return {
      ok: true,
      currentPage: updateData.currentPage
    };
  } catch (e) {
    console.error('updateRoomState error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'UPDATE_ERROR',
      errMsg: e.errMsg || e.message || '更新房间状态失败'
    };
  }
};
