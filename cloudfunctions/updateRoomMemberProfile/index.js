const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

exports.main = async (event, context) => {
  const { roomId, nickName, avatarUrl } = event || {};

  if (!roomId || typeof roomId !== 'string') {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId is required'
    };
  }

  const hasNickName = typeof nickName === 'string' && nickName.trim().length > 0;
  let normalizedAvatarUrl = typeof avatarUrl === 'string' && avatarUrl.trim()
    ? avatarUrl.trim()
    : '';
  // 本机临时路径无法跨设备加载，拒绝写入
  if (normalizedAvatarUrl) {
    const lower = normalizedAvatarUrl.toLowerCase();
    if (
      lower.startsWith('wxfile://') ||
      lower.startsWith('file://') ||
      lower.startsWith('http://tmp/') ||
      lower.startsWith('https://tmp/') ||
      lower.indexOf('://tmp/') !== -1
    ) {
      normalizedAvatarUrl = '';
    }
  }
  const hasAvatarUrl = normalizedAvatarUrl.length > 0;

  if (!hasNickName && !hasAvatarUrl) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'nickName or avatarUrl is required'
    };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const memberRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();

    if (!memberRes.data || memberRes.data.length === 0) {
      return {
        ok: false,
        errCode: 'NOT_IN_ROOM',
        errMsg: '您不在该房间'
      };
    }

    const member = memberRes.data[0];
    const updateData = {};
    if (hasNickName) updateData.nickName = nickName.trim();
    if (hasAvatarUrl) updateData.avatarUrl = normalizedAvatarUrl;

    await db.collection(ROOM_MEMBERS_COLLECTION).doc(member._id).update({
      data: updateData
    });

    return {
      ok: true,
      nickName: hasNickName ? nickName.trim() : (member.nickName || ''),
      avatarUrl: hasAvatarUrl ? normalizedAvatarUrl : (member.avatarUrl || null)
    };
  } catch (e) {
    console.error('updateRoomMemberProfile error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'UPDATE_PROFILE_ERROR',
      errMsg: e.errMsg || e.message || '更新成员资料失败'
    };
  }
};
