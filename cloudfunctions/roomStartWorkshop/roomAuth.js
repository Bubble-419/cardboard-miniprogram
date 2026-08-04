/**
 * 房间成员/房主鉴权（Phase 1 P0）
 * 各云函数目录内各放一份副本；部署时不可依赖跨函数相对路径。
 */
function getCallerOpenId(cloud) {
  const wxContext = cloud.getWXContext();
  return wxContext.FROM_OPENID || wxContext.OPENID || '';
}

async function assertRoomMember(db, roomId, userId) {
  if (!userId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }
  const roomRes = await db.collection('rooms').where({ roomId }).limit(1).get();
  if (!roomRes.data || !roomRes.data.length) {
    return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  }
  const room = roomRes.data[0];
  if (room.status === 'DISSOLVED') {
    return { ok: false, errCode: 'ROOM_DISSOLVED', errMsg: '房间已解散' };
  }
  const creatorId = room.creatorId || room.creator_id;
  if (creatorId && String(creatorId) === String(userId)) {
    return { ok: true, room, isHost: true, member: null };
  }
  const memberRes = await db
    .collection('roomMembers')
    .where({ roomId, userId })
    .limit(1)
    .get();
  const member = memberRes.data && memberRes.data[0];
  if (!member) {
    return { ok: false, errCode: 'NOT_MEMBER', errMsg: '非房间成员' };
  }
  return { ok: true, room, isHost: false, member };
}

async function assertHost(db, roomId, userId) {
  const check = await assertRoomMember(db, roomId, userId);
  if (!check.ok) return check;
  const creatorId = check.room.creatorId || check.room.creator_id;
  if (!creatorId || String(creatorId) !== String(userId)) {
    return { ok: false, errCode: 'HOST_REQUIRED', errMsg: '仅房主可操作' };
  }
  return { ok: true, room: check.room, isHost: true, member: check.member };
}

module.exports = {
  getCallerOpenId,
  assertRoomMember,
  assertHost
};
