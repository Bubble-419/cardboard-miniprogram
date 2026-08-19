function toPlayerIndex(value, fallback) {
  const n = parseInt(value, 10);
  if (Number.isFinite(n) && n > 0) return n;
  const fb = parseInt(fallback, 10);
  if (Number.isFinite(fb) && fb > 0) return fb;
  return 1;
}

function listSeatNos(members) {
  const seats = (Array.isArray(members) ? members : [])
    .map((m) => toPlayerIndex(m && m.playerIndex, 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const uniq = [];
  seats.forEach((n) => {
    if (uniq[uniq.length - 1] !== n) uniq.push(n);
  });
  return uniq;
}

function getNextPlayerTurn(members, currentPlayerIndex) {
  const seats = listSeatNos(members);
  if (!seats.length) {
    const safe = toPlayerIndex(currentPlayerIndex, 1);
    return {
      nextIndex: safe,
      nextName: `玩家${safe}`,
      incrementRound: false
    };
  }
  const safeCurrent = toPlayerIndex(currentPlayerIndex, seats[0]);
  const idx = seats.indexOf(safeCurrent);
  const nextIndex = seats[(idx >= 0 ? idx + 1 : 0) % seats.length];
  const nextMember = (members || []).find(
    (m) => toPlayerIndex(m && m.playerIndex, 0) === nextIndex
  );
  const nextName = nextMember
    ? (nextMember.nickName || nextMember.name || `玩家${nextIndex}`)
    : `玩家${nextIndex}`;
  return {
    nextIndex,
    nextName,
    // 轮次定义改为“玩家出牌次序号”：每次换到下一位玩家都进入下一轮
    incrementRound: true
  };
}

function buildPartnerAvatarList(members, highlightIds) {
  const highlights = Array.isArray(highlightIds) ? highlightIds : [];
  const highlightSet = new Set(
    highlights.map((id) => toPlayerIndex(id, 0)).filter((n) => n > 0)
  );
  return (members || []).map((m) => {
    const userId = m.userId || '';
    const playerIndex = m.playerIndex;
    return {
      id: playerIndex,
      userId,
      userKey: userId || (playerIndex != null ? `p${playerIndex}` : ''),
      avatarIndex: m.avatarIndex,
      avatar: m.avatarImage || m.avatarUrl || '',
      avatarImage: m.avatarImage || m.avatarUrl || '',
      nickName: m.nickName,
      isMe: m.isMe,
      highlight: highlightSet.has(toPlayerIndex(playerIndex, 0))
    };
  });
}

function resolveCurrentPlayerFromRoom(members, roomState, fallbackIndex) {
  const idx = toPlayerIndex(
    roomState && roomState.currentPlayerIndex,
    fallbackIndex != null ? fallbackIndex : 1
  );
  const list = members || [];
  const current = list.find((m) => toPlayerIndex(m && m.playerIndex, 0) === idx);
  const me = list.find((m) => !!m && m.isMe);
  const meIndex = me ? toPlayerIndex(me.playerIndex, 0) : 0;
  return {
    currentPlayerIndex: idx,
    currentPlayerName: current
      ? (current.nickName || `玩家${idx}`)
      : `玩家${idx}`,
    isCurrentPlayer: meIndex > 0 && meIndex === idx
  };
}

module.exports = {
  toPlayerIndex,
  listSeatNos,
  getNextPlayerTurn,
  buildPartnerAvatarList,
  resolveCurrentPlayerFromRoom
};
