const {
  ROUND_DURATION_SEC,
  getRoundRectSegmentProgresses,
  isRoundTimerActive
} = require('../../utils/partnerRoundTimer');

/** 剩余时间：深绿粗边；已消耗：浅绿细边 */
const REMAIN_COLOR = '#5ec159';
const ELAPSED_COLOR = '#b0e0ae';
const BORDER_RADIUS_RPX = 28;

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
    }
  },

  data: {
    borderVisible: false
  },

  lifetimes: {
    ready() {
      this._initCanvas();
    },
    detached() {
      this._stopLocalTimer();
    }
  },

  pageLifetimes: {
    show() {
      this._restartLocalTimer();
    },
    hide() {
      this._stopLocalTimer();
      this._hideBorder();
    }
  },

  observers: {
    'startedAt, timerActive'() {
      this._restartLocalTimer();
    }
  },

  methods: {
    _initCanvas() {
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
      const raw = this.properties.startedAt;
      const ts = Number(raw);
      if (!Number.isFinite(ts) || ts <= 0) return 0;
      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
      return isRoundTimerActive(ts, durationSec) ? ts : 0;
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

    _drawBorder() {
      const ctx = this._ctx;
      const w = this._width;
      const h = this._height;
      if (!ctx || !w || !h) return;

      const startedAt = this._resolveStartedAt();
      if (!this.properties.timerActive || !startedAt) {
        this._hideBorder();
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

      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
      const ratio = Math.min(1, Math.max(0, (Date.now() - startedAt) / 1000 / durationSec));

      if (ratio <= 0.0001) {
        this._traceRoundedRect(ctx, xL, yT, xR, yB, r);
        this._strokePath(ctx, REMAIN_COLOR, thick);
      } else {
        const segP = getRoundRectSegmentProgresses(ratio, iw, ih, r);

        // 0 右边：上 → 下
        this._drawLineProgress(ctx, xR, yT + r, xR, yB - r, segP[0], thick, thin);
        // 1 右下圆角
        this._drawArcProgress(ctx, xR - r, yB - r, r, 0, Math.PI / 2, segP[1], thick, thin);
        // 2 底边：右 → 左
        this._drawLineProgress(ctx, xR - r, yB, xL + r, yB, segP[2], thick, thin);
        // 3 左下圆角
        this._drawArcProgress(ctx, xL + r, yB - r, r, Math.PI / 2, Math.PI, segP[3], thick, thin);
        // 4 左边：下 → 上
        this._drawLineProgress(ctx, xL, yB - r, xL, yT + r, segP[4], thick, thin);
        // 5 左上圆角
        this._drawArcProgress(ctx, xL + r, yT + r, r, Math.PI, Math.PI * 1.5, segP[5], thick, thin);
        // 6 顶边：左 → 右
        this._drawLineProgress(ctx, xL + r, yT, xR - r, yT, segP[6], thick, thin);
        // 7 右上圆角
        this._drawArcProgress(ctx, xR - r, yT + r, r, Math.PI * 1.5, Math.PI * 2, segP[7], thick, thin);
      }

      if (!this.data.borderVisible) {
        this.setData({ borderVisible: true });
      }
    }
  }
});
