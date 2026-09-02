'use strict';

/**
 * 从合伙人表态归档（turnRecords）汇总整场获得的总星星数。
 * 有 scoredCount 时：该回合贡献 = avgScore * scoredCount；
 * 旧数据缺 scoredCount 则按 1 次计。
 */

function collectTurnRecords(room) {
  const records = [];
  const summaries = room && Array.isArray(room.partnerRoundSummaries)
    ? room.partnerRoundSummaries
    : [];
  summaries.forEach((item) => {
    if (item && Array.isArray(item.turnRecords)) {
      records.push.apply(records, item.turnRecords);
    }
  });
  const current = room && room.partnerCurrentRoundContent;
  if (current && Array.isArray(current.turnRecords)) {
    records.push.apply(records, current.turnRecords);
  }
  return records;
}

function playerKey(playerIndex) {
  const n = Number(playerIndex);
  return Number.isFinite(n) ? n : playerIndex;
}

function aggregateTurnScores(turnRecords) {
  const byPlayer = {};
  (turnRecords || []).forEach((rec) => {
    if (!rec || rec.avgScore == null) return;
    const avg = Number(rec.avgScore);
    if (Number.isNaN(avg)) return;
    const idx = playerKey(rec.playerIndex);
    if (idx == null || idx === '') return;
    if (!byPlayer[idx]) {
      byPlayer[idx] = { starSum: 0, scoreCount: 0 };
    }
    const scored = rec.scoredCount != null ? Number(rec.scoredCount) : 0;
    const weight = Number.isFinite(scored) && scored > 0 ? scored : 1;
    byPlayer[idx].starSum += avg * weight;
    byPlayer[idx].scoreCount += weight;
  });
  return byPlayer;
}

function roundOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function statsForPlayer(byPlayer, playerIndex) {
  const stats = byPlayer[playerKey(playerIndex)] || byPlayer[playerIndex];
  if (!stats || !(stats.scoreCount > 0)) {
    return { totalStars: 0, scoreCount: 0 };
  }
  return {
    totalStars: roundOneDecimal(stats.starSum),
    scoreCount: stats.scoreCount
  };
}

function hasTurnScoreData(byPlayer) {
  return Object.keys(byPlayer || {}).some((key) => byPlayer[key] && byPlayer[key].scoreCount > 0);
}

function aggregateRoomScores(scoreRows) {
  const byPlayer = {};
  (scoreRows || []).forEach((s) => {
    if (!s || s.score == null) return;
    const score = Number(s.score);
    if (Number.isNaN(score)) return;
    const idx = playerKey(s.currentPlayerIndex);
    if (idx == null || idx === '') return;
    if (!byPlayer[idx]) {
      byPlayer[idx] = { starSum: 0, scoreCount: 0 };
    }
    byPlayer[idx].starSum += score;
    byPlayer[idx].scoreCount += 1;
  });
  return byPlayer;
}

module.exports = {
  collectTurnRecords,
  aggregateTurnScores,
  aggregateRoomScores,
  statsForPlayer,
  hasTurnScoreData,
  playerKey,
  roundOneDecimal
};
