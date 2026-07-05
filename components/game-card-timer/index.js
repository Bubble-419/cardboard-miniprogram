const { getBorderSegmentProgress } = require('../../utils/partnerRoundTimer');

Component({
  properties: {
    elapsedRatio: {
      type: Number,
      value: 0
    },
    active: {
      type: Boolean,
      value: true
    }
  },

  observers: {
    elapsedRatio(ratio) {
      this.setData({
        border: getBorderSegmentProgress(ratio)
      });
    }
  },

  data: {
    border: {
      right: 0,
      bottom: 0,
      left: 0,
      top: 0
    }
  }
});
