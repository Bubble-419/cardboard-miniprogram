const cloud = require('wx-server-sdk');
const { getCallerOpenId, assertRoomMember } = require('./roomAuth');

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
    const totalRequired = Math.max(0, members.length - 1);
    const actingMember = members.find((m) => m.playerIndex === actingPlayerIndex);
    if (actingMember && actingMember.userId === currentUserId) {
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
    const actingUserId = actingMember && actingMember.userId;
    const seen = new Set();
    let scoredCount = 0;
    for (const row of countRes.data || []) {
      if (!row || !row.userId) continue;
      if (actingUserId && row.userId === actingUserId) continue;
      if (seen.has(row.userId)) continue;
      seen.add(row.userId);
      scoredCount += 1;
    }

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
