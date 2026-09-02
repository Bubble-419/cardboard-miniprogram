const {
  normalizeHalfStarScore,
  scoreFromTrackX,
  buildStarFills
} = require('../../utils/halfStarScore');

function mapStars(score, activeIndex) {
  return buildStarFills(score).map((row, i) => ({
    index: row.index,
    fill: row.fill,
    active: activeIndex === i
  }));
}

function activeIndexFromScore(score) {
  if (score == null || score === '') return -1;
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return -1;
  return Math.min(4, Math.max(0, Math.ceil(n) - 1));
}

Component({
  properties: {
    value: {
      type: null,
      value: null
    },
    disabled: {
      type: Boolean,
      value: false
    }
  },

  data: {
    stars: mapStars(null, -1),
    gesturing: false
  },

  lifetimes: {
    attached() {
      this._gesturing = false;
      this._previewScore = null;
      this._trackRect = null;
      this._startClientX = null;
      this._lastX = null;
      this._hasActivePreview = false;
      this._seedScore = null;
      this._minTravelPx = 24;
      this._syncFromValue(this.properties.value);
    }
  },

  observers: {
    'value': function (next) {
      if (this._gesturing) return;
      this._syncFromValue(next);
    }
  },

  methods: {
    _syncFromValue(raw) {
      if (raw == null || raw === '') {
        this.setData({
          stars: mapStars(null, -1),
          gesturing: false
        });
        return;
      }
      const score = normalizeHalfStarScore(raw);
      this.setData({
        stars: mapStars(score, -1),
        gesturing: false
      });
    },

    _paint(score) {
      this.setData({
        stars: mapStars(score, activeIndexFromScore(score)),
        gesturing: true
      });
    },

    _readClientX(e) {
      const t = (e && e.touches && e.touches[0])
        || (e && e.changedTouches && e.changedTouches[0]);
      return t && Number.isFinite(t.clientX) ? t.clientX : null;
    },

    _applyClientX(clientX, options) {
      const rect = this._trackRect;
      if (!rect || !(rect.width > 0) || clientX == null) return this._previewScore;

      const force = !!(options && options.force);
      const startX = this._startClientX;
      const travel = startX != null ? Math.abs(clientX - startX) : 0;
      const minTravel = this._minTravelPx != null ? this._minTravelPx : 24;
      if (!force && !this._hasActivePreview && travel < minTravel) {
        return this._previewScore;
      }

      if (!force && this._seedScore != null && !this._hasActivePreview && clientX < rect.left) {
        return this._previewScore;
      }

      const score = scoreFromTrackX(clientX, rect.left, rect.width, {
        minScore: 0.5,
        maxScore: 5
      });
      this._hasActivePreview = true;
      if (this._previewScore === score) return score;
      this._previewScore = score;
      this._paint(score);
      this.triggerEvent('preview', { score });
      return score;
    },

    _measureTrack(done) {
      this.createSelectorQuery()
        .in(this)
        .select('.star-track')
        .boundingClientRect((rect) => {
          if (rect && rect.width > 0) this._trackRect = rect;
          if (typeof done === 'function') done(this._trackRect);
        })
        .exec();
    },

    setTrackRect(rect) {
      if (rect && rect.width > 0) {
        this._trackRect = {
          left: Number(rect.left) || 0,
          width: Number(rect.width) || 0
        };
      }
    },

    beginExternalGesture(clientX, options) {
      if (this.properties.disabled) return;
      const opts = options || {};
      if (opts.trackRect) this.setTrackRect(opts.trackRect);
      if (opts.minTravelPx != null) {
        this._minTravelPx = Number(opts.minTravelPx) || 24;
      }

      this._gesturing = true;
      this._startClientX = clientX;
      this._lastX = clientX;
      this._hasActivePreview = false;
      this._seedScore = opts.seedScore != null
        ? normalizeHalfStarScore(opts.seedScore)
        : null;
      this._previewScore = this._seedScore;

      if (this._seedScore != null) {
        this._paint(this._seedScore);
        this.triggerEvent('preview', { score: this._seedScore });
      } else {
        this.setData({ gesturing: true });
      }
      this.triggerEvent('gesturestart');

      this._measureTrack((rect) => {
        if (!this._gesturing) return;
        if (rect && this._lastX != null) {
          this._applyClientX(this._lastX, { force: true });
        }
      });
      if (this._trackRect) {
        this._applyClientX(clientX, { force: true });
      }
    },

    moveExternalGesture(clientX) {
      if (!this._gesturing || this.properties.disabled) return;
      if (clientX == null) return;
      this._lastX = clientX;
      if (this._trackRect) {
        this._applyClientX(clientX);
        return;
      }
      this._measureTrack((rect) => {
        if (!this._gesturing) return;
        if (rect) this._applyClientX(this._lastX);
      });
    },

    cancelExternalGesture(restoreScore) {
      const raw = restoreScore !== undefined ? restoreScore : this.properties.value;
      this._gesturing = false;
      this._previewScore = null;
      this._seedScore = null;
      this._hasActivePreview = false;
      this._syncFromValue(raw);
      this.triggerEvent('gestureend');
    },

    endExternalGesture(clientX) {
      if (!this._gesturing) {
        return { confirmed: false, score: null };
      }
      if (clientX != null) this._lastX = clientX;

      const travel = this._startClientX != null && this._lastX != null
        ? Math.abs(this._lastX - this._startClientX)
        : 0;
      const minTravel = this._minTravelPx != null ? this._minTravelPx : 24;
      const canConfirm = this._hasActivePreview
        && this._previewScore != null
        && travel >= minTravel;

      if (canConfirm) {
        const score = this._previewScore;
        this.setData({
          stars: mapStars(score, -1),
          gesturing: false
        });
        this._gesturing = false;
        this._previewScore = null;
        const seed = this._seedScore;
        this._seedScore = null;
        this._hasActivePreview = false;
        this.triggerEvent('scoreconfirm', { score });
        this.triggerEvent('gestureend');
        return { confirmed: true, score, seedScore: seed };
      }

      const restore = this._seedScore;
      this.cancelExternalGesture(restore);
      return { confirmed: false, score: null };
    },

    onTouchStart(e) {
      if (this.properties.disabled) return;
      this._gesturing = true;
      this._previewScore = null;
      this._seedScore = null;
      this._hasActivePreview = false;
      this._startClientX = this._readClientX(e);
      this._lastX = this._startClientX;
      this.setData({ gesturing: true });
      this.triggerEvent('gesturestart');
      const x = this._lastX;
      this._measureTrack((rect) => {
        if (!this._gesturing) return;
        if (rect) this._applyClientX(this._lastX, { force: true });
      });
      if (this._trackRect) this._applyClientX(x, { force: true });
    },

    onTouchMove(e) {
      if (!this._gesturing || this.properties.disabled) return;
      const x = this._readClientX(e);
      if (x == null) return;
      this._lastX = x;
      if (this._trackRect) {
        this._applyClientX(x, { force: true });
        return;
      }
      this._measureTrack((rect) => {
        if (!this._gesturing) return;
        if (rect) this._applyClientX(this._lastX, { force: true });
      });
    },

    onTouchEnd(e) {
      if (!this._gesturing) return;
      const x = this._readClientX(e);
      if (x != null) this._lastX = x;
      const finish = () => {
        if (this._lastX != null) this._applyClientX(this._lastX, { force: true });
        const score = this._previewScore;
        if (score != null) {
          this.setData({
            stars: mapStars(score, -1),
            gesturing: false
          });
          this.triggerEvent('scoreconfirm', { score });
        } else {
          this._syncFromValue(this.properties.value);
        }
        this._gesturing = false;
        this._previewScore = null;
        this._seedScore = null;
        this._hasActivePreview = false;
        this.triggerEvent('gestureend');
      };
      if (this._trackRect) {
        finish();
        return;
      }
      this._measureTrack(() => {
        finish();
      });
    }
  }
});
