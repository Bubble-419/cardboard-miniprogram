'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTurnScoreId,
  resolveScoreProgress,
  listEligibleScorers,
  countEligibleScores
} = require('../../cloudfunctions/getAddPlayerData/scoreProgress');

describe('eligible scorer counting', () => {
  const members = [
    { userId: 'host', playerIndex: 1 },
    { userId: 'p2', playerIndex: 2 }
  ];

  it('totalRequired is non-acting members only', () => {
    const eligible = listEligibleScorers(members, 2);
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0].userId, 'host');
  });

  it('ignores ghost scores and acting-player scores', () => {
    const eligibleIds = new Set(['host']);
    const scored = countEligibleScores([
      { userId: 'ghost-left', score: 5 },
      { userId: 'p2', score: 3 },
      { userId: 'host', score: 4 }
    ], eligibleIds);
    assert.equal(scored, 1);
  });

  it('未打分 must show 0/1 — ignores stale progress and ghost/acting rows', () => {
    const resolved = resolveScoreProgress({
      progress: {
        scoredCount: 1,
        requiredScoreCount: 1,
        turnId: buildTurnScoreId(1, 2)
      },
      scoreRows: [
        { userId: 'ghost', score: 5 },
        { userId: 'p2', score: 2 }
      ],
      scoresByKey: {},
      members,
      currentRound: 1,
      actingPlayerIndex: 2,
      myUserId: 'host'
    });
    assert.equal(resolved.scoredCount, 0);
    assert.equal(resolved.totalRequired, 1);
    assert.equal(resolved.myScore, null);
    assert.equal(resolved.canStartStatement, false);
  });

  it('counts only eligible member score', () => {
    const resolved = resolveScoreProgress({
      progress: null,
      scoreRows: [{ userId: 'host', score: 5 }],
      scoresByKey: {},
      members,
      currentRound: 1,
      actingPlayerIndex: 2,
      myUserId: 'host'
    });
    assert.equal(resolved.scoredCount, 1);
    assert.equal(resolved.totalRequired, 1);
    assert.equal(resolved.myScore, 5);
    assert.equal(resolved.canStartStatement, true);
  });

  it('shows 0/1 when eligible host has not scored even if progress says 1', () => {
    const resolved = resolveScoreProgress({
      progress: {
        scoredCount: 1,
        requiredScoreCount: 1,
        turnId: buildTurnScoreId(1, 2)
      },
      scoreRows: [],
      scoresByKey: {},
      members,
      currentRound: 1,
      actingPlayerIndex: 2,
      myUserId: 'host'
    });
    assert.equal(resolved.scoredCount, 0);
    assert.equal(resolved.totalRequired, 1);
    assert.equal(resolved.myScore, null);
    assert.equal(resolved.canStartStatement, false);
  });
});
