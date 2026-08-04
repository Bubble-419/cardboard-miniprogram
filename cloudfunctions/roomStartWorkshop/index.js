const cloud = require('wx-server-sdk');
const { getCallerOpenId, assertHost } = require('./roomAuth');

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

  const currentUserId = getCallerOpenId(cloud);
  if (!currentUserId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  const name = ((workshopName || '脑暴工作坊') + '').trim() || '脑暴工作坊';
  const now = Date.now();

  try {
    const hostCheck = await assertHost(db, roomId, currentUserId);
    if (!hostCheck.ok) return hostCheck;

    const docId = hostCheck.room._id;

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
