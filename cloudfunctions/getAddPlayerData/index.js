const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

/**
 * 供 addPlayer 页使用：返回房间小程序码 fileID 与成员列表（含 isMe）
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

  const { OPENID } = cloud.getWXContext();

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      return {
        ok: false,
        errCode: 'ROOM_NOT_FOUND',
        errMsg: '房间不存在'
      };
    }

    const room = roomRes.data[0];
    const isHost = !!(room.creatorId && room.creatorId === OPENID);
    const roomState = {
      currentPage: room.currentPage || 'addPlayer',
      currentPlayerIndex: room.currentPlayerIndex != null ? room.currentPlayerIndex : 1,
      currentPlayerName: room.currentPlayerName || '玩家1'
    };

    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .orderBy('playerIndex', 'asc')
      .get();

    const members = (membersRes.data || []).map(m => {
      const out = {
        playerIndex: m.playerIndex,
        nickName: m.nickName || `玩家${m.playerIndex}`,
        avatarColor: m.avatarColor || '#5EC159',
        isMe: m.userId === OPENID,
        userId: m.userId || null
      };
      if (m.avatarIndex != null) out.avatarIndex = m.avatarIndex;
      return out;
    });

    return {
      ok: true,
      qrcodeFileID: room.qrcodeFileID || null,
      members,
      isHost,
      roomState
    };
  } catch (e) {
    console.error('getAddPlayerData error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'GET_DATA_ERROR',
      errMsg: e.errMsg || e.message || '获取房间数据失败'
    };
  }
};
