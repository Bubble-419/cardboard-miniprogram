const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const PROBLEMS_COLLECTION = 'designProblems';
const ENTRY_TYPE = 'creativeIdea';

async function getRoomCreativeSessionSeq(roomId) {
  const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
  if (!roomRes.data || !roomRes.data.length) return null;
  const room = roomRes.data[0];
  return room.creativeSessionSeq != null ? room.creativeSessionSeq : 0;
}

/**
 * 成员提交「印象深刻创意」
 */
exports.main = async (event, context) => {
  const { roomId, ideaText } = event || {};
  const text = (ideaText || '').trim();

  if (!roomId || typeof roomId !== 'string') {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId is required' };
  }
  if (!text) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: '请先填写创意' };
  }
  if (text.length > 120) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: '创意不能超过120字' };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;
  if (!currentUserId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  try {
    const creativeSessionSeq = await getRoomCreativeSessionSeq(roomId);
    if (creativeSessionSeq == null) {
      return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
    }

    const memberRes = await db.collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();
    if (!memberRes.data || memberRes.data.length === 0) {
      return { ok: false, errCode: 'NOT_MEMBER', errMsg: '您不在该房间中' };
    }
    const member = memberRes.data[0];
    const playerIndex = member.playerIndex;

    const existing = await db.collection(PROBLEMS_COLLECTION)
      .where({
        roomId,
        playerIndex,
        entryType: ENTRY_TYPE,
        creativeSessionSeq
      })
      .limit(1)
      .get();

    const now = Date.now();
    const ideaData = {
      roomId,
      playerIndex,
      entryType: ENTRY_TYPE,
      creativeSessionSeq,
      userId: currentUserId,
      nickName: member.nickName || `玩家${playerIndex}`,
      avatarUrl: member.avatarUrl || '',
      ideaText: text,
      updateTime: now
    };

    if (existing.data && existing.data.length > 0) {
      await db.collection(PROBLEMS_COLLECTION).doc(existing.data[0]._id).update({
        data: ideaData
      });
    } else {
      await db.collection(PROBLEMS_COLLECTION).add({
        data: {
          ...ideaData,
          createTime: now
        }
      });
    }

    const membersCountRes = await db.collection(ROOM_MEMBERS_COLLECTION).where({ roomId }).count();
    const ideasCountRes = await db.collection(PROBLEMS_COLLECTION)
      .where({ roomId, entryType: ENTRY_TYPE, creativeSessionSeq })
      .count();

    return {
      ok: true,
      playerIndex,
      submittedCount: (ideasCountRes && ideasCountRes.total) || 0,
      totalMembers: (membersCountRes && membersCountRes.total) || 0
    };
  } catch (e) {
    console.error('submitCreativeIdea error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'SUBMIT_ERROR',
      errMsg: e.errMsg || e.message || '提交失败'
    };
  }
};
