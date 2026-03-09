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
  const { roomId, currentPage, currentPlayerIndex, currentPlayerName } = event || {};

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

    const room = roomRes.data[0];
    if (room.creatorId && room.creatorId !== OPENID) {
      return {
        ok: false,
        errCode: 'NO_PERMISSION',
        errMsg: '仅房主可更新房间状态'
      };
    }

    const updateData = {
      currentPage: currentPage || 'addPlayer',
      updatedAt: Date.now()
    };
    if (currentPlayerIndex != null) updateData.currentPlayerIndex = currentPlayerIndex;
    if (currentPlayerName != null) updateData.currentPlayerName = currentPlayerName;

    await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
      data: updateData
    });

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
