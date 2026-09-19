'use strict';

Component({
  properties: {
    historyReview: { type: Boolean, value: false },
    topPadding: { type: Number, value: 0 },
    rightPadding: { type: Number, value: 0 },
    height: { type: Number, value: 32 },
    iconSize: { type: Number, value: 32 },
    problemText: { type: String, value: '' },
    problemExpanded: { type: Boolean, value: false }
  },

  methods: {
    emitIntent(e) {
      const type = e && e.currentTarget && e.currentTarget.dataset
        && e.currentTarget.dataset.intent;
      if (!type) return;
      this.triggerEvent('intent', { type });
    }
  }
});
