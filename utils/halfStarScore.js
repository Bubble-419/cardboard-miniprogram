'use strict';

/**
 * 评分精度：0～5，步进 0.5。
 * 内部一律用「半星整数」0～10 运算，避免 4.5 被收成 4。
 * 未评分用 null 表示，不要写成 0。
 */

const MIN_SCORE = 0;
const MAX_SCORE = 5;
const STEP = 0.5;
const MAX_HALF_STEPS = 10;

function toHalfSteps(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const steps = Math.round(n * 2);
  if (steps < 0 || steps > MAX_HALF_STEPS) return null;
  return steps;
}

function fromHalfSteps(steps) {
  if (steps == null || steps === '') return null;
  const n = typeof steps === 'number' ? steps : parseInt(steps, 10);
  if (!Number.isFinite(n) || n < 0 || n > MAX_HALF_STEPS) return null;
  return n / 2;
}

function normalizeHalfStarScore(raw, halfSteps) {
  const fromSteps = fromHalfSteps(halfSteps);
  if (fromSteps != null) return fromSteps;
  const steps = toHalfSteps(raw);
  if (steps == null) return null;
  return steps / 2;
}

function clampSelectableScore(raw, halfSteps) {
  const n = normalizeHalfStarScore(raw, halfSteps);
  if (n == null) return null;
  if (n < STEP) return STEP;
  return n;
}

function scoreFromTrackX(clientX, trackLeft, trackWidth, options) {
  const min = options && options.minScore != null ? Number(options.minScore) : STEP;
  const max = options && options.maxScore != null ? Number(options.maxScore) : MAX_SCORE;
  const width = Number(trackWidth);
  if (!(width > 0) || !Number.isFinite(clientX) || !Number.isFinite(trackLeft)) {
    return min;
  }
  const ratio = (clientX - trackLeft) / width;
  const clampedRatio = ratio < 0 ? 0 : (ratio >= 1 ? 0.999999 : ratio);
  // 10 个等宽半星槽：0~10%→0.5，80%~90%→4.5，90%~100%→5
  const slot = Math.floor(clampedRatio * MAX_HALF_STEPS);
  const score = (slot + 1) * STEP;
  if (score < min) return min;
  if (score > max) return max;
  return score;
}

function formatScoreDisplay(score, options) {
  const steps = toHalfSteps(score);
  if (steps == null) return '';
  const n = steps / 2;
  const digits = options && options.digits != null ? options.digits : null;
  if (digits != null) return n.toFixed(digits);
  if (steps % 2 === 0) return String(n);
  return n.toFixed(1);
}

function buildStarFills(score) {
  const steps = toHalfSteps(score);
  return [1, 2, 3, 4, 5].map((index) => {
    if (steps == null) return { index, fill: 0 };
    const fullAt = index * 2;
    if (steps >= fullAt) return { index, fill: 100 };
    if (steps >= fullAt - 1) return { index, fill: 50 };
    return { index, fill: 0 };
  });
}

module.exports = {
  MIN_SCORE,
  MAX_SCORE,
  STEP,
  MAX_HALF_STEPS,
  toHalfSteps,
  fromHalfSteps,
  normalizeHalfStarScore,
  clampSelectableScore,
  scoreFromTrackX,
  formatScoreDisplay,
  buildStarFills
};
