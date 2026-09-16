const {
  ROUND_DURATION_SEC,
  getRoundRectSegmentProgresses,
  getRoundCycleStartedAt,
  isRoundTimerActive
} = require('../../utils/partnerRoundTimer');

/** 剩余时间：深绿粗边；已消耗：浅绿细边 */
const REMAIN_COLOR = '#5ec159';
const ELAPSED_COLOR = '#b0e0ae';
const BORDER_RADIUS_RPX = 28;
const EXPIRE_ANIM_MS = 2000;

/** 静默边框：0–80 dB 走完整半周；40 dB 为黄绿阈值 */
const SOUND_MAX_DB = 80;
const SOUND_WARN_DB = 40;
const SOUND_EASE_MS = 420;
const SOUND_TICK_MS = 32;
const SOUND_WARN_HOLD_MS = 700;
const SOUND_COLOR_STOPS = [
  { t: 0, rgb: [62, 198, 201] },
  { t: 0.18, rgb: [126, 240, 208] },
  { t: 0.36, rgb: [94, 193, 89] },
  { t: 0.5, rgb: [198, 224, 90] },
  { t: 0.62, rgb: [240, 210, 74] },
  { t: 0.78, rgb: [245, 160, 58] },
  { t: 1, rgb: [240, 90, 74] }
];

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t))
  ];
}

function colorAtPathT(t) {
  const x = clamp01(t);
  for (let i = 1; i < SOUND_COLOR_STOPS.length; i++) {
    if (x <= SOUND_COLOR_STOPS[i].t) {
      const prev = SOUND_COLOR_STOPS[i - 1];
      const span = SOUND_COLOR_STOPS[i].t - prev.t || 1;
      return mixRgb(prev.rgb, SOUND_COLOR_STOPS[i].rgb, (x - prev.t) / span);
    }
  }
  return SOUND_COLOR_STOPS[SOUND_COLOR_STOPS.length - 1].rgb;
}

