const { getCapsuleTopBarMetrics } = require('../../utils/capsuleTopBar');

const MIN_PAD_TOP_PX = 44;
const MIN_BAR_PX = 32;

Component({
  options: {
    multipleSlots: true,
    virtualHost: true
  },

  properties: {
    showBack: {
      type: Boolean,
      value: true
    },
    title: {
      type: String,
      value: ''
    },
    showEdit: {
      type: Boolean,
      value: false
    },
    background: {
      type: String,
      value: '#ffffff'
    },
    extClass: {
      type: String,
      value: ''
    }
  },

  data: {
    padTop: MIN_PAD_TOP_PX,
    barHeight: MIN_BAR_PX,
    capsuleWidth: 87,
    padRightPx: 8
  },

  lifetimes: {
    attached() {
      this._applyMetrics();
    },
    ready() {
      this._applyMetrics();
      wx.nextTick(() => this._applyMetrics());
    }
  },

  pageLifetimes: {
    show() {
      this._applyMetrics();
    },
    resize() {
      this._applyMetrics();
    }
  },

  methods: {
    _applyMetrics() {
      const m = getCapsuleTopBarMetrics({ minBarPx: MIN_BAR_PX });
      const barHeight = Math.max(m.iconSize || 0, MIN_BAR_PX);
      const padTop = Math.max(
        m.padTop || 0,
        m.statusBarHeight || 0,
        MIN_PAD_TOP_PX
      );
      this.setData({
        padTop,
        barHeight,
        capsuleWidth: m.capsuleWidth || 87,
        padRightPx: m.padRightPx || 8
      });
    },

    onBack() {
      this.triggerEvent('back');
    },

    onEdit() {
      if (!this.data.showEdit) return;
      this.triggerEvent('edit');
    }
  }
});
