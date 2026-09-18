'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePartnerScoreProgress,
  shouldApplyRoomSnapshot
} = require('../../utils/partnerScoreProgress');

test('V3 打分进度按业务 turnId 接受，不要求旧的 turn_r座位 假键', () => {
  const resolved = resolvePartnerScoreProgress({
    scoredCount: 2,
    totalRequired: 3,
    currentRound: 1,
    currentPlayerIndex: 2,
    progress: {
      turnId: 'turn_9f3a',
      domainTurnId: 'turn_9f3a',
      scoredCount: 2,
      requiredScoreCount: 3
    }
  }, 'turn_r1_s2');

  assert.equal(resolved.accepted, true);
  assert.equal(resolved.scoredCount, 2);
  assert.equal(resolved.requiredScoreCount, 3);
  assert.equal(resolved.turnId, 'turn_9f3a');
});

test('换人后仍读取当前 View 的权威评分人数，而不是清成无人评分', () => {
  const resolved = resolvePartnerScoreProgress({
    scoredCount: 1,
    totalRequired: 2,
    progress: { turnId: 'turn_next', scoredCount: 1, requiredScoreCount: 2 }
  }, '');

  assert.equal(resolved.accepted, true);
  assert.equal(resolved.scoredCount, 1);
});

test('较旧的房间快照不能覆盖已经应用的打分进度', () => {
  assert.equal(shouldApplyRoomSnapshot(12, 10), false);
  assert.equal(shouldApplyRoomSnapshot(10, 12), true);
  assert.equal(shouldApplyRoomSnapshot(0, 1), true);
  assert.equal(shouldApplyRoomSnapshot(4, 4), true);
});
