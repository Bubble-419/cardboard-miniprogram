const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const ROOM_SCORES_COLLECTION = 'roomScores';

/**
 * 提交当前用户对当前出牌玩家的评分（0～5），并返回本轮已评分人数与应评分总人数
 */
exports.main = async (event, context) => {
  const { roomId, currentPlayerIndex, score } = event || {};

  if (!roomId || currentPlayerIndex == null || score == null) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId, currentPlayerIndex, score 必填'
    };
  }

  const s = parseInt(score, 10);
  if (isNaN(s) || s < 0 || s > 5) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'score 需为 0～5'
    };
  }

  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  try {
    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .count();
    const totalMembers = (membersRes && membersRes.total) || 0;
    const totalRequired = Math.max(0, totalMembers - 1);

    const existing = await db
      .collection(ROOM_SCORES_COLLECTION)
      .where({
        roomId,
        currentPlayerIndex,
        userId: OPENID
      })
      .limit(1)
      .get();

    const now = Date.now();
    if (existing.data && existing.data.length > 0) {
      await db.collection(ROOM_SCORES_COLLECTION).doc(existing.data[0]._id).update({
        data: { score: s, updatedAt: now }
      });
    } else {
      await db.collection(ROOM_SCORES_COLLECTION).add({
        data: {
          roomId,
          currentPlayerIndex,
          userId: OPENID,
          score: s,
          createdAt: now,
          updatedAt: now
        }
      });
    }

    const countRes = await db
      .collection(ROOM_SCORES_COLLECTION)
      .where({ roomId, currentPlayerIndex })
      .count();
    const scoredCount = (countRes && countRes.total) || 0;

    return {
      ok: true,
      scoredCount,
      totalRequired
    };
  } catch (e) {
    console.error('submitGameScore error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'SUBMIT_ERROR',
      errMsg: e.errMsg || e.message || '提交失败'
    };
  }
};
