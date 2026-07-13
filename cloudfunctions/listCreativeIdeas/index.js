const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const PROBLEMS_COLLECTION = 'designProblems';
const ENTRY_TYPE = 'creativeIdea';

/**
 * 获取房间内当前创意环节已提交的创意列表
 */
exports.main = async (event, context) => {
  const { roomId } = event || {};
  if (!roomId || typeof roomId !== 'string') {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId is required' };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || !roomRes.data.length) {
      return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
    }
    const creativeSessionSeq = roomRes.data[0].creativeSessionSeq != null
      ? roomRes.data[0].creativeSessionSeq
      : 0;

    const memberRes = await db.collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();
    if (!memberRes.data || memberRes.data.length === 0) {
      return { ok: false, errCode: 'NOT_MEMBER', errMsg: '您不在该房间中' };
    }

    const ideasRes = await db.collection(PROBLEMS_COLLECTION)
      .where({ roomId, entryType: ENTRY_TYPE, creativeSessionSeq })
      .get();

    const ideas = (ideasRes.data || []).map((item) => ({
      id: item._id,
      playerIndex: item.playerIndex,
      nickName: item.nickName || '',
      avatarUrl: item.avatarUrl || '',
      ideaText: item.ideaText || '',
      updateTime: item.updateTime || item.createTime || 0
    }));

    ideas.sort((a, b) => (a.playerIndex || 0) - (b.playerIndex || 0));

    const membersCountRes = await db.collection(ROOM_MEMBERS_COLLECTION).where({ roomId }).count();
    const totalMembers = (membersCountRes && membersCountRes.total) || 0;

    return {
      ok: true,
      ideas,
      submittedCount: ideas.length,
      totalMembers,
      creativeSessionSeq
    };
  } catch (e) {
    console.error('listCreativeIdeas error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'LIST_ERROR',
      errMsg: e.errMsg || e.message || '获取创意列表失败'
    };
  }
};
