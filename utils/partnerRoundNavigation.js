function isSamePlayerIndex(a, b) {
  if (a == null || b == null) return false;
  return parseInt(a, 10) === parseInt(b, 10);
}

function getActingPlayerForRound(round, memberCount) {
  const count = Number(memberCount) || 1;
  const r = Number(round) || 1;
  return ((r - 1) % count) + 1;
}

function resolvePlayerName(members, playerIndex) {
  const idx = parseInt(playerIndex, 10);
  const member = (members || []).find((m) => m.playerIndex === idx);
  return member ? (member.nickName || `玩家${idx}`) : `玩家${idx}`;
}

function enrichSummaryWithPlayer(summary, members, memberCount) {
  const round = summary && summary.round != null ? summary.round : 1;
  const playerIndex = getActingPlayerForRound(round, memberCount);
  return {
    ...summary,
    playerIndex,
    playerName: resolvePlayerName(members, playerIndex)
  };
}

function filterSummariesForPlayer(roundSummaries, playerIndex, memberCount) {
  const idx = parseInt(playerIndex, 10);
  const count = Number(memberCount) || 1;
  return (roundSummaries || [])
    .slice()
    .sort((a, b) => (a.round || 0) - (b.round || 0))
    .filter((item) => getActingPlayerForRound(item.round, count) === idx);
}

function buildDisplaySummaries(roundSummaries, members, filteredPlayerIndex, isFilterActive) {
  const memberCount = (members || []).length || 1;
  const sorted = (roundSummaries || [])
    .slice()
    .sort((a, b) => (a.round || 0) - (b.round || 0));
  const shouldFilter = isFilterActive === true
    && filteredPlayerIndex != null
    && !Number.isNaN(parseInt(filteredPlayerIndex, 10));
  const source = shouldFilter
    ? filterSummariesForPlayer(sorted, filteredPlayerIndex, memberCount)
    : sorted;
  return source.map((item) => enrichSummaryWithPlayer(item, members, memberCount));
}

function playerHasSummaryCards(playerIndex, options) {
  const {
    roundSummaries,
    memberCount,
    currentPlayerIndex
  } = options || {};
  const idx = parseInt(playerIndex, 10);
  if (idx === parseInt(currentPlayerIndex, 10)) return true;
  return filterSummariesForPlayer(roundSummaries, idx, memberCount).length > 0;
}

module.exports = {
  isSamePlayerIndex,
  getActingPlayerForRound,
  enrichSummaryWithPlayer,
  filterSummariesForPlayer,
  buildDisplaySummaries,
  playerHasSummaryCards,
  resolvePlayerName
};
