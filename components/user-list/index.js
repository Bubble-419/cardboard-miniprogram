const {
  ROUND_DURATION_SEC,
  isRoundTimerActive,
  getRoundTimerState
} = require('../../utils/partnerRoundTimer');

const REMAIN_COLOR = '#5ec159';
const ELAPSED_COLOR = '#b0e0ae';
const EXPIRE_ANIM_MS = 1200;

Component({
  properties: {
    avatarList: {
      type: Array,
      value: []
    },
    currentUser: {
      type: String,
      optionalTypes: [Number, null],
      value: null
    },
    actingUser: {
      type: String,
      optionalTypes: [Number, null],
      value: null
    },
    selectedUser: {
      type: String,
      optionalTypes: [Number, null],
      value: null
    },
    indicatorUser: {
      type: String,
      optionalTypes: [Number, null],
      value: null
    },
    enableAdd: {
      type: Boolean,
      value: true
    },
    isFold: {
      type: Boolean,
      value: false
    },
    showName: {
      type: Boolean,
      value: true
    },
    layout: {
      type: String,
      value: 'scroll'
    },
    showActingFrame: {
      type: Boolean,
      value: false
    },
    enableSelectedFrame: {
      type: Boolean,
      value: false
    },
    enableAvatarTap: {
      type: Boolean,
      value: false
    },
    roundStartedAt: {
      type: null,
      value: 0
    },
    roundTimerActive: {
      type: Boolean,
      value: false
    },
    durationSec: {
      type: Number,
      value: ROUND_DURATION_SEC
    },
    /** 轮次+行动玩家标识，变化时重置头像倒计时（卡片循环重启不计入） */
    roundTimerKey: {
      type: String,
      value: ''
    }
  },

  data: {
    defaultAvatar: '/assets/avatar/frame_2085662311_1x.webp',
    resolvedActingUser: null,
    resolvedSelectedUser: null,
    resolvedIndicatorUser: null,
    actingFrameMode: 'spin'
  },

  observers: {
    'actingUser, currentUser, selectedUser, indicatorUser, showActingFrame, enableSelectedFrame': function syncFrameUsers() {
      this._syncFrameUsers();
    },
    'roundStartedAt, roundTimerActive, showActingFrame, actingUser, durationSec, roundTimerKey': function syncActingFrame() {
      this._syncRoundTimerKey();
      this._onRoundStartedAtBump();
      this._syncActingFrameMode();
    }
  },

  lifetimes: {
    attached() {
      this._syncFrameUsers();
      this._syncRoundTimerKey();
      this._syncActingFrameMode();
    },
    detached() {
      this._stopActingTimerDraw();
      this._clearExpireTimer();
    }
  },

  pageLifetimes: {
    show() {
      this._syncActingFrameMode();
    },
    hide() {
      this._stopActingTimerDraw();
    }
  },

  methods: {
    _syncRoundTimerKey() {
      const key = this.properties.roundTimerKey || '';
      if (key && key !== this._seenRoundTimerKey) {
        this._seenRoundTimerKey = key;
        this._countdownFinished = false;
        this._lastSeenStartedAt = 0;
      }
    },

    _onRoundStartedAtBump() {
      const next = Number(this.properties.roundStartedAt);
      const prev = this._lastSeenStartedAt;
      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;

      if (Number.isFinite(prev) && prev > 0 && next !== prev) {
        const elapsedSec = (Date.now() - prev) / 1000;
        if (elapsedSec >= durationSec - 0.5) {
          this._countdownFinished = true;
        }
      }

      if (Number.isFinite(next) && next > 0) {
        this._lastSeenStartedAt = next;
      }
    },

    _syncFrameUsers() {
      const acting = this.properties.actingUser != null
        ? this.properties.actingUser
        : this.properties.currentUser;
      const selected = this.properties.selectedUser;
      const indicator = this.properties.indicatorUser;
      const showSelected = this.properties.enableSelectedFrame === true;
      this.setData({
        resolvedActingUser: this.properties.showActingFrame ? acting : null,
        resolvedSelectedUser: showSelected && selected != null && selected != acting
          ? selected
          : null,
        resolvedIndicatorUser: indicator != null ? indicator : null
      });
    },

    _resolveStartedAt() {
      const raw = this.properties.roundStartedAt;
      const ts = Number(raw);
      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
      if (!Number.isFinite(ts) || ts <= 0) return 0;
      return isRoundTimerActive(ts, durationSec) ? ts : 0;
    },

    _hasNaturallyExpired() {
      const raw = Number(this.properties.roundStartedAt);
      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
      if (!Number.isFinite(raw) || raw <= 0) return false;
      return (Date.now() - raw) / 1000 >= durationSec - 0.25;
    },

    _clearExpireTimer() {
      if (this._expireTimer) {
        clearTimeout(this._expireTimer);
        this._expireTimer = null;
      }
    },

    _triggerExpireAnimation() {
      if (this._expiringTriggered || this.data.actingFrameMode === 'expiring') return;
      this._expiringTriggered = true;
      this._countdownFinished = true;
      this._timerWasActive = false;
      this._stopActingTimerDraw();
      this.setData({ actingFrameMode: 'expiring' });
      this._expireTimer = setTimeout(() => {
        this._expireTimer = null;
        this.setData({ actingFrameMode: 'spin' });
        this._expiringTriggered = false;
        this.triggerEvent('timerexpire');
      }, EXPIRE_ANIM_MS);
    },

    _syncActingFrameMode() {
      if (this.data.actingFrameMode === 'expiring') return;

      if (!this.properties.showActingFrame || this.data.resolvedActingUser == null) {
        this._clearExpireTimer();
        this._stopActingTimerDraw();
        this._timerWasActive = false;
        this._expiringTriggered = false;
        this._countdownFinished = false;
        if (this.data.actingFrameMode !== 'spin') {
          this.setData({ actingFrameMode: 'spin' });
        }
        return;
      }

      if (this._countdownFinished) {
        this._stopActingTimerDraw();
        if (this.data.actingFrameMode !== 'spin') {
          this.setData({ actingFrameMode: 'spin' });
        }
        return;
      }

      const startedAt = this._resolveStartedAt();
      const timerOn = this.properties.roundTimerActive === true && startedAt > 0;

      if (timerOn && !this._countdownFinished) {
        this._timerWasActive = true;
        this._expiringTriggered = false;
        this._clearExpireTimer();
        if (this.data.actingFrameMode !== 'timer') {
          this.setData({ actingFrameMode: 'timer' }, () => this._initActingTimerCanvas());
        } else {
          this._restartActingTimerDraw();
        }
        return;
      }

      if (this._timerWasActive && this.data.actingFrameMode === 'timer' && this._hasNaturallyExpired()) {
        this._triggerExpireAnimation();
        return;
      }

      this._timerWasActive = false;
      this._clearExpireTimer();
      this._stopActingTimerDraw();
      if (this.data.actingFrameMode !== 'spin') {
        this.setData({ actingFrameMode: 'spin' });
      }
    },

    _initActingTimerCanvas() {
      if (this.data.actingFrameMode !== 'timer') return;

      const query = this.createSelectorQuery().in(this);
      query.select('#actingTimerCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) {
            setTimeout(() => this._initActingTimerCanvas(), 80);
            return;
          }

          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
          const width = res[0].width;
          const height = res[0].height;

          if (!width || !height) {
            setTimeout(() => this._initActingTimerCanvas(), 80);
            return;
          }

          canvas.width = Math.floor(width * dpr);
          canvas.height = Math.floor(height * dpr);
          ctx.scale(dpr, dpr);

          this._canvas = canvas;
          this._ctx = ctx;
          this._canvasSize = Math.min(width, height);
          this._restartActingTimerDraw();
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

    _restartActingTimerDraw() {
      this._stopActingTimerDraw();
      if (this.data.actingFrameMode !== 'timer') return;
      const tick = () => this._drawActingTimerBorder();
      tick();
      this._actingTimerDraw = setInterval(tick, 200);
    },

    _stopActingTimerDraw() {
      if (this._actingTimerDraw) {
        clearInterval(this._actingTimerDraw);
        this._actingTimerDraw = null;
      }
      const ctx = this._ctx;
      const size = this._canvasSize;
      if (ctx && size) {
        ctx.clearRect(0, 0, size, size);
      }
    },

    _strokeArc(ctx, cx, cy, radius, startAngle, endAngle, color, width) {
      if (endAngle - startAngle <= 0.0001) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.arc(cx, cy, radius, startAngle, endAngle, false);
      ctx.stroke();
    },

    _drawActingTimerBorder() {
      const ctx = this._ctx;
      const size = this._canvasSize;
      if (!ctx || !size) return;

      const startedAt = this._resolveStartedAt();
      if (this.properties.roundTimerActive !== true || !startedAt) {
        this._stopActingTimerDraw();
        this._syncActingFrameMode();
        return;
      }

      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
      const timerState = getRoundTimerState(startedAt, durationSec);
      const ratio = timerState.elapsedRatio;

      if (ratio >= 0.9999) {
        const rpxToPx = this._getRpxToPx();
        const thin = 4 * rpxToPx;
        const cx = size / 2;
        const cy = size / 2;
        const radius = Math.max(0, size / 2 - thin / 2 - 0.5);
        ctx.clearRect(0, 0, size, size);
        this._strokeArc(ctx, cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2, ELAPSED_COLOR, thin);
        this._triggerExpireAnimation();
        return;
      }

      ctx.clearRect(0, 0, size, size);

      const rpxToPx = this._getRpxToPx();
      const thick = 8 * rpxToPx;
      const thin = 4 * rpxToPx;
      const cx = size / 2;
      const cy = size / 2;
      const radius = Math.max(0, size / 2 - thick / 2 - 0.5);
      const startAngle = -Math.PI / 2;
      const fullCircle = Math.PI * 2;
      const elapsedAngle = startAngle + fullCircle * ratio;
      const endAngle = startAngle + fullCircle;

      if (ratio <= 0.0001) {
        this._strokeArc(ctx, cx, cy, radius, startAngle, endAngle, REMAIN_COLOR, thick);
      } else {
        this._strokeArc(ctx, cx, cy, radius, startAngle, elapsedAngle, ELAPSED_COLOR, thin);
        this._strokeArc(ctx, cx, cy, radius, elapsedAngle, endAngle, REMAIN_COLOR, thick);
      }
    },

    onAddTap() {
      this.triggerEvent('addtap');
    },

    onAvatarTap(e) {
      if (!this.properties.enableAvatarTap) return;
      const dataset = e.currentTarget && e.currentTarget.dataset;
      const playerIndex = dataset && (dataset.playerIndex != null ? dataset.playerIndex : dataset.id);
      if (playerIndex == null || playerIndex === '') return;
      this.triggerEvent('avatartap', { playerIndex, id: playerIndex });
    }
  }
});
