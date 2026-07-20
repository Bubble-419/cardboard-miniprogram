const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const MAX_NAME_LENGTH = 20;

/**
 * 房主修改房间/工作坊名称
 */
exports.main = async (event, context) => {
  const { roomId, workshopName } = event || {};

  if (!roomId || typeof roomId !== 'string') {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId is required' };
  }

  const name = ((workshopName || '') + '').trim() || '脑暴工作坊';
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: `房间名称不超过${MAX_NAME_LENGTH}字`
    };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
    }

    const room = roomRes.data[0];
    if (!room.creatorId || room.creatorId !== currentUserId) {
      return { ok: false, errCode: 'NO_PERMISSION', errMsg: '仅房主可修改房间名称' };
    }

    await db.collection(ROOMS_COLLECTION).doc(room._id).update({
      data: {
        workshopName: name,
        updatedAt: Date.now()
      }
    });

    return { ok: true, workshopName: name };
  } catch (e) {
    console.error('roomUpdateWorkshopName error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'UPDATE_NAME_ERROR',
      errMsg: e.errMsg || e.message || '修改房间名称失败'
    };
  }
};
