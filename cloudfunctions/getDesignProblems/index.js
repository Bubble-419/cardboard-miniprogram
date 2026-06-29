const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const PROBLEMS_COLLECTION = 'roomDesignProblems';

/**
 * 获取房间内已提交的设计问题及提交进度
 */
exports.main = async (event, context) => {
  const { roomId } = event || {};
  if (!roomId || typeof roomId !== 'string') {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId is required' };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const problemsRes = await db.collection(PROBLEMS_COLLECTION)
      .where({ roomId })
      .orderBy('submitTime', 'asc')
      .get();

    const membersCountRes = await db.collection(ROOM_MEMBERS_COLLECTION).where({ roomId }).count();
    const totalMembers = (membersCountRes && membersCountRes.total) || 0;
    const problems = (problemsRes.data || []).map((item) => ({
      id: item._id,
      text: item.text,
      userId: item.userId,
      playerIndex: item.playerIndex,
      nickName: item.nickName || '',
      submitTime: item.submitTime || item.updatedAt || 0
    }));

    const myProblem = problems.find((item) => item.userId === currentUserId) || null;

    return {
      ok: true,
      problems,
      submittedCount: problems.length,
      totalMembers,
      allSubmitted: totalMembers > 0 && problems.length >= totalMembers,
      hasSubmitted: !!myProblem,
      myProblemText: myProblem ? myProblem.text : ''
    };
  } catch (e) {
    console.error('getDesignProblems error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'GET_ERROR',
      errMsg: e.errMsg || e.message || '获取设计问题失败'
    };
  }
};
