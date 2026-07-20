const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const MAX_MESSAGES = 40;
const MAX_TEXT_LEN = 40;

/**
 * 匿名表达：写入房间弹幕队列，供全员轮询展示
 * rooms 文档以字段 roomId 标识，不能用 .doc(roomId)
 */
exports.main = async (event) => {
  const { roomId, text, round } = event || {};
  const content = typeof text === 'string' ? text.trim() : '';
  if (!roomId || !content) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: '内容不能为空' };
  }
  if (content.length > MAX_TEXT_LEN) {
    return { ok: false, errCode: 'TOO_LONG', errMsg: `最多 ${MAX_TEXT_LEN} 字` };
  }

  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID;
  if (!userId) {
    return { ok: false, errCode: 'NO_AUTH', errMsg: '未登录' };
  }

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    const room = roomRes.data && roomRes.data[0];
    if (!room) {
      return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
    }

    const memberRes = await db.collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId })
      .limit(1)
      .get();
    const isMember = memberRes.data && memberRes.data.length > 0;
    const isCreator = room.creatorId === userId;
    if (!isMember && !isCreator) {
      return { ok: false, errCode: 'NOT_IN_ROOM', errMsg: '您不在该房间' };
    }

    const msg = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: content,
      at: Date.now(),
      round: round != null ? Number(round) : 0
      // 故意不存 userId，保持匿名
    };

    const existing = Array.isArray(room.partnerExpressMessages)
      ? room.partnerExpressMessages
      : [];
    const next = existing.concat([msg]).slice(-MAX_MESSAGES);

    await db.collection(ROOMS_COLLECTION).doc(room._id).update({
      data: {
        partnerExpressMessages: next,
        updateTime: Date.now()
      }
    });

    return { ok: true, message: msg };
  } catch (e) {
    console.error('postPartnerExpress error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'POST_ERROR',
      errMsg: e.errMsg || e.message || '发送失败'
    };
  }
};
