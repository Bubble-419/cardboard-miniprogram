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

/** 回顾卡累计星：内部上限，界面不得按此预留格子 */
const MAX_EARNED_STARS = 25;
const EARNED_STAR_STAGGER_MS = 22;
const EARNED_STAR_STAGGER_MAX_MS = 680;

function roundToHalfStar(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 2) / 2;
}

function capEarnedStars(total) {
  const n = roundToHalfStar(total);
  if (n <= 0) return 0;
  if (n > MAX_EARNED_STARS) return MAX_EARNED_STARS;
  return n;
}

function lookupTurnStarStat(lookup, round, playerIndex) {
  if (!lookup || round == null || playerIndex == null) return null;
  return lookup[`r${Number(round)}_p${Number(playerIndex)}`] || null;
}

function resolveCardTotalStars(source, lookup) {
  if (!source || typeof source !== 'object') {
    if (typeof source === 'number') return capEarnedStars(source);
    return 0;
  }
  if (source.totalStars != null && Number.isFinite(Number(source.totalStars))) {
    return capEarnedStars(source.totalStars);
  }
  if (source.starSum != null && Number.isFinite(Number(source.starSum))) {
    return capEarnedStars(source.starSum);
  }
  const fromLookup = lookupTurnStarStat(lookup, source.round, source.playerIndex);
  if (fromLookup) {
    if (typeof fromLookup === 'number') return capEarnedStars(fromLookup);
    if (fromLookup.totalStars != null) return capEarnedStars(fromLookup.totalStars);
    if (fromLookup.starSum != null) return capEarnedStars(fromLookup.starSum);
    if (fromLookup.avgScore != null) {
      const counted = Number(fromLookup.scoredCount);
      const weight = Number.isFinite(counted) && counted > 0 ? counted : 1;
      return capEarnedStars(Number(fromLookup.avgScore) * weight);
    }
  }
  const avg = source.avgScore != null ? Number(source.avgScore) : NaN;
  if (Number.isFinite(avg)) {
    const counted = source.scoredCount != null ? Number(source.scoredCount) : 0;
    const weight = Number.isFinite(counted) && counted > 0 ? counted : 1;
    return capEarnedStars(avg * weight);
  }
  return 0;
}

function buildEarnedStarSlots(totalStars) {
  const capped = capEarnedStars(totalStars);
  const steps = Math.round(capped * 2);
  if (steps <= 0) return [];
  const full = Math.floor(steps / 2);
  const hasHalf = steps % 2 === 1;
  const total = full + (hasHalf ? 1 : 0);
  const slots = [];
  for (let i = 0; i < full; i += 1) {
    const n = i + 1;
    slots.push({
      key: `f${n}`,
      fill: 100,
      groupGap: n % 5 === 0 && n < total
    });
  }
  if (hasHalf) {
    slots.push({
      key: 'h',
      fill: 50,
      groupGap: false
    });
  }
  return slots;
}

function earnedStarStaggerDelays(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0) return [];
  let gap = EARNED_STAR_STAGGER_MS;
  if (n > 1 && gap * (n - 1) > EARNED_STAR_STAGGER_MAX_MS) {
    gap = EARNED_STAR_STAGGER_MAX_MS / (n - 1);
  }
  if (gap < 20) gap = 20;
  if (gap > 25) gap = 25;
  const delays = [];
  for (let i = 0; i < n; i += 1) {
    delays.push(Math.round(i * gap));
  }
  return delays;
}

function earnedStarWaveDelays(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0) return [];
  const animMs = 280;
  const totalMs = 600;
  const gap = n > 1 ? Math.min(24, (totalMs - animMs) / (n - 1)) : 0;
  const delays = [];
  for (let i = 0; i < n; i += 1) {
    delays.push(Math.round(i * gap));
  }
  return delays;
}

module.exports = {
  MIN_SCORE,
  MAX_SCORE,
  STEP,
  MAX_HALF_STEPS,
  MAX_EARNED_STARS,
  EARNED_STAR_STAGGER_MS,
  EARNED_STAR_STAGGER_MAX_MS,
  toHalfSteps,
  fromHalfSteps,
  normalizeHalfStarScore,
  clampSelectableScore,
  scoreFromTrackX,
  formatScoreDisplay,
  buildStarFills,
  roundToHalfStar,
  capEarnedStars,
  resolveCardTotalStars,
  buildEarnedStarSlots,
  earnedStarStaggerDelays,
  earnedStarWaveDelays
};
