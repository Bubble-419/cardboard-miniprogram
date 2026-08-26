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

function normalizeHalfStarScore(raw, halfSteps) {
  if (halfSteps != null && halfSteps !== '') {
    const steps = parseInt(halfSteps, 10);
    if (Number.isFinite(steps) && steps >= 0 && steps <= 10) {
      return steps / 2;
    }
  }
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const steps = Math.round(n * 2);
  if (steps < 0 || steps > 10) return null;
  return steps / 2;
}

/**
 * 提交当前用户对当前出牌玩家的评分（0～5，步进 0.5）
 * 仅非出牌玩家可打分；返回合格成员口径的进度
 */
exports.main = async (event, context) => {
  const { roomId, currentPlayerIndex, score } = event || {};

  if (!roomId || currentPlayerIndex == null || (score == null && (event.scoreHalfSteps == null || event.scoreHalfSteps === ''))) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId, currentPlayerIndex, score 必填'
    };
  }

  const s = normalizeHalfStarScore(score, event && event.scoreHalfSteps);
  if (s == null) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'score 需为 0～5，步进 0.5'
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

    const currentRound = room.currentRound != null ? room.currentRound : 1;
    const actingPlayerIndex = room.currentPlayerIndex != null
      ? parseInt(room.currentPlayerIndex, 10)
      : parseInt(currentPlayerIndex, 10);

    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .get();
    const members = membersRes.data || [];
    const eligible = listEligibleScorers(members, actingPlayerIndex);
    const eligibleIds = new Set(eligible.map((m) => String(m.userId)));
    const totalRequired = eligible.length;

    if (!eligibleIds.has(String(currentUserId))) {
      return {
        ok: false,
        errCode: 'SELF_SCORE',
        errMsg: '当前出牌玩家无需打分'
      };
    }

    const now = Date.now();
    await db.runTransaction(async (transaction) => {
      const existing = await transaction
        .collection(ROOM_SCORES_COLLECTION)
        .where({
          roomId,
          currentPlayerIndex: actingPlayerIndex,
          round: currentRound,
          userId: currentUserId
        })
        .limit(1)
        .get();

      if (existing.data && existing.data.length > 0) {
        await transaction.collection(ROOM_SCORES_COLLECTION).doc(existing.data[0]._id).update({
          data: { score: s, updatedAt: now }
        });
      } else {
        await transaction.collection(ROOM_SCORES_COLLECTION).add({
          data: {
            roomId,
            currentPlayerIndex: actingPlayerIndex,
            round: currentRound,
            userId: currentUserId,
            score: s,
            createdAt: now,
            updatedAt: now
          }
        });
      }
    });

    const countRes = await db
      .collection(ROOM_SCORES_COLLECTION)
      .where({ roomId, currentPlayerIndex: actingPlayerIndex, round: currentRound })
      .get();
    const scoredCount = countEligibleScores(countRes.data, eligibleIds);
    const turnId = buildTurnScoreId(currentRound, actingPlayerIndex);

    try {
      const rooms = db.collection('rooms');
      const progressPayload = {
        scoredCount,
        requiredScoreCount: totalRequired,
        votedCount: (room.progress && room.progress.votedCount) || 0,
        requiredVoteCount: (room.progress && room.progress.requiredVoteCount) || 0,
        turnId
      };
      if (room._id) {
        await rooms.doc(room._id).update({
          data: { progress: progressPayload, updatedAt: now }
        });
      } else {
        await rooms.where({ roomId }).update({
          data: { progress: progressPayload, updatedAt: now }
        });
      }
    } catch (e) {
      console.warn('submitGameScore sync progress', e);
    }

    return {
      ok: true,
      scoredCount,
      totalRequired,
      myScore: s,
      turnId
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
