const { prepareMembersForDisplay, buildAvatarList, assignAvatarImages } = require('./avatars');

/** 将房间成员列表转为 user-list 组件所需的 avatarList（同步，假设已 resolve） */
function buildUserListFromMembers(members) {
  const enriched = assignAvatarImages(members || []);
  return enriched.map((m) => ({
    id: m.playerIndex != null ? m.playerIndex : (m.userId || ''),
    nickName: m.nickName || `玩家${m.playerIndex || ''}`,
    avatar: m.avatarImage || m.avatarUrl || '',
    avatarImage: m.avatarImage || m.avatarUrl || '',
    avatarFileID: m.avatarFileID || '',
    userKey: m.userId || (m.playerIndex != null ? `p${m.playerIndex}` : ''),
    isMe: m.isMe === true
  }));
}

/** 异步：先 resolve cloud:// 再构建列表 */
async function buildUserListFromMembersAsync(members, prevMembers) {
  const enriched = await prepareMembersForDisplay(members || []);
  const { preserveMemberAvatars } = require('./avatars');
  const stable = prevMembers && prevMembers.length
    ? preserveMemberAvatars(enriched, prevMembers)
    : enriched;
  return stable.map((m) => ({
    id: m.playerIndex != null ? m.playerIndex : (m.userId || ''),
    nickName: m.nickName || `玩家${m.playerIndex || ''}`,
    avatar: m.avatarImage || m.avatarUrl || '',
    avatarImage: m.avatarImage || m.avatarUrl || '',
    avatarFileID: m.avatarFileID || '',
    userKey: m.userId || (m.playerIndex != null ? `p${m.playerIndex}` : ''),
    isMe: m.isMe === true
  }));
}

module.exports = {
  buildUserListFromMembers,
  buildUserListFromMembersAsync,
  buildAvatarList
};
