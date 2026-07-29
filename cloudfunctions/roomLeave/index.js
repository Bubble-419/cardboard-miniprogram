const cloud = require('wx-server-sdk');
const { syncRoomAfterMemberRemoved } = require('./memberSync');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

exports.main = async (event, context) => {
  const { roomId } = event || {};

  if (!roomId) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId is required' };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
    }

    const room = roomRes.data[0];
    if (String(room.creatorId) === String(currentUserId)) {
      return {
        ok: false,
        errCode: 'HOST_CANNOT_LEAVE',
        errMsg: '房主请使用解散房间'
      };
    }

    const memberRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();

    if (!memberRes.data || memberRes.data.length === 0) {
      return { ok: true, alreadyLeft: true, event: null };
    }

    const removed = memberRes.data[0];
    await db.collection(ROOM_MEMBERS_COLLECTION).doc(removed._id).remove();

    const remainRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .orderBy('playerIndex', 'asc')
      .get();
    const remaining = remainRes.data || [];

    const sync = await syncRoomAfterMemberRemoved(
      db,
      room,
      roomId,
      { userId: removed.userId, playerIndex: removed.playerIndex },
      remaining
    );

    return {
      ok: true,
      memberCount: sync.memberCount,
      event: sync.event
    };
  } catch (e) {
    console.error('roomLeave error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'ROOM_LEAVE_ERROR',
      errMsg: e.errMsg || e.message || '退出房间失败'
    };
  }
};
