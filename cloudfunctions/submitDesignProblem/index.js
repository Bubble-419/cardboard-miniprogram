const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const PROBLEMS_COLLECTION = 'roomDesignProblems';

/**
 * 成员提交设计问题；全员提交后自动将房间状态推进至 selectProblem
 */
exports.main = async (event, context) => {
  const { roomId, text } = event || {};
  const problemText = (text || '').trim();

  if (!roomId || typeof roomId !== 'string') {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId is required' };
  }
  if (!problemText) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: '请输入设计问题' };
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
    const memberRes = await db.collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();
    if (!memberRes.data || memberRes.data.length === 0) {
      return { ok: false, errCode: 'NOT_MEMBER', errMsg: '您不在该房间中' };
    }
    const member = memberRes.data[0];

    const existing = await db.collection(PROBLEMS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();

    const now = Date.now();
    const problemData = {
      roomId,
      userId: currentUserId,
      playerIndex: member.playerIndex,
      nickName: member.nickName || `玩家${member.playerIndex}`,
      text: problemText,
      submitTime: now,
      updatedAt: now
    };

    if (existing.data && existing.data.length > 0) {
      await db.collection(PROBLEMS_COLLECTION).doc(existing.data[0]._id).update({
        data: {
          text: problemText,
          updatedAt: now
        }
      });
    } else {
      await db.collection(PROBLEMS_COLLECTION).add({ data: problemData });
    }

    const membersCountRes = await db.collection(ROOM_MEMBERS_COLLECTION).where({ roomId }).count();
    const submittedCountRes = await db.collection(PROBLEMS_COLLECTION).where({ roomId }).count();
    const totalMembers = (membersCountRes && membersCountRes.total) || 0;
    const submittedCount = (submittedCountRes && submittedCountRes.total) || 0;
    const allSubmitted = totalMembers > 0 && submittedCount >= totalMembers;

    if (allSubmitted) {
      await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
        data: {
          currentPage: 'selectProblem',
          updatedAt: Date.now()
        }
      });
    }

    return {
      ok: true,
      submittedCount,
      totalMembers,
      allSubmitted,
      currentPage: allSubmitted ? 'selectProblem' : 'submitProblem'
    };
  } catch (e) {
    console.error('submitDesignProblem error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'SUBMIT_ERROR',
      errMsg: e.errMsg || e.message || '提交失败'
    };
  }
};