function rgba(rgb, a) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, a))})`;
}

function addLinePoints(pts, x1, y1, x2, y2, steps) {
  const n = Math.max(1, steps);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
  }
}

function addArcPoints(pts, cx, cy, r, start, end, ccw, steps) {
  const twoPi = Math.PI * 2;
  let delta;
  if (ccw) {
    delta = end - start;
    if (delta <= 0) delta += twoPi;
  } else {
    delta = start - end;
    if (delta <= 0) delta += twoPi;
    delta = -delta;
  }
  const n = Math.max(2, steps);
  for (let i = 1; i <= n; i++) {
    const a = start + delta * (i / n);
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
}

function buildSoundHalfPath(w, h, r, pad, goRight) {
  const xL = pad;
  const yT = pad;
  const xR = w - pad;
  const yB = h - pad;
  const cx = (xL + xR) / 2;
  const pts = [{ x: cx, y: yB }];
  const lineSteps = (len) => Math.max(3, Math.round(Math.abs(len) / 10));
  const arcSteps = Math.max(5, Math.round((Math.PI / 2) * r / 7));
  if (goRight) {
    addLinePoints(pts, cx, yB, xR - r, yB, lineSteps(xR - r - cx));
    addArcPoints(pts, xR - r, yB - r, r, Math.PI / 2, 0, false, arcSteps);
    addLinePoints(pts, xR, yB - r, xR, yT + r, lineSteps(yB - yT - 2 * r));
    addArcPoints(pts, xR - r, yT + r, r, 0, -Math.PI / 2, false, arcSteps);
    addLinePoints(pts, xR - r, yT, cx, yT, lineSteps(xR - r - cx));
  } else {
    addLinePoints(pts, cx, yB, xL + r, yB, lineSteps(cx - (xL + r)));
    addArcPoints(pts, xL + r, yB - r, r, Math.PI / 2, Math.PI, true, arcSteps);
    addLinePoints(pts, xL, yB - r, xL, yT + r, lineSteps(yB - yT - 2 * r));
    addArcPoints(pts, xL + r, yT + r, r, Math.PI, Math.PI * 1.5, true, arcSteps);
    addLinePoints(pts, xL + r, yT, cx, yT, lineSteps(cx - (xL + r)));
  }
  return pts;
}

function strokeSoundBand(ctx, pts, progress, lineWidth) {
  if (!pts || pts.length < 2 || progress <= 0.004) return;
  let totalLen = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const seg = Math.hypot(dx, dy);
    segs.push({ dx, dy, seg, x1: pts[i - 1].x, y1: pts[i - 1].y });
    totalLen += seg;
  }
  if (totalLen < 1) return;
  const drawLen = totalLen * clamp01(progress);
  const fadeStart = drawLen * 0.86;
  const passes = [
    { w: lineWidth * 3.2, a: 0.15 },
    { w: lineWidth * 1.75, a: 0.3 },
    { w: lineWidth, a: 1 }
  ];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  passes.forEach((pass) => {
    let traveled = 0;
    ctx.lineWidth = pass.w;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.seg < 0.01) continue;
      if (traveled >= drawLen) break;
      const next = Math.min(drawLen, traveled + s.seg);
      const tMid = ((traveled + next) / 2) / totalLen;
      let alpha = pass.a;
      if (next > fadeStart) {
        const fadeT = (next - fadeStart) / Math.max(0.001, drawLen - fadeStart);
        alpha *= 1 - fadeT * fadeT;
      }
      const cut = (next - traveled) / s.seg;
      ctx.beginPath();
      ctx.strokeStyle = rgba(colorAtPathT(tMid), alpha);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x1 + s.dx * cut, s.y1 + s.dy * cut);
      ctx.stroke();
      traveled = next;
    }
  });
}

Component({
  properties: {
    startedAt: {
      type: null,
      value: 0
    },
    timerActive: {
      type: Boolean,
      value: false
    },
    durationSec: {
      type: Number,
      value: ROUND_DURATION_SEC
    },
    loop: {
      type: Boolean,
      value: true
    },
    /** 引导蒙层展示时隐藏原生 canvas，避免盖不住倒计时边框 */
    suppressCanvas: {
      type: Boolean,
      value: false
    },
    /** default | rainbow | sound */
    borderVariant: {
      type: String,
      value: ''
    },
    /**
     * 声贝等级 0~1：1 ≈ 80 dB，0.5 ≈ 40 dB。
     * 由外部页面传入（发起者本地采样或轮询同步值）
     */
    soundLevel: {
      type: Number,
      value: 0
    }
  },

  data: {
    borderVisible: false,
    displayMode: 'idle',
    soundTooLoud: false
  },

  lifetimes: {
    ready() {
      this._syncDisplayMode();
      this._syncSoundVisual();
    },
    detached() {
      this._stopLocalTimer();
      this._clearExpireTimer();
      this._stopSoundVisual();
    }
  },

  pageLifetimes: {
    show() {
      // 页面重新可见时重置上一次生命周期留下的倒计时状态，
      // 防止旧的过期 startedAt 被 _hasNaturallyExpired 误判为需要触发震动
      this._timerWasActive = false;
      this._sawActiveCountdown = false;
      this._expiringTriggered = false;
      this._localCycleStartedAt = 0;
      this._clearExpireTimer();
      this._syncDisplayMode();
      this._restartLocalTimer();
      this._syncSoundVisual();
    },
    hide() {
      // 只停绘制，保持最后一帧视觉态，避免转场时卡片框布局突变
      this._stopLocalTimer();
      this._clearExpireTimer();
      this._stopSoundVisual();
    }
  },

  observers: {
    suppressCanvas(hidden) {
      if (!hidden && this.data.displayMode === 'timer') {
        // 蒙层关闭后重建 canvas
        setTimeout(() => this._initCanvas(), 16);
      }
    },
    'startedAt, timerActive, borderVariant'() {
      const serverTs = Number(this.properties.startedAt);
      const prev = this._lastServerStartedAt || 0;
      if (Number.isFinite(serverTs) && serverTs > 0 && serverTs !== prev) {
        this._lastServerStartedAt = serverTs;
        this._localCycleStartedAt = 0;
        this._expiringTriggered = false;
        // 换戳后必须重新经历「活跃倒计时」，避免旧过期戳直接触发震动
        this._sawActiveCountdown = false;
        this._clearExpireTimer();
        // 到期动画中收到新周期时打断，避免下一轮不刷新边框倒计时
        if (this.data.displayMode === 'expiring') {
          this.setData({ displayMode: 'idle' });
        }
      } else if (Number.isFinite(serverTs) && serverTs > 0) {
        this._localCycleStartedAt = 0;
      }
      this._syncDisplayMode();
      this._syncSoundVisual();
    },
    soundLevel(level) {
      this._soundTarget = clamp01(Number(level) || 0);
      this._syncSoundVisual();
    }
  },

  methods: {
    _clearExpireTimer() {
      if (this._expireTimer) {
        clearTimeout(this._expireTimer);
        this._expireTimer = null;
      }
    },

    _hasNaturallyExpired() {
      const raw = this._getRawStartedAt();
      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
      if (!Number.isFinite(raw) || raw <= 0) return false;
      return (Date.now() - raw) / 1000 >= durationSec - 0.25;
    },

    _getRawStartedAt() {
      const local = Number(this._localCycleStartedAt);
      if (Number.isFinite(local) && local > 0) return local;
      return Number(this.properties.startedAt);
    },

    _syncDisplayMode() {
      const startedAt = this._resolveStartedAt();
      const timerOn = this.properties.timerActive === true && (startedAt > 0 || this.properties.loop === true);

      if (this.data.displayMode === 'expiring') {
        // 到期抖动必须播完；新服务端锚点由 observer 打断。循环取模后的下一轮起点
        // 不能在这里当成“新周期已激活”，否则 2s 动画会被立刻掐掉并再次到期。
        return;
      }

      if (timerOn) {
        const activeStartedAt = this._resolveStartedAt();
        if (!activeStartedAt) {
          // 仅「本组件已在 timer 绘制中自然走完」才触发到期震动；
          // 进页时直接塞入过期戳 / 被旧戳覆盖，一律静默 idle，不震动
          if (this.data.displayMode === 'timer' && this._sawActiveCountdown) {
            this._triggerExpireAnimation();
          } else {
            this._timerWasActive = false;
            this._sawActiveCountdown = false;
            this._stopLocalTimer();
            this._hideBorder();
            if (this.data.displayMode !== 'idle') {
              this.setData({ displayMode: 'idle' });
            }
          }
          return;
        }
        this._timerWasActive = true;
        this._sawActiveCountdown = true;
        this._expiringTriggered = false;
        this._clearExpireTimer();
        if (this.data.displayMode !== 'timer') {
          this.setData({ displayMode: 'timer' }, () => this._initCanvas());
        } else if (this._useCssBorder() || this.properties.suppressCanvas) {
          this._restartLocalTimer();
        } else if (!this._ctx) {
          this._initCanvas();
        } else {
          this._restartLocalTimer();
        }
        return;
      }

      if (
        this._sawActiveCountdown
        && this.data.displayMode === 'timer'
        && this._hasNaturallyExpired()
      ) {
        this._triggerExpireAnimation();
        return;
      }

      this._timerWasActive = false;
      this._sawActiveCountdown = false;
      this._clearExpireTimer();
      if (!this.properties.timerActive && this.data.displayMode !== 'idle') {
        this._localCycleStartedAt = 0;
        this.setData({ displayMode: 'idle' });
      }
    },

    _restartCountdownCycle() {
      const startedAt = Date.now();
      this._localCycleStartedAt = startedAt;
      this._expiringTriggered = false;
      this._timerWasActive = true;
      this.setData({ displayMode: 'timer' }, () => this._initCanvas());
      this.triggerEvent('timerexpire', { startedAt, loop: true });
    },

    _vibrateExpireFeedback() {
      const buzz = () => {
        try {
          if (typeof wx.vibrateShort === 'function') {
            wx.vibrateShort({ type: 'medium' });
          }
        } catch (e) {
          // 模拟器或不支持震动时忽略
        }
      };
      // zeng~ zeng~：两下短震，间隔约半拍
      buzz();
      setTimeout(buzz, 600);
    },

    _triggerExpireAnimation() {
      if (this._expiringTriggered || this.data.displayMode === 'expiring') return;
      // 没有真正跑过倒计时就到期 → 静默，不震（进页旧戳/竞态覆盖）
      if (!this._sawActiveCountdown) {
        this._timerWasActive = false;
        this._hideBorder();
        if (this.data.displayMode !== 'idle') {
          this.setData({ displayMode: 'idle' });
        }
        return;
      }
      this._expiringTriggered = true;
      this._timerWasActive = false;
      this._sawActiveCountdown = false;
      this._stopLocalTimer();
      this._hideBorder();
      this._vibrateExpireFeedback();
      this.setData({ displayMode: 'expiring' });
      this._expireTimer = setTimeout(() => {
        this._expireTimer = null;
        this._expiringTriggered = false;
        this._localCycleStartedAt = 0;
        this.setData({ displayMode: 'idle' }, () => {
          this.triggerEvent('timerexpire', {
            startedAt: this._getRawStartedAt(),
            loop: this.properties.loop === true
          });
          // 动画期间可能已写入新 startedAt，结束后立刻按最新周期恢复
          this._syncDisplayMode();
        });
      }, EXPIRE_ANIM_MS);
    },

    _initCanvas() {
      if (this.data.displayMode !== 'timer') return;
      if (this._useCssBorder() || this.properties.suppressCanvas) {
        this._restartLocalTimer();
        return;
      }

      const query = this.createSelectorQuery().in(this);
      query.select('#gctCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) {
            setTimeout(() => this._initCanvas(), 80);
            return;
          }
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
          const width = res[0].width;
          const height = res[0].height;

          if (!width || !height) {
            setTimeout(() => this._initCanvas(), 80);
            return;
          }

          canvas.width = Math.floor(width * dpr);
          canvas.height = Math.floor(height * dpr);
          ctx.scale(dpr, dpr);

          this._canvas = canvas;
          this._ctx = ctx;
          this._width = width;
          this._height = height;
          this._restartLocalTimer();
        });
    },

    _getRpxToPx() {
      try {
        const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : null;
        return (windowInfo && windowInfo.windowWidth ? windowInfo.windowWidth : 375) / 750;
      } catch (e) {
        return 0.5;
      }
    },

    _resolveStartedAt() {
      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
      const serverTs = Number(this.properties.startedAt);
      if (Number.isFinite(serverTs) && serverTs > 0 && isRoundTimerActive(serverTs)) {
        return getRoundCycleStartedAt(serverTs, durationSec);
      }
      const local = Number(this._localCycleStartedAt);
      if (Number.isFinite(local) && local > 0 && isRoundTimerActive(local)) {
        return getRoundCycleStartedAt(local, durationSec);
      }
      return 0;
    },

    _hideBorder() {
      const ctx = this._ctx;
      const w = this._width;
      const h = this._height;
      if (ctx && w && h) {
        ctx.clearRect(0, 0, w, h);
      }
      if (this.data.borderVisible) {
        this.setData({ borderVisible: false });
      }
    },

    _restartLocalTimer() {
      this._stopLocalTimer();
      if (this.data.displayMode !== 'timer') return;
      const tick = () => this._drawBorder();
      tick();
      this._localTimer = setInterval(tick, 200);
    },

    _stopLocalTimer() {
      if (this._localTimer) {
        clearInterval(this._localTimer);
        this._localTimer = null;
      }
    },

    _traceRoundedRect(ctx, xL, yT, xR, yB, r) {
      ctx.beginPath();
      ctx.moveTo(xR, yT + r);
      ctx.lineTo(xR, yB - r);
      ctx.arc(xR - r, yB - r, r, 0, Math.PI / 2);
      ctx.lineTo(xL + r, yB);
      ctx.arc(xL + r, yB - r, r, Math.PI / 2, Math.PI);
      ctx.lineTo(xL, yT + r);
      ctx.arc(xL + r, yT + r, r, Math.PI, Math.PI * 1.5);
      ctx.lineTo(xR - r, yT);
      ctx.arc(xR - r, yT + r, r, Math.PI * 1.5, Math.PI * 2);
    },

    _strokePath(ctx, color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    },

    _strokeLine(ctx, x1, y1, x2, y2, color, width) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },

    _strokeArc(ctx, cx, cy, radius, startAngle, endAngle, color, width) {
      if (endAngle - startAngle <= 0.0001) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.arc(cx, cy, radius, startAngle, endAngle, false);
      ctx.stroke();
    },

    _drawLineProgress(ctx, x1, y1, x2, y2, progress, thick, thin) {
      const p = Math.min(1, Math.max(0, progress));
      const mx = x1 + (x2 - x1) * p;
      const my = y1 + (y2 - y1) * p;
      if (p > 0.001) {
        this._strokeLine(ctx, x1, y1, mx, my, ELAPSED_COLOR, thin);
      }
      if (p < 0.999) {
        this._strokeLine(ctx, mx, my, x2, y2, REMAIN_COLOR, thick);
      }
    },

    _drawArcProgress(ctx, cx, cy, radius, startAngle, endAngle, progress, thick, thin) {
      const p = Math.min(1, Math.max(0, progress));
      const span = endAngle - startAngle;
      const mid = startAngle + span * p;
      if (p > 0.001) {
        this._strokeArc(ctx, cx, cy, radius, startAngle, mid, ELAPSED_COLOR, thin);
      }
      if (p < 0.999) {
        this._strokeArc(ctx, cx, cy, radius, mid, endAngle, REMAIN_COLOR, thick);
      }
    },

    _useCssBorder() {
      return this.properties.borderVariant === 'rainbow';
    },

    _syncSoundVisual() {
      if (this.properties.borderVariant === 'sound' && this.data.displayMode !== 'expiring') {
        this._startSoundVisual();
        return;
      }
      this._stopSoundVisual();
      if (this.data.soundTooLoud) {
        this.setData({ soundTooLoud: false });
      }
    },

    _startSoundVisual() {
      if (this._soundTimer || this._soundStarting) return;
      this._soundStarting = true;
      this._soundToken = (this._soundToken || 0) + 1;
      const token = this._soundToken;
      this._soundTarget = clamp01(
        this._soundTarget != null ? this._soundTarget : (Number(this.properties.soundLevel) || 0)
      );
      if (this._soundSmooth == null) this._soundSmooth = this._soundTarget;
      this._ensureSoundCanvas(() => {
        this._soundStarting = false;
        if (token !== this._soundToken) return;
        if (this.properties.borderVariant !== 'sound') return;
        const tick = () => {
          if (token !== this._soundToken) return;
          this._tickSoundVisual();
          if (token !== this._soundToken) return;
          this._soundTimer = setTimeout(tick, SOUND_TICK_MS);
        };
        tick();
      });
    },

    _stopSoundVisual() {
      this._soundStarting = false;
      this._soundToken = (this._soundToken || 0) + 1;
      this._over40Since = 0;
      if (this._soundTimer) {
        clearTimeout(this._soundTimer);
        this._soundTimer = null;
      }
      this._soundCtx = null;
      this._soundCanvas = null;
    },

    _ensureSoundCanvas(done) {
      if (this.properties.borderVariant !== 'sound') {
        this._soundStarting = false;
        return;
      }
      if (this._soundCtx && this._soundW && this._soundH) {
        if (done) done();
        return;
      }
      const query = this.createSelectorQuery().in(this);
      query.select('#gctSoundCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (this.properties.borderVariant !== 'sound') {
            this._soundStarting = false;
            return;
          }
          if (!res || !res[0] || !res[0].node) {
            setTimeout(() => this._ensureSoundCanvas(done), 80);
            return;
          }
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
          const width = res[0].width;
          const height = res[0].height;
          if (!width || !height) {
            setTimeout(() => this._ensureSoundCanvas(done), 80);
            return;
          }
          canvas.width = Math.floor(width * dpr);
          canvas.height = Math.floor(height * dpr);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(dpr, dpr);
          this._soundCanvas = canvas;
          this._soundCtx = ctx;
          this._soundW = width;
          this._soundH = height;
          if (done) done();
        });
    },

    _tickSoundVisual() {
      if (this.properties.borderVariant !== 'sound' || this.data.displayMode === 'expiring') {
        this._stopSoundVisual();
        return;
      }
      const ctx = this._soundCtx;
      const w = this._soundW;
      const h = this._soundH;
      if (!ctx || !w || !h) {
        this._soundCtx = null;
        this._ensureSoundCanvas();
        return;
      }
      const target = clamp01(
        this._soundTarget != null ? this._soundTarget : (Number(this.properties.soundLevel) || 0)
      );
      const k = 1 - Math.exp(-SOUND_TICK_MS / SOUND_EASE_MS);
      this._soundSmooth = (this._soundSmooth || 0) + (target - (this._soundSmooth || 0)) * k;
      const db = this._soundSmooth * SOUND_MAX_DB;
      const progress = clamp01(db / SOUND_MAX_DB);

      ctx.clearRect(0, 0, w, h);
      const rpxToPx = this._getRpxToPx();
      const thick = 8 * rpxToPx;
      const pad = thick / 2 + 0.5;
      const xL = pad;
      const yT = pad;
      const xR = w - pad;
      const yB = h - pad;
      const iw = xR - xL;
      const ih = yB - yT;
      const r = Math.max(0, Math.min(BORDER_RADIUS_RPX * rpxToPx, iw / 2, ih / 2));

      this._traceRoundedRect(ctx, xL, yT, xR, yB, r);
      ctx.strokeStyle = 'rgba(176, 224, 174, 0.38)';
      ctx.lineWidth = 4 * rpxToPx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      const bandWidth = 5.5 * rpxToPx;
      const rightPath = buildSoundHalfPath(w, h, r, pad, true);
      const leftPath = buildSoundHalfPath(w, h, r, pad, false);
      strokeSoundBand(ctx, rightPath, progress, bandWidth);
      strokeSoundBand(ctx, leftPath, progress, bandWidth);

      const now = Date.now();
      if (db >= SOUND_WARN_DB) {
        if (!this._over40Since) this._over40Since = now;
        const loud = now - this._over40Since >= SOUND_WARN_HOLD_MS;
        if (loud !== this.data.soundTooLoud) {
          this.setData({ soundTooLoud: loud });
        }
      } else {
        this._over40Since = 0;
        if (this.data.soundTooLoud && db < SOUND_WARN_DB - 2) {
          this.setData({ soundTooLoud: false });
        }
      }
    },

    _drawBorder() {
      if (this._useCssBorder()) {
        const startedAt = this._resolveStartedAt();
        if (!this.properties.timerActive || !startedAt) {
          if (
            this.data.displayMode === 'timer'
            && this._sawActiveCountdown
            && this._hasNaturallyExpired()
          ) {
            this._triggerExpireAnimation();
          }
          return;
        }
        const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
        const ratio = Math.min(1, Math.max(0, (Date.now() - startedAt) / 1000 / durationSec));
        if (ratio >= 0.9999) {
          this._triggerExpireAnimation();
        }
        return;
      }
      const ctx = this._ctx;
      const w = this._width;
      const h = this._height;
      if (!ctx || !w || !h) return;

      const startedAt = this._resolveStartedAt();
      if (!this.properties.timerActive || !startedAt) {
        if (
          this.properties.loop === true
          && this.properties.timerActive === true
          && this._hasNaturallyExpired()
          && this.data.displayMode === 'timer'
          && this._sawActiveCountdown
        ) {
          this._triggerExpireAnimation();
          return;
        }
        this._hideBorder();
        this._syncDisplayMode();
        return;
      }

      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
      const ratio = Math.min(1, Math.max(0, (Date.now() - startedAt) / 1000 / durationSec));

      if (ratio >= 0.9999) {
        this._drawFullElapsedBorder(ctx, w, h);
        if (!this.data.borderVisible) {
          this.setData({ borderVisible: true });
        }
        this._triggerExpireAnimation();
        return;
      }

      ctx.clearRect(0, 0, w, h);

      const rpxToPx = this._getRpxToPx();
      const thick = 8 * rpxToPx;
      const thin = 4 * rpxToPx;
      const pad = thick / 2 + 0.5;
      const xL = pad;
      const yT = pad;
      const xR = w - pad;
      const yB = h - pad;
      const iw = xR - xL;
      const ih = yB - yT;
      const r = Math.max(
        0,
        Math.min(BORDER_RADIUS_RPX * rpxToPx, iw / 2, ih / 2)
      );

      if (ratio <= 0.0001) {
        this._traceRoundedRect(ctx, xL, yT, xR, yB, r);
        this._strokePath(ctx, REMAIN_COLOR, thick);
      } else {
        const segP = getRoundRectSegmentProgresses(ratio, iw, ih, r);

        this._drawLineProgress(ctx, xR, yT + r, xR, yB - r, segP[0], thick, thin);
        this._drawArcProgress(ctx, xR - r, yB - r, r, 0, Math.PI / 2, segP[1], thick, thin);
        this._drawLineProgress(ctx, xR - r, yB, xL + r, yB, segP[2], thick, thin);
        this._drawArcProgress(ctx, xL + r, yB - r, r, Math.PI / 2, Math.PI, segP[3], thick, thin);
        this._drawLineProgress(ctx, xL, yB - r, xL, yT + r, segP[4], thick, thin);
        this._drawArcProgress(ctx, xL + r, yT + r, r, Math.PI, Math.PI * 1.5, segP[5], thick, thin);
        this._drawLineProgress(ctx, xL + r, yT, xR - r, yT, segP[6], thick, thin);
        this._drawArcProgress(ctx, xR - r, yT + r, r, Math.PI * 1.5, Math.PI * 2, segP[7], thick, thin);
      }

      if (!this.data.borderVisible) {
        this.setData({ borderVisible: true });
      }
    },

    _drawFullElapsedBorder(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      const rpxToPx = this._getRpxToPx();
      const thin = 4 * rpxToPx;
      const pad = thin / 2 + 0.5;
      const xL = pad;
      const yT = pad;
      const xR = w - pad;
      const yB = h - pad;
      const iw = xR - xL;
      const ih = yB - yT;
      const r = Math.max(
        0,
        Math.min(BORDER_RADIUS_RPX * rpxToPx, iw / 2, ih / 2)
      );
      this._traceRoundedRect(ctx, xL, yT, xR, yB, r);
      this._strokePath(ctx, ELAPSED_COLOR, thin);
    }
  }
});
