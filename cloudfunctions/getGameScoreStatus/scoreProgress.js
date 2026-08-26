'use strict';

/**
 * 打分规则（Partner）：
 * - 当前出牌玩家不打分
 * - 其余每位在房成员各打 1 次
 * - 全部打完后房主可「开始表态」
 */

function buildTurnScoreId(currentRound, actingPlayerIndex) {
  const round = currentRound != null ? Number(currentRound) : 1;
  const seat = actingPlayerIndex != null ? Number(actingPlayerIndex) : 0;
  return `turn_r${round}_s${seat}`;
}

function isProgressForCurrentTurn(progress, currentRound, actingPlayerIndex) {
  if (!progress || typeof progress !== 'object') return false;
  const tid = progress.turnId;
  if (!tid || typeof tid !== 'string') return false;
  return tid === buildTurnScoreId(currentRound, actingPlayerIndex);
}

/**
 * 当前回合有资格打分的成员（排除出牌玩家）
 */
function listEligibleScorers(members, actingPlayerIndex) {
  const acting = Number(actingPlayerIndex);
  const list = [];
  const seen = new Set();
  (members || []).forEach((m) => {
    if (!m || m.userId == null || m.userId === '') return;
    if (Number(m.playerIndex) === acting) return;
    const uid = String(m.userId);
    if (seen.has(uid)) return;
    seen.add(uid);
    list.push(m);
  });
  return list;
}

/**
 * 只统计「当前在房且非出牌」成员的有效打分。
 * 幽灵分 / 已退房成员 / 出牌玩家自己的脏记录一律不计。
 */
function countEligibleScores(scoreRows, eligibleUserIds) {
  const allowed = eligibleUserIds instanceof Set
    ? eligibleUserIds
    : new Set((eligibleUserIds || []).map((id) => String(id)));
  const seen = new Set();
  let scoredCount = 0;
  for (const row of scoreRows || []) {
    if (!row || row.userId == null || row.userId === '') continue;
    const uid = String(row.userId);
    if (!allowed.has(uid)) continue;
    if (seen.has(uid)) continue;
    seen.add(uid);
    scoredCount += 1;
  }
  return scoredCount;
}

/**
 * 从 scoresByKey 统计当前 turnId 下、且属于合格打分者的人数
 */
function countScoresByKey(scoresByKey, turnId, eligibleUserIds) {
  if (!turnId || !scoresByKey || typeof scoresByKey !== 'object') return 0;
  const allowed = eligibleUserIds instanceof Set
    ? eligibleUserIds
    : new Set((eligibleUserIds || []).map((id) => String(id)));
  const seen = new Set();
  Object.keys(scoresByKey).forEach((key) => {
    const row = scoresByKey[key];
    if (!row || row.turnId !== turnId) return;
    const uid = row.scorerUserId != null ? String(row.scorerUserId) : '';
    if (!uid || !allowed.has(uid)) return;
    if (seen.has(uid)) return;
    seen.add(uid);
  });
  return seen.size;
}

/**
 * 权威合并：以合格成员集合为准，不用过期 progress 抬高人数。
 * progress 仅在 turnId 匹配且 roomScores 为空时作兼容兜底，且不超过合格人数。
 */
function resolveScoreProgress({
  progress,
  scoreRows,
  scoresByKey,
  members,
  currentRound,
  actingPlayerIndex,
  myUserId
}) {
  const eligible = listEligibleScorers(members, actingPlayerIndex);
  const eligibleIds = new Set(eligible.map((m) => String(m.userId)));
  const totalRequired = eligible.length;
  const expectedTurnId = buildTurnScoreId(currentRound, actingPlayerIndex);

  const fromRows = countEligibleScores(scoreRows, eligibleIds);
  const fromKeys = countScoresByKey(scoresByKey, expectedTurnId, eligibleIds);
  // 只信合格成员的真实打分行 / scoresByKey；绝不让 progress 缓存把 0 抬成满分
  const scoredCount = Math.max(fromRows, fromKeys);

  let myScore = null;
  if (myUserId != null && myUserId !== '') {
    const myId = String(myUserId);
    if (eligibleIds.has(myId)) {
      const mine = (scoreRows || []).find((row) => row && String(row.userId) === myId);
      if (mine) {
        // 优先半星步进字段，避免 score 曾被 parseInt 截成整数
        const halfSteps = mine.scoreHalfSteps != null ? Number(mine.scoreHalfSteps) : NaN;
        if (Number.isFinite(halfSteps) && halfSteps >= 0 && halfSteps <= 10) {
          myScore = halfSteps / 2;
        } else if (mine.score != null && !Number.isNaN(Number(mine.score))) {
          const n = Number(mine.score);
          myScore = Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
        }
      }
      if (myScore == null && scoresByKey && typeof scoresByKey === 'object') {
        Object.keys(scoresByKey).forEach((key) => {
          if (myScore != null) return;
          const row = scoresByKey[key];
          if (!row || row.turnId !== expectedTurnId) return;
          if (String(row.scorerUserId) !== myId) return;
          const halfSteps = row.scoreHalfSteps != null ? Number(row.scoreHalfSteps) : NaN;
          if (Number.isFinite(halfSteps) && halfSteps >= 0 && halfSteps <= 10) {
            myScore = halfSteps / 2;
            return;
          }
          if (row.score != null && !Number.isNaN(Number(row.score))) {
            const n = Number(row.score);
            myScore = Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
          }
        });
      }
    }
  }

  return {
    scoredCount,
    totalRequired,
    turnId: expectedTurnId,
    myScore,
    canStartStatement: totalRequired > 0 && scoredCount >= totalRequired
  };
}

module.exports = {
  buildTurnScoreId,
  isProgressForCurrentTurn,
  listEligibleScorers,
  countEligibleScores,
  countScoresByKey,
  resolveScoreProgress
};
