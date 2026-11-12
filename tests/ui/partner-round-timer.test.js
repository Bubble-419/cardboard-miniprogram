'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROUND_DURATION_SEC,
  getRoundCycleStartedAt,
  roundedStrokeMetrics
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

test('倒计时描边圆角内缩半线宽，避免白卡片圆角盖住边缘线条', () => {
  // 外框 28rpx、描边 8rpx：路径半径应为 24，内沿恰好对齐 inset 8 / radius 20 的白卡片
  const metrics = roundedStrokeMetrics(400, 600, 8, 28);
  assert.equal(metrics.r, 24);
  assert.equal(metrics.xL, 4.5);
  assert.equal(metrics.thick, 8);

  const thin = roundedStrokeMetrics(400, 600, 4, 28);
  assert.equal(thin.r, 26);
});
