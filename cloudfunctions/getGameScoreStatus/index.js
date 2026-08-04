const cloud = require('wx-server-sdk');
const { getCallerOpenId, assertRoomMember } = require('./roomAuth');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
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
 * 查询当前房间、当前出牌玩家、当前轮次对应的评分进度
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
