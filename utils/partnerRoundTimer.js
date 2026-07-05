const ROUND_DURATION_SEC = 5 * 60;

/**
 * 从右上角起顺时针：右 → 底 → 左 → 顶，每边占 25% 进度
 */
function getBorderSegmentProgress(elapsedRatio) {
  const ratio = Math.min(1, Math.max(0, elapsedRatio));
  const scaled = ratio * 4;
  return {
    right: Math.min(1, Math.max(0, scaled)),
    bottom: Math.min(1, Math.max(0, scaled - 1)),
    left: Math.min(1, Math.max(0, scaled - 2)),
    top: Math.min(1, Math.max(0, scaled - 3))
  };
}

function getRoundElapsedSec(startedAt) {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function getRoundTimerState(startedAt, durationSec = ROUND_DURATION_SEC) {
  const elapsedSec = getRoundElapsedSec(startedAt);
  const elapsedRatio = Math.min(1, elapsedSec / durationSec);
  return {
    elapsedSec,
    elapsedRatio,
    remainingSec: Math.max(0, durationSec - elapsedSec),
    border: getBorderSegmentProgress(elapsedRatio)
  };
}

function buildPaginationIndexes(count) {
  const safeCount = Math.max(1, count);
  return Array.from({ length: safeCount }, (_, index) => index);
}

module.exports = {
  ROUND_DURATION_SEC,
  getBorderSegmentProgress,
  getRoundElapsedSec,
  getRoundTimerState,
  buildPaginationIndexes
};
