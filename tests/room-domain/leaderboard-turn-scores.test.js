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

  it('weights by scoredCount across rounds', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 1, avgScore: 4, scoredCount: 2 },
      { playerIndex: 1, avgScore: 5, scoredCount: 1 }
    ]);
    const stats = statsForPlayer(byPlayer, 1);
    // (4*2 + 5*1) / 3 = 4.3
    assert.equal(stats.averageScore, 4.3);
    assert.equal(stats.scoreCount, 3);
  });

  it('treats missing scoredCount as weight 1', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 2, avgScore: 3 },
      { playerIndex: 2, avgScore: 5 }
    ]);
    const stats = statsForPlayer(byPlayer, 2);
    assert.equal(stats.averageScore, 4);
    assert.equal(stats.scoreCount, 2);
  });

  it('returns 0 for players without scores', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 1, avgScore: 4, scoredCount: 2 }
    ]);
    const stats = statsForPlayer(byPlayer, 3);
    assert.equal(stats.averageScore, 0);
    assert.equal(stats.scoreCount, 0);
  });

  it('falls back to roomScores shape via aggregateRoomScores', () => {
    const byPlayer = aggregateRoomScores([
      { currentPlayerIndex: 1, score: 5 },
      { currentPlayerIndex: 1, score: 3 }
    ]);
    const stats = statsForPlayer(byPlayer, 1);
    assert.equal(stats.averageScore, 4);
    assert.equal(stats.scoreCount, 2);
    assert.equal(hasTurnScoreData(byPlayer), true);
  });

  it('hasTurnScoreData is false when no avgScore rows', () => {
    const byPlayer = aggregateTurnScores([
      { playerIndex: 1, avgScore: null }
    ]);
    assert.equal(hasTurnScoreData(byPlayer), false);
  });
});
