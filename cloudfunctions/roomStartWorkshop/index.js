const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';

exports.main = async (event, context) => {
  const { roomId, workshopName } = event || {};

  if (!roomId) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId is required'
    };
  }

  const name = ((workshopName || '脑暴工作坊') + '').trim() || '脑暴工作坊';
  const now = Date.now();

  try {
    // 找到当前房间记录
    const roomRes = await db
      .collection(ROOMS_COLLECTION)
      .where({ roomId })
      .limit(1)
      .get();

    if (!roomRes.data || roomRes.data.length === 0) {
      return {
        ok: false,
        errCode: 'ROOM_NOT_FOUND',
        errMsg: 'room not found'
      };
    }

    const docId = roomRes.data[0]._id;

    await db.collection(ROOMS_COLLECTION).doc(docId).update({
      data: {
        status: 'STARTED',
        workshopName: name,
        updatedAt: now
      }
    });

    return {
      ok: true,
      roomId,
      workshopName: name
    };
  } catch (e) {
    console.error('roomStartWorkshop error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'ROOM_START_ERROR',
      errMsg: e.errMsg || e.message || 'roomStartWorkshop failed'
    };
  }
};

