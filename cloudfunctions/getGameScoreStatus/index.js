const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const ROOM_SCORES_COLLECTION = 'roomScores';

/**
 * 查询当前房间、当前出牌玩家对应的评分进度：已评分人数、应评分总人数（总人数-1，不包含出牌者自评）
 */
exports.main = async (event, context) => {
  const { roomId, currentPlayerIndex } = event || {};

  if (!roomId || currentPlayerIndex == null) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId, currentPlayerIndex 必填'
    };
  }

  try {
    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .count();
    const totalMembers = (membersRes && membersRes.total) || 0;
    const totalRequired = Math.max(0, totalMembers - 1);

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
    console.error('getGameScoreStatus error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'GET_STATUS_ERROR',
      errMsg: e.errMsg || e.message || '获取进度失败'
    };
  }
};
