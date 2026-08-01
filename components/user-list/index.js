const {
  ROUND_DURATION_SEC,
  isRoundTimerActive,
  getRoundTimerState
} = require('../../utils/partnerRoundTimer');

const REMAIN_COLOR = '#5ec159';
const ELAPSED_COLOR = '#b0e0ae';
const EXPIRE_ANIM_MS = 2000;

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
    /** 本回合首次倒计时起点（全员共享；卡片循环不得变化） */
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
    /** 轮次+行动玩家标识；变化时重置头像倒计时 */
    roundTimerKey: {
      type: String,
      value: ''
    },
    /** 引导蒙层展示时隐藏原生 canvas（april 修复） */
    suppressTimerCanvas: {
      type: Boolean,
      value: false
    },
    /** 顶部叠放最多直接展示数；超出以 +N 显示。0 表示不截断 */
    maxVisible: {
      type: Number,
      value: 0
    }
  },

  data: {
    defaultAvatar: '/assets/avatar/frame_2085662311_1x.png',
    resolvedActingUser: null,
    resolvedSelectedUser: null,
    resolvedIndicatorUser: null,
    actingFrameMode: 'spin',
    displayList: [],
    overflowCount: 0
  },

  observers: {
    'avatarList, maxVisible': function syncDisplayList(avatarList, maxVisible) {
      const list = Array.isArray(avatarList) ? avatarList : [];
      const max = Number(maxVisible) || 0;
      const nextDisplay = max > 0 && list.length > max ? list.slice(0, max) : list;
      const nextOverflow = max > 0 && list.length > max ? list.length - max : 0;
      // 临时 HTTPS 签名变化时稳定键不变，避免无意义 setData 触发 <image> 重载闪烁
      const nextFp = this._avatarDisplayFingerprint(nextDisplay, nextOverflow);
      if (nextFp && nextFp === this._avatarDisplayFingerprintCache) {
        return;
      }
      this._avatarDisplayFingerprintCache = nextFp;
      this.setData({
        displayList: nextDisplay,
        overflowCount: nextOverflow
      });
    },
    'actingUser, currentUser, selectedUser, indicatorUser, showActingFrame, enableSelectedFrame': function syncFrameUsers() {
      this._syncFrameUsers();
      this._syncActingFrameMode();
    },
    'roundStartedAt, roundTimerActive, durationSec, roundTimerKey': function syncActingFrame() {
      this._syncRoundTimerKey();
      this._syncActingFrameMode();
    },
    suppressTimerCanvas(hidden) {
      if (!hidden && this.data.actingFrameMode === 'timer') {
        setTimeout(() => this._initActingTimerCanvas(), 16);
      }
    }
  },

  lifetimes: {
    attached() {
      const list = Array.isArray(this.properties.avatarList) ? this.properties.avatarList : [];
      const max = Number(this.properties.maxVisible) || 0;
      const nextDisplay = max > 0 && list.length > max ? list.slice(0, max) : list;
      const nextOverflow = max > 0 && list.length > max ? list.length - max : 0;
      this._avatarDisplayFingerprintCache = this._avatarDisplayFingerprint(nextDisplay, nextOverflow);
      this.setData({
        displayList: nextDisplay,
        overflowCount: nextOverflow
      });
      this._syncFrameUsers();
      this._syncRoundTimerKey();
      this._syncActingFrameMode();
      this._startExpireWatch();
    },
    detached() {
      this._stopActingTimerDraw();
      this._clearExpireTimer();
      this._stopExpireWatch();
    }
  },

  pageLifetimes: {
    show() {
      // 页面重新可见时重置上次生命周期的到期标记，防止旧锚点误触发震动/动画
      this._expireAnimPlayed = false;
      this._expiringTriggered = false;
      this._clearExpireTimer();
      if (this.data.actingFrameMode === 'timer' || this.data.actingFrameMode === 'expiring') {
        this.setData({ actingFrameMode: 'spin' });
      }
      this._syncActingFrameMode();
      this._startExpireWatch();
    },
    hide() {
      this._stopActingTimerDraw();
      this._stopExpireWatch();
    }
  },

  methods: {
    /** 忽略临时链 query 签名，只比较展示用稳定键 */
    _stableAvatarSrc(url) {
      if (!url || typeof url !== 'string') return '';
      if (url.startsWith('/') || url.startsWith('cloud://') || url.startsWith('wxfile://')) {
        return url;
      }
      const q = url.indexOf('?');
      return q >= 0 ? url.slice(0, q) : url;
    },

    _avatarDisplayFingerprint(list, overflowCount) {
      const rows = (list || []).map((item) => {
        if (!item) return '-';
        const id = item.id != null ? item.id : '';
        const src = this._stableAvatarSrc(
          item.avatar || item.avatarImage || item.url || ''
        );
        const name = item.nickName || '';
        const me = item.isMe ? 1 : 0;
        return `${id}:${src}:${name}:${me}`;
      });
      return `${overflowCount || 0}#${rows.join('|')}`;
    },

    _syncRoundTimerKey() {
      const key = this.properties.roundTimerKey || '';
      if (key !== this._seenRoundTimerKey) {
        this._seenRoundTimerKey = key;
        this._expireAnimPlayed = false;
        this._expiringTriggered = false;
        this._clearExpireTimer();
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

    _getTurnStartedAt() {
      const ts = Number(this.properties.roundStartedAt);
      return Number.isFinite(ts) && ts > 0 ? ts : 0;
    },

    /** 是否仍在「本回合第一次倒计时」窗口内（全员用同一墙钟判断，保证同步） */
    _isFirstCountdownActive() {
      const ts = this._getTurnStartedAt();
      if (!ts) return false;
      if (this.properties.roundTimerActive !== true) return false;
      return isRoundTimerActive(ts, this.properties.durationSec || ROUND_DURATION_SEC);
    },

    _hasFirstCountdownEnded() {
      const ts = this._getTurnStartedAt();
      if (!ts) return false;
      const durationSec = this.properties.durationSec || ROUND_DURATION_SEC;
      return (Date.now() - ts) / 1000 >= durationSec - 0.25;
    },

    _clearExpireTimer() {
      if (this._expireTimer) {
        clearTimeout(this._expireTimer);
        this._expireTimer = null;
      }
    },

    _startExpireWatch() {
      this._stopExpireWatch();
      // 定时按共享锚点判定是否该切循环动效，避免只靠属性变化导致各端不同步
      this._expireWatch = setInterval(() => {
        if (this.data.actingFrameMode === 'timer' && this._hasFirstCountdownEnded()) {
          this._triggerExpireAnimation();
        } else if (
          this.data.actingFrameMode !== 'spin'
          && this.data.actingFrameMode !== 'expiring'
          && this._hasFirstCountdownEnded()
          && this.properties.showActingFrame
          && this.data.resolvedActingUser != null
        ) {
          this._enterSpinMode();
        }
      }, 200);
    },

    _stopExpireWatch() {
      if (this._expireWatch) {
        clearInterval(this._expireWatch);
        this._expireWatch = null;
      }
    },

    _enterSpinMode() {
      this._stopActingTimerDraw();
      if (this.data.actingFrameMode !== 'spin') {
        this.setData({ actingFrameMode: 'spin' });
      }
    },

    _triggerExpireAnimation() {
      if (this._expiringTriggered || this.data.actingFrameMode === 'expiring') return;
      if (this._expireAnimPlayed) {
        this._enterSpinMode();
        return;
      }
      this._expiringTriggered = true;
      this._expireAnimPlayed = true;
      this._stopActingTimerDraw();
      this.setData({ actingFrameMode: 'expiring' });
      this._expireTimer = setTimeout(() => {
        this._expireTimer = null;
        this._expiringTriggered = false;
        this.setData({ actingFrameMode: 'spin' });
      }, EXPIRE_ANIM_MS);
    },

    _syncActingFrameMode() {
      if (!this.properties.showActingFrame || this.data.resolvedActingUser == null) {
        this._clearExpireTimer();
        this._stopActingTimerDraw();
        this._expiringTriggered = false;
        this._expireAnimPlayed = false;
        this._enterSpinMode();
        return;
      }

      if (this.data.actingFrameMode === 'expiring') {
        return;
      }

      // 核心规则（全员同一墙钟）：第一次倒计时窗口内 → timer；结束后 → spin，直到换人
      if (this._isFirstCountdownActive()) {
        this._expireAnimPlayed = false;
        this._expiringTriggered = false;
        this._clearExpireTimer();
        if (this.data.actingFrameMode !== 'timer') {
          this.setData({ actingFrameMode: 'timer' }, () => this._initActingTimerCanvas());
        } else {
          this._restartActingTimerDraw();
        }
        return;
      }

      if (this._hasFirstCountdownEnded()) {
        // 正在倒计时绘制中：播一次到期过渡；否则直接循环动效（中途加入/已播过）
        if (this.data.actingFrameMode === 'timer' && !this._expireAnimPlayed) {
          this._triggerExpireAnimation();
        } else {
          this._expireAnimPlayed = true;
          this._enterSpinMode();
        }
        return;
      }

      // 尚无锚点：循环动效占位，等共享锚点到达后再进倒计时
      this._enterSpinMode();
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

      if (!this._isFirstCountdownActive()) {
        this._stopActingTimerDraw();
        if (this._hasFirstCountdownEnded()) {
          this._triggerExpireAnimation();
        } else {
          this._syncActingFrameMode();
        }
        return;
      }

      const startedAt = this._getTurnStartedAt();
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
