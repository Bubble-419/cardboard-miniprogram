'use strict';

/**
 * 从合伙人表态归档（turnRecords）汇总整场均分。
 * 有 scoredCount 时按打分次数加权；旧数据缺 scoredCount 则该回合权重视为 1。
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
      byPlayer[idx] = { weightedSum: 0, weight: 0 };
    }
    const scored = rec.scoredCount != null ? Number(rec.scoredCount) : 0;
    const weight = Number.isFinite(scored) && scored > 0 ? scored : 1;
    byPlayer[idx].weightedSum += avg * weight;
    byPlayer[idx].weight += weight;
  });
  return byPlayer;
}

function roundOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function statsForPlayer(byPlayer, playerIndex) {
  const stats = byPlayer[playerKey(playerIndex)] || byPlayer[playerIndex];
  if (!stats || !(stats.weight > 0)) {
    return { averageScore: 0, scoreCount: 0 };
  }
  return {
    averageScore: roundOneDecimal(stats.weightedSum / stats.weight),
    scoreCount: stats.weight
  };
}

function hasTurnScoreData(byPlayer) {
  return Object.keys(byPlayer || {}).some((key) => byPlayer[key] && byPlayer[key].weight > 0);
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
      byPlayer[idx] = { weightedSum: 0, weight: 0 };
    }
    byPlayer[idx].weightedSum += score;
    byPlayer[idx].weight += 1;
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
