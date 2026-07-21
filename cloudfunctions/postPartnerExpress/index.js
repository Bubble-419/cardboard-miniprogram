const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const MAX_MESSAGES = 40;
const MAX_TEXT_LEN = 40;

/** 房间内稳定匿名键：同人同键，不暴露真实 userId */
function buildAnonKey(roomId, userId) {
  return crypto
    .createHash('sha256')
    .update(`${roomId}:${userId}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * 匿名表达：写入房间消息队列，供全员以气泡聊天展示
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
  // 跨账号共享时 OPENID 为资源方，调用方用户需用 FROM_OPENID（与 roomJoin / getAddPlayerData 一致）
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
    const isCreator = !!(room.creatorId && String(room.creatorId) === String(userId));
    if (!isMember && !isCreator) {
      return { ok: false, errCode: 'NOT_IN_ROOM', errMsg: '您不在该房间' };
    }

    const anonKey = buildAnonKey(roomId, userId);
    const msg = {
      // id 前缀带 anonKey，客户端可在字段缺失时仍识别同人
      id: `${anonKey}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: content,
      at: Date.now(),
      round: round != null ? Number(round) : 0,
      // 不存 userId；anonKey 用于同人同色
      anonKey
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
