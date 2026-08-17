const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const PROBLEMS_COLLECTION = 'designProblems';
const ENTRY_TYPE = 'designProblem';

function toTimestamp(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value.$date) return Number(value.$date) || 0;
  return 0;
}

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
    const memberRes = await db.collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();
    if (!memberRes.data || memberRes.data.length === 0) {
      return { ok: false, errCode: 'NOT_MEMBER', errMsg: '您不在该房间中' };
    }
    const myMember = memberRes.data[0];

    const problemsRes = await db.collection(PROBLEMS_COLLECTION)
      .where({ roomId, entryType: ENTRY_TYPE })
      .get();

    const problems = (problemsRes.data || []).map((item) => {
      // 排序只用首次提交时间；编辑只改 updateTime，不得影响顺序
      const createTime = toTimestamp(
        item.createTime || item.createdAt || item.submitTime || item.firstSubmitTime
      );
      const updateTime = toTimestamp(item.updateTime || item.updatedAt || 0);
      return {
        id: item._id,
        text: item.text || item.problemText || '',
        userId: item.userId || '',
        playerIndex: item.playerIndex,
        nickName: item.nickName || '',
        createTime,
        updateTime,
        // 兼容旧前端字段：submitTime = 首次提交时间
        submitTime: createTime || updateTime
      };
    });

    problems.sort((a, b) => {
      const ta = a.createTime || a.submitTime || 0;
      const tb = b.createTime || b.submitTime || 0;
      if (ta !== tb) return ta - tb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const membersCountRes = await db.collection(ROOM_MEMBERS_COLLECTION).where({ roomId }).count();
    const totalMembers = (membersCountRes && membersCountRes.total) || 0;
    const myProblem = problems.find((item) => item.playerIndex === myMember.playerIndex) || null;

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
