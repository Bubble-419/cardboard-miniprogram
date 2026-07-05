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
  const ts = Number(startedAt);
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

/** 计时仍在 5 分钟窗口内，过期时间戳视为无效 */
function isRoundTimerActive(startedAt, durationSec = ROUND_DURATION_SEC) {
  const ts = Number(startedAt);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const elapsedSec = (Date.now() - ts) / 1000;
  return elapsedSec >= 0 && elapsedSec < durationSec;
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

/**
 * 圆角矩形 8 段路径（4 直边 + 4 圆角），从右上角顺时针
 * 返回每段的 elapsed 进度 [0,1]
 */
function getRoundRectSegmentProgresses(ratio, w, h, r) {
  const safeR = Math.max(0, Math.min(r, w / 2, h / 2));
  const lineH = Math.max(0, h - 2 * safeR);
  const lineW = Math.max(0, w - 2 * safeR);
  const arcLen = (Math.PI / 2) * safeR;
  const lens = [lineH, arcLen, lineW, arcLen, lineH, arcLen, lineW, arcLen];
  const total = lens.reduce((sum, len) => sum + len, 0) || 1;
  let dist = Math.min(1, Math.max(0, ratio)) * total;
  return lens.map((len) => {
    if (len <= 0) return 0;
    if (dist <= 0) return 0;
    if (dist >= len) {
      dist -= len;
      return 1;
    }
    const p = dist / len;
    dist = 0;
    return p;
  });
}

module.exports = {
  ROUND_DURATION_SEC,
  getBorderSegmentProgress,
  getRoundElapsedSec,
  isRoundTimerActive,
  getRoundTimerState,
  buildPaginationIndexes,
  getRoundRectSegmentProgresses
};
