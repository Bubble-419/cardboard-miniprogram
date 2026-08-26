const cloud = require('wx-server-sdk');
const { getCallerOpenId, assertRoomMember } = require('./roomAuth');
const {
  buildTurnScoreId,
  listEligibleScorers,
  countEligibleScores
} = require('./scoreProgress');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const ROOM_SCORES_COLLECTION = 'roomScores';

/**
 * 查询当前出牌回合的评分进度（只计非出牌且仍在房的成员）
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

  const currentUserId = getCallerOpenId(cloud);
  if (!currentUserId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  try {
    const memberCheck = await assertRoomMember(db, roomId, currentUserId);
    if (!memberCheck.ok) return memberCheck;
    const room = memberCheck.room;

    const actingPlayerIndex = room.currentPlayerIndex != null
      ? parseInt(room.currentPlayerIndex, 10)
      : 1;
    const currentRound = room.currentRound != null ? Number(room.currentRound) : 1;

    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .get();
    const members = membersRes.data || [];
    const eligible = listEligibleScorers(members, actingPlayerIndex);
    const eligibleIds = new Set(eligible.map((m) => String(m.userId)));
    const totalRequired = eligible.length;

    const scoresRes = await db
      .collection(ROOM_SCORES_COLLECTION)
      .where({ roomId, currentPlayerIndex: actingPlayerIndex, round: currentRound })
      .get();
    let scoredCount = countEligibleScores(scoresRes.data, eligibleIds);

    const expectedTurnId = buildTurnScoreId(currentRound, actingPlayerIndex);
    // 不再用 progress 缓存抬高人数

    let myScore = null;
    const mine = (scoresRes.data || []).find(
      (row) => row && String(row.userId) === String(currentUserId)
    );
    if (mine && eligibleIds.has(String(currentUserId))) {
      const halfSteps = mine.scoreHalfSteps != null ? Number(mine.scoreHalfSteps) : NaN;
      if (Number.isFinite(halfSteps) && halfSteps >= 0 && halfSteps <= 10) {
        myScore = halfSteps / 2;
      } else if (mine.score != null && !Number.isNaN(Number(mine.score))) {
        const n = Number(mine.score);
        myScore = Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
      }
    }

    return {
      ok: true,
      scoredCount,
      totalRequired,
      myScore,
      myScoreHalfSteps: myScore != null ? Math.round(myScore * 2) : null,
      currentPlayerIndex: actingPlayerIndex,
      currentRound,
      turnId: expectedTurnId
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
