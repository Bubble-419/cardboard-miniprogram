const {
  ROUND_DURATION_SEC,
  getRoundRectSegmentProgresses,
  isRoundTimerActive
} = require('../../utils/partnerRoundTimer');

/** 剩余时间：深绿粗边；已消耗：浅绿细边 */
const REMAIN_COLOR = '#5ec159';
const ELAPSED_COLOR = '#b0e0ae';
const BORDER_RADIUS_RPX = 28;
const EXPIRE_ANIM_MS = 2000;

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
    }
  },

  data: {
    borderVisible: false,
    displayMode: 'idle'
  },

  lifetimes: {
    ready() {
      this._syncDisplayMode();
    },
    detached() {
      this._stopLocalTimer();
      this._clearExpireTimer();
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
    },
    hide() {
      // 只停绘制，保持最后一帧视觉态，避免转场时卡片框布局突变
      this._stopLocalTimer();
      this._clearExpireTimer();
    }
  },

  observers: {
    suppressCanvas(hidden) {
      if (!hidden && this.data.displayMode === 'timer') {
        // 蒙层关闭后重建 canvas
        setTimeout(() => this._initCanvas(), 16);
      }
    },
    'startedAt, timerActive'() {
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
        // 新周期已激活则打断到期动画并进入 timer
        if (this.properties.timerActive === true && startedAt > 0) {
          this._clearExpireTimer();
          this._expiringTriggered = false;
        } else {
          return;
        }
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
      if (Number.isFinite(serverTs) && serverTs > 0 && isRoundTimerActive(serverTs, durationSec)) {
        return serverTs;
      }
      const local = Number(this._localCycleStartedAt);
      if (Number.isFinite(local) && local > 0 && isRoundTimerActive(local, durationSec)) {
        return local;
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

    _drawBorder() {
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
