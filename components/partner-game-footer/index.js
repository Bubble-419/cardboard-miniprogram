'use strict';

Component({
  properties: {
    visible: { type: Boolean, value: false },
    keyboardOpen: { type: Boolean, value: false },
    historyReview: { type: Boolean, value: false },
    reviewCanGoBack: { type: Boolean, value: false },
    phase: { type: String, value: 'play' },
    closingStep: { type: String, value: 'rune' },
    isHost: { type: Boolean, value: false },
    isCurrentPlayer: { type: Boolean, value: false },
    showSpecialMove: { type: Boolean, value: false },
    specialMoveUsed: { type: Boolean, value: false },
    masterMode: { type: Boolean, value: false },
    canStartStatement: { type: Boolean, value: false },
    statementSwitching: { type: Boolean, value: false },
    discussionSwitching: { type: Boolean, value: false },
    discussionSwitchAction: { type: String, value: '' }
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
