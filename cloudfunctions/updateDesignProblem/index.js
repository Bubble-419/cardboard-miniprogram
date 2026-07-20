const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const PROBLEMS_COLLECTION = 'designProblems';
const ENTRY_TYPE = 'designProblem';

/**
 * 更新房间内已提交的设计问题文案（提交者本人或房主可改）
 */
exports.main = async (event, context) => {
  const { problemId, text } = event || {};
  const problemText = (text || '').trim();

  if (!problemId || typeof problemId !== 'string') {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'problemId is required' };
  }
  if (!problemText) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: '问题内容不能为空' };
  }
  if (problemText.length > 50) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: '问题不能超过50字' };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;
  if (!currentUserId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  try {
    const docRes = await db.collection(PROBLEMS_COLLECTION).doc(problemId).get();
    const problem = docRes.data;
    if (!problem || problem.entryType !== ENTRY_TYPE) {
      return { ok: false, errCode: 'NOT_FOUND', errMsg: '设计问题不存在' };
    }

    const roomId = problem.roomId;
    if (!roomId) {
      return { ok: false, errCode: 'INVALID_DATA', errMsg: '问题数据无效' };
    }

    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    const room = roomRes.data && roomRes.data[0];
    const isHost = !!(room && room.creatorId === currentUserId);

    const memberRes = await db.collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();
    const myMember = memberRes.data && memberRes.data[0];
    if (!isHost && !myMember) {
      return { ok: false, errCode: 'NOT_MEMBER', errMsg: '您不在该房间中' };
    }

    const isOwner = myMember && problem.playerIndex === myMember.playerIndex;
    if (!isHost && !isOwner) {
      return { ok: false, errCode: 'NO_PERMISSION', errMsg: '仅可修改自己提交的问题' };
    }

    const now = Date.now();
    await db.collection(PROBLEMS_COLLECTION).doc(problemId).update({
      data: {
        text: problemText,
        problemText,
        updateTime: now,
        updatedAt: now
      }
    });

    return { ok: true, problemId, text: problemText, updateTime: now };
  } catch (e) {
    console.error('updateDesignProblem error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'UPDATE_ERROR',
      errMsg: e.errMsg || e.message || '更新失败'
    };
  }
};
