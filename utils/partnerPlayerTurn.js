function getNextPlayerTurn(members, currentPlayerIndex) {
  const count = Array.isArray(members) ? members.length : 0;
  if (!count) {
    return {
      nextIndex: currentPlayerIndex != null ? currentPlayerIndex : 1,
      nextName: `玩家${currentPlayerIndex || 1}`,
      incrementRound: false
    };
  }
  const nextIndex = (currentPlayerIndex % count) + 1;
  const nextMember = members.find((m) => m.playerIndex === nextIndex);
  const nextName = nextMember
    ? (nextMember.nickName || `玩家${nextIndex}`)
    : `玩家${nextIndex}`;
  return {
    nextIndex,
    nextName,
    // 脑暴模式：每轮仅一次出牌→打分→表态，结束即进入下一轮
    incrementRound: true
  };
}

function buildPartnerAvatarList(members, highlightIds) {
  const highlights = Array.isArray(highlightIds) ? highlightIds : [];
  return (members || []).map((m) => ({
    id: m.playerIndex,
    avatar: m.avatarImage || m.avatarUrl || '',
    nickName: m.nickName,
    isMe: m.isMe,
    highlight: highlights.includes(m.playerIndex)
  }));
}

function resolveCurrentPlayerFromRoom(members, roomState, fallbackIndex) {
  const idx = roomState && roomState.currentPlayerIndex != null
    ? roomState.currentPlayerIndex
    : (fallbackIndex != null ? fallbackIndex : 1);
  const current = (members || []).find((m) => m.playerIndex === idx);
  const me = (members || []).find((m) => m.isMe);
  return {
    currentPlayerIndex: idx,
    currentPlayerName: current
      ? (current.nickName || `玩家${idx}`)
      : `玩家${idx}`,
    isCurrentPlayer: !!(me && me.playerIndex === idx)
  };
}

module.exports = {
  getNextPlayerTurn,
  buildPartnerAvatarList,
  resolveCurrentPlayerFromRoom
};
