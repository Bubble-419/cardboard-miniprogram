const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOM_SCORES_COLLECTION = 'roomScores';

/**
 * 清除指定房间的所有评分记录（再来一局时使用）
 */
exports.main = async (event, context) => {
  const { roomId } = event || {};

  if (!roomId || typeof roomId !== 'string') {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId is required'
    };
  }

  try {
    const MAX_BATCH = 100;
    let deleted = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await db
        .collection(ROOM_SCORES_COLLECTION)
        .where({ roomId })
        .limit(MAX_BATCH)
        .get();

      const docs = res.data || [];
      if (docs.length === 0) {
        hasMore = false;
        break;
      }

      for (const doc of docs) {
        await db.collection(ROOM_SCORES_COLLECTION).doc(doc._id).remove();
        deleted++;
      }
      if (docs.length < MAX_BATCH) hasMore = false;
    }

    return { ok: true, deleted };
  } catch (e) {
    console.error('clearRoomScores error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'CLEAR_ERROR',
      errMsg: e.errMsg || e.message || '清除失败'
    };
  }
};
