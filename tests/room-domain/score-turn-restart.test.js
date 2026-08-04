'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTurnScoreId,
  resolveScoreProgress
} = require('../../cloudfunctions/getAddPlayerData/scoreProgress');

function applyScoreStatusResult(page, result) {
  if (!result || result.ok !== true) return page;
  if (
    result.currentPlayerIndex != null
    && Number(result.currentPlayerIndex) !== Number(page.currentPlayerIndex)
  ) {
    return page;
  }
  if (
    result.currentRound != null
    && Number(result.currentRound) !== Number(page.currentRound)
  ) {
    return page;
  }
  let nextScored = result.scoredCount || 0;
  const nextRequired = Math.max(result.totalRequired || 0, page.membersLength - 1);
  const myScore = Object.prototype.hasOwnProperty.call(result, 'myScore')
    ? result.myScore
    : page.selectedScore;
  if (!page.isCurrentPlayer && myScore == null && nextRequired > 0 && nextScored >= nextRequired) {
    nextScored = Math.max(0, nextRequired - 1);
  }
  return {
    ...page,
    scoredCount: nextScored,
    totalRequired: nextRequired,
    selectedScore: myScore,
    canStartStatement: page.isHost
      && page.phase === 'play'
      && nextRequired > 0
      && nextScored >= nextRequired
  };
}

describe('entry / dirty seat score gate', () => {
  it('discards status when room seat differs from page URL seat', () => {
    const page = {
      isHost: true,
      phase: 'play',
      membersLength: 4,
      currentPlayerIndex: 1,
      currentRound: 1,
      isCurrentPlayer: false,
      selectedScore: null,
      scoredCount: 0,
      totalRequired: 3,
      canStartStatement: false
    };
    const next = applyScoreStatusResult(page, {
      ok: true,
      scoredCount: 0,
      totalRequired: 3,
      currentPlayerIndex: 2,
      currentRound: 1
    });
    assert.equal(next.canStartStatement, false);
    assert.equal(next.scoredCount, 0);
  });

  it('self-heals 未打分 + 已满 progress contradiction', () => {
    const page = {
      isHost: true,
      phase: 'play',
      membersLength: 2,
      currentPlayerIndex: 2,
      currentRound: 1,
      isCurrentPlayer: false,
      selectedScore: null,
      scoredCount: 0,
      totalRequired: 1,
      canStartStatement: false
    };
    const next = applyScoreStatusResult(page, {
      ok: true,
      scoredCount: 1,
      totalRequired: 1,
      myScore: null,
      currentPlayerIndex: 2,
      currentRound: 1
    });
    assert.equal(next.selectedScore, null);
    assert.equal(next.scoredCount, 0);
    assert.equal(next.canStartStatement, false);
  });

  it('resolveScoreProgress ignores stale previous-turn progress', () => {
    const resolved = resolveScoreProgress({
      progress: {
        scoredCount: 3,
        requiredScoreCount: 3,
        turnId: buildTurnScoreId(1, 1)
      },
      scoreRows: [],
      scoresByKey: {},
      members: [
        { userId: 'a', playerIndex: 1 },
        { userId: 'b', playerIndex: 2 },
        { userId: 'c', playerIndex: 3 },
        { userId: 'd', playerIndex: 4 }
      ],
      currentRound: 1,
      actingPlayerIndex: 2,
      myUserId: 'a'
    });
    assert.equal(resolved.scoredCount, 0);
    assert.equal(resolved.totalRequired, 3);
  });
});
