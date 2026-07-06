const { assignAvatarImages } = require('./avatars');

/** 将房间成员列表转为 user-list 组件所需的 avatarList */
function buildUserListFromMembers(members) {
  const enriched = assignAvatarImages(members || []);
  return enriched.map((m) => ({
    id: m.playerIndex != null ? m.playerIndex : (m.userId || ''),
    nickName: m.nickName || `玩家${m.playerIndex || ''}`,
    avatar: m.avatarImage || m.avatarUrl || '',
    avatarImage: m.avatarImage || m.avatarUrl || '',
    isMe: m.isMe === true
  }));
}

module.exports = {
  buildUserListFromMembers
};
