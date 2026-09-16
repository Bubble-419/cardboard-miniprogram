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
  return Math.max(0, (Date.now() - ts) / 1000);
}

/**
 * 计时锚点在整个业务阶段内都有效。每个客户端用同一锚点计算 5 分钟循环，
 * 避免到点后由某台设备重复写服务端时间造成多端漂移。
 */
function isRoundTimerActive(startedAt) {
  const ts = Number(startedAt);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const elapsedSec = (Date.now() - ts) / 1000;
  return elapsedSec >= 0;
}

/**
 * 共享服务端锚点下的当前 5 分钟循环起点。
 * 到期后不改服务端时间戳，各端用同一锚点取模，避免多端漂移。
 */
function getRoundCycleStartedAt(startedAt, durationSec = ROUND_DURATION_SEC, now = Date.now()) {
  const ts = Number(startedAt);
  const durationMs = (Number(durationSec) || ROUND_DURATION_SEC) * 1000;
  if (!Number.isFinite(ts) || ts <= 0 || durationMs <= 0) return 0;
  const elapsed = Number(now) - ts;
  if (elapsed < 0) return 0;
  return ts + Math.floor(elapsed / durationMs) * durationMs;
}

function getRoundTimerState(startedAt, durationSec = ROUND_DURATION_SEC) {
  const elapsedSecExact = getRoundElapsedSec(startedAt);
  const elapsedSec = Math.floor(elapsedSecExact);
  const cycleElapsedSec = durationSec > 0 ? elapsedSecExact % durationSec : 0;
  const elapsedRatio = durationSec > 0 ? cycleElapsedSec / durationSec : 0;
  return {
    elapsedSec,
    cycleElapsedSec,
    elapsedRatio,
    remainingSec: Math.max(0, Math.ceil(durationSec - cycleElapsedSec)),
    border: getBorderSegmentProgress(elapsedRatio)
  };
}

const PAGINATION_MAX_VISIBLE = 6;

function buildPaginationIndexes(count) {
  const safeCount = Math.max(1, count);
  return Array.from({ length: safeCount }, (_, index) => index);
}

/**
 * Instagram 风格分页点：最多可见 6 个；超出时滑动窗口，边缘点缩小暗示还有更多。
 * @returns {{ key: number, sizeClass: string, active: boolean }[]}
 */
function buildPaginationDots(activeIndex, count) {
  const total = Math.max(1, Number(count) || 1);
  const active = Math.min(Math.max(0, Number(activeIndex) || 0), total - 1);

  const makeDot = (realIndex, size) => ({
    key: realIndex,
    sizeClass: `dot-${size}`,
    active: realIndex === active
  });

  if (total <= PAGINATION_MAX_VISIBLE) {
    return Array.from({ length: total }, (_, index) => (
      makeDot(index, index === active ? 'lg' : 'md')
    ));
  }

  // 窗口尽量让当前页落在偏左中位（slot 2）；首尾贴边时窗口锁死
  let windowStart;
  if (active <= 2) {
    windowStart = 0;
  } else if (active >= total - 3) {
    windowStart = total - PAGINATION_MAX_VISIBLE;
  } else {
    windowStart = active - 2;
  }

  const hasMoreLeft = windowStart > 0;
  const hasMoreRight = windowStart + PAGINATION_MAX_VISIBLE < total;
  const dots = [];

  for (let i = 0; i < PAGINATION_MAX_VISIBLE; i++) {
    const realIndex = windowStart + i;
    let size = 'md';

    if (realIndex === active) {
      size = 'lg';
    } else if (hasMoreLeft && i === 0) {
      size = 'xs';
    } else if (hasMoreLeft && i === 1) {
      size = 'sm';
    } else if (hasMoreRight && i === PAGINATION_MAX_VISIBLE - 1) {
      size = 'xs';
    } else if (hasMoreRight && i === PAGINATION_MAX_VISIBLE - 2) {
      size = 'sm';
    }

    dots.push(makeDot(realIndex, size));
  }

  return dots;
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
  PAGINATION_MAX_VISIBLE,
  getBorderSegmentProgress,
  getRoundElapsedSec,
  isRoundTimerActive,
  getRoundCycleStartedAt,
  getRoundTimerState,
  buildPaginationIndexes,
  buildPaginationDots,
  getRoundRectSegmentProgresses
};
