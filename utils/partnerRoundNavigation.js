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
  const stored = summary && summary.playerIndex != null
    ? parseInt(summary.playerIndex, 10)
    : NaN;
  // 优先用归档时写入的真实出牌座位；公式仅兜底旧数据（且无法表达「首位非玩家1」）
  const playerIndex = Number.isFinite(stored) && stored > 0
    ? stored
    : getActingPlayerForRound(round, memberCount);
  const storedName = summary && typeof summary.playerName === 'string'
    ? summary.playerName.trim()
    : '';
  return {
    ...summary,
    playerIndex,
    playerName: storedName || resolvePlayerName(members, playerIndex)
  };
}

function sortSummaries(roundSummaries) {
  return (roundSummaries || []).slice().sort((a, b) => {
    const rd = (a.round || 0) - (b.round || 0);
    if (rd !== 0) return rd;
    return (a.archivedAt || 0) - (b.archivedAt || 0);
  });
}

function filterSummariesForPlayer(roundSummaries, playerIndex, memberCount) {
  const idx = parseInt(playerIndex, 10);
  const count = Number(memberCount) || 1;
  return sortSummaries(roundSummaries)
    .filter((item) => {
      const stored = item && item.playerIndex != null
        ? parseInt(item.playerIndex, 10)
        : NaN;
      if (Number.isFinite(stored) && stored > 0) return stored === idx;
      return getActingPlayerForRound(item.round, count) === idx;
    });
}

function buildDisplaySummaries(roundSummaries, members, filteredPlayerIndex, isFilterActive) {
  const memberCount = (members || []).length || 1;
  const sorted = sortSummaries(roundSummaries);
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
