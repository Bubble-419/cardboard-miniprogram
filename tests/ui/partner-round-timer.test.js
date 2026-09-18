'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROUND_DURATION_SEC,
  getRoundCycleStartedAt
} = require('../../utils/partnerRoundTimer');

test('5 分钟到期后当前循环起点前移，边框进度重新从 0 开始而不是立刻再到期', () => {
  const startedAt = 1_700_000_000_000;
  const durationMs = ROUND_DURATION_SEC * 1000;
  const justBeforeExpire = startedAt + durationMs - 50;
  const afterShake = startedAt + durationMs + 2000;

  assert.equal(
    getRoundCycleStartedAt(startedAt, ROUND_DURATION_SEC, justBeforeExpire),
    startedAt
  );

  const nextCycle = getRoundCycleStartedAt(startedAt, ROUND_DURATION_SEC, afterShake);
  assert.equal(nextCycle, startedAt + durationMs);

  const ratioAfterShake = (afterShake - nextCycle) / durationMs;
  assert.ok(ratioAfterShake < 0.01, `到期抖动后进度应为新循环起点，实际 ${ratioAfterShake}`);
  assert.ok(ratioAfterShake < 0.9999, '到期后不应立刻再次触发抖动');
});
