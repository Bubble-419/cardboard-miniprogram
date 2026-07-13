const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const ROOM_SCORES_COLLECTION = 'roomScores';

function countValidScores(scoreRows, actingUserId) {
  const seen = new Set();
  let scoredCount = 0;
  for (const row of scoreRows || []) {
    if (!row || !row.userId) continue;
    if (actingUserId && row.userId === actingUserId) continue;
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    scoredCount += 1;
  }
  return scoredCount;
}

/**
 * 查询当前房间、当前出牌玩家、当前轮次对应的评分进度：已评分人数、应评分总人数（总人数-1，不包含出牌者自评）
 * 支持多轮循环：每次循环回玩家1时 currentRound 递增，只统计本轮分数
 */
exports.main = async (event, context) => {
  const { roomId } = event || {};

  if (!roomId) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId 必填'
    };
  }

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    const room = roomRes.data && roomRes.data[0];
    if (!room) {
      return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
    }

    const actingPlayerIndex = room.currentPlayerIndex != null
      ? parseInt(room.currentPlayerIndex, 10)
      : 1;
    const currentRound = room.currentRound != null ? room.currentRound : 1;

    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .get();
    const members = membersRes.data || [];
    const totalRequired = Math.max(0, members.length - 1);
    const actingMember = members.find((m) => m.playerIndex === actingPlayerIndex);
    const actingUserId = actingMember && actingMember.userId;

    const scoresRes = await db
      .collection(ROOM_SCORES_COLLECTION)
      .where({ roomId, currentPlayerIndex: actingPlayerIndex, round: currentRound })
      .get();
    const scoredCount = countValidScores(scoresRes.data, actingUserId);

    return {
      ok: true,
      scoredCount,
      totalRequired,
      currentPlayerIndex: actingPlayerIndex,
      currentRound
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
