'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  collectTurnRecords,
  aggregateTurnScores,
  aggregateRoomScores,
  statsForPlayer,
  hasTurnScoreData
} = require('../../cloudfunctions/getLeaderboard/aggregateTurnScores');

describe('partner leaderboard turnRecords aggregation', () => {
  it('collects current-round and archived turnRecords', () => {
    const records = collectTurnRecords({
      partnerRoundSummaries: [
        { round: 1, turnRecords: [{ playerIndex: 1, avgScore: 4, scoredCount: 2 }] }
      ],
      partnerCurrentRoundContent: {
        turnRecords: [{ playerIndex: 2, avgScore: 5, scoredCount: 2 }]
      }
    });
    assert.equal(records.length, 2);
    assert.equal(records[0].playerIndex, 1);
    assert.equal(records[1].playerIndex, 2);
  });

  it('sums total stars by scoredCount across rounds', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 1, avgScore: 4, scoredCount: 2 },
      { playerIndex: 1, avgScore: 5, scoredCount: 1 }
    ]);
    const stats = statsForPlayer(byPlayer, 1);
    // 4*2 + 5*1 = 13
    assert.equal(stats.totalStars, 13);
    assert.equal(stats.scoreCount, 3);
  });

  it('keeps half-star totals without rounding to integer', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 2, avgScore: 3.5, scoredCount: 3 }
    ]);
    const stats = statsForPlayer(byPlayer, 2);
    assert.equal(stats.totalStars, 10.5);
  });

  it('aggregates half-star roomScores without truncating', () => {
    const byPlayer = aggregateRoomScores([
      { currentPlayerIndex: 1, score: 3.5 },
      { currentPlayerIndex: 1, score: 4.5 }
    ]);
    const stats = statsForPlayer(byPlayer, 1);
    assert.equal(stats.totalStars, 8);
  });

  it('treats missing scoredCount as weight 1', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 2, avgScore: 3 },
      { playerIndex: 2, avgScore: 5 }
    ]);
    const stats = statsForPlayer(byPlayer, 2);
    assert.equal(stats.totalStars, 8);
    assert.equal(stats.scoreCount, 2);
  });

  it('returns 0 for players without scores', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 1, avgScore: 4, scoredCount: 2 }
    ]);
    const stats = statsForPlayer(byPlayer, 3);
    assert.equal(stats.totalStars, 0);
    assert.equal(stats.scoreCount, 0);
  });

  it('falls back to roomScores shape via aggregateRoomScores', () => {
    const byPlayer = aggregateRoomScores([
      { currentPlayerIndex: 1, score: 5 },
      { currentPlayerIndex: 1, score: 3 }
    ]);
    const stats = statsForPlayer(byPlayer, 1);
    assert.equal(stats.totalStars, 8);
    assert.equal(stats.scoreCount, 2);
    assert.equal(hasTurnScoreData(byPlayer), true);
  });

  it('hasTurnScoreData is false when no avgScore rows', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 1, avgScore: null }
    ]);
    assert.equal(hasTurnScoreData(byPlayer), false);
  });

  it('sorts by totalStars descending for ranking', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 1, avgScore: 5, scoredCount: 1 },
      { playerIndex: 2, avgScore: 3, scoredCount: 3 },
      { playerIndex: 3, avgScore: 4, scoredCount: 2 }
    ]);
    const rows = [1, 2, 3].map((playerIndex) => ({
      playerIndex,
      ...statsForPlayer(byPlayer, playerIndex)
    }));
    rows.sort((a, b) => b.totalStars - a.totalStars);
    assert.deepEqual(
      rows.map((r) => r.playerIndex),
      [2, 3, 1]
    );
    assert.deepEqual(
      rows.map((r) => r.totalStars),
      [9, 8, 5]
    );
  });
});
