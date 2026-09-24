'use strict';

Component({
  properties: {
    model: { type: Object, value: null },
    submitting: { type: Boolean, value: false },
    waitHeroSrc: { type: String, value: '' }
  },

  methods: {
    onVoteTap(e) {
      if (this.data.submitting) return;
      const model = this.data.model || {};
      if (model.hasVoted || model.isInitiator) return;
      const vote = e && e.currentTarget && e.currentTarget.dataset
        && e.currentTarget.dataset.vote;
      if (!['pass', 'question'].includes(vote)) return;
      this.triggerEvent('vote', { vote });
    }
  }
});
