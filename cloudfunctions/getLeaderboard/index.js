const cloud = require('wx-server-sdk');
const { getCallerOpenId, assertRoomMember } = require('./roomAuth');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const ROOM_SCORES_COLLECTION = 'roomScores';

/**
 * 获取房间排行榜：每个玩家的平均分
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

  const currentUserId = getCallerOpenId(cloud);
  if (!currentUserId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  try {
    const memberCheck = await assertRoomMember(db, roomId, currentUserId);
    if (!memberCheck.ok) return memberCheck;

    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .orderBy('playerIndex', 'asc')
      .get();

    const members = (membersRes.data || []).map(m => ({
      playerIndex: m.playerIndex,
      nickName: m.nickName || `玩家${m.playerIndex}`,
      avatarUrl: m.avatarUrl || null,
      avatarColor: m.avatarColor || '#5EC159'
    }));

    const scoresRes = await db
      .collection(ROOM_SCORES_COLLECTION)
      .where({ roomId })
      .get();

    const scores = scoresRes.data || [];

    const byPlayer = {};
    scores.forEach(s => {
      const idx = s.currentPlayerIndex;
      if (!byPlayer[idx]) {
        byPlayer[idx] = { sum: 0, count: 0 };
      }
      byPlayer[idx].sum += (s.score || 0);
      byPlayer[idx].count += 1;
    });

    const leaderboard = members.map(m => {
      const stats = byPlayer[m.playerIndex] || { sum: 0, count: 0 };
      const avg = stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : 0;
      return {
        playerIndex: m.playerIndex,
        nickName: m.nickName,
        avatarUrl: m.avatarUrl,
        avatarColor: m.avatarColor,
        averageScore: avg,
        scoreCount: stats.count
      };
    });

    leaderboard.sort((a, b) => b.averageScore - a.averageScore);

    return {
      ok: true,
      leaderboard
    };
  } catch (e) {
    console.error('getLeaderboard error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'GET_LEADERBOARD_ERROR',
      errMsg: e.errMsg || e.message || '获取排行榜失败'
    };
  }
};
