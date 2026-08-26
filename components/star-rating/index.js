const {
  normalizeHalfStarScore,
  scoreFromTrackX,
  buildStarFills
} = require('../../utils/halfStarScore');

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
    stars: buildStarFills(null)
  },

  lifetimes: {
    attached() {
      this._gesturing = false;
      this._previewScore = null;
      this._trackRect = null;
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
        this.setData({ stars: buildStarFills(null) });
        return;
      }
      this.setData({ stars: buildStarFills(normalizeHalfStarScore(raw)) });
    },

    _readClientX(e) {
      const t = (e && e.touches && e.touches[0])
        || (e && e.changedTouches && e.changedTouches[0]);
      return t && Number.isFinite(t.clientX) ? t.clientX : null;
    },

    _applyClientX(clientX) {
      const rect = this._trackRect;
      if (!rect || !(rect.width > 0) || clientX == null) return null;
      const score = scoreFromTrackX(clientX, rect.left, rect.width, {
        minScore: 0.5,
        maxScore: 5
      });
      if (this._previewScore === score) return score;
      this._previewScore = score;
      this.setData({ stars: buildStarFills(score) });
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

    onTouchStart(e) {
      if (this.properties.disabled) return;
      this._gesturing = true;
      this._previewScore = null;
      this.triggerEvent('gesturestart');
      const x = this._readClientX(e);
      this._lastX = x;
      this._measureTrack((rect) => {
        if (!this._gesturing) return;
        if (rect) this._applyClientX(this._lastX);
      });
      if (this._trackRect) this._applyClientX(x);
    },

    onTouchMove(e) {
      if (!this._gesturing || this.properties.disabled) return;
      const x = this._readClientX(e);
      if (x == null) return;
      this._lastX = x;
      if (this._trackRect) {
        this._applyClientX(x);
        return;
      }
      this._measureTrack((rect) => {
        if (!this._gesturing) return;
        if (rect) this._applyClientX(this._lastX);
      });
    },

    onTouchEnd(e) {
      if (!this._gesturing) return;
      const x = this._readClientX(e);
      if (x != null) this._lastX = x;
      const finish = () => {
        const score = this._previewScore != null
          ? this._previewScore
          : (this._trackRect ? this._applyClientX(this._lastX) : null);
        if (score != null) {
          this.setData({ stars: buildStarFills(score) });
          this.triggerEvent('scoreconfirm', { score });
        } else {
          this._syncFromValue(this.properties.value);
        }
        this._gesturing = false;
        this._previewScore = null;
        this.triggerEvent('gestureend');
      };
      if (this._trackRect) {
        if (this._lastX != null) this._applyClientX(this._lastX);
        finish();
        return;
      }
      this._measureTrack(() => {
        if (this._lastX != null) this._applyClientX(this._lastX);
        finish();
      });
    }
  }
});
