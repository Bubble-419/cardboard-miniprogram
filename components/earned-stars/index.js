const {
  buildEarnedStarSlots,
  earnedStarStaggerDelays,
  earnedStarWaveDelays
} = require('../../utils/halfStarScore');

function withDelays(slots, motion) {
  const list = Array.isArray(slots) ? slots : [];
  const delays = motion === 'wave'
    ? earnedStarWaveDelays(list.length)
    : (motion === 'stagger' ? earnedStarStaggerDelays(list.length) : list.map(() => 0));
  return list.map((slot, i) => ({
    ...slot,
    delayMs: delays[i] || 0
  }));
}

function normalizeMotion(raw) {
  if (raw === 'stagger' || raw === 'wave' || raw === 'pending' || raw === 'fade') {
    return raw;
  }
  return 'none';
}

Component({
  properties: {
    totalStars: {
      type: null,
      value: 0
    },
    motion: {
      type: String,
      value: 'none'
    }
  },

  data: {
    slots: [],
    motionClass: 'none'
  },

  lifetimes: {
    attached() {
      this._sync(this.properties.totalStars, this.properties.motion);
    }
  },

  observers: {
    'totalStars, motion': function (totalStars, motion) {
      this._sync(totalStars, motion);
    }
  },

  methods: {
    _sync(totalStars, motion) {
      const nextMotion = normalizeMotion(motion);
      this.setData({
        motionClass: nextMotion,
        slots: withDelays(buildEarnedStarSlots(totalStars), nextMotion)
      });
    }
  }
});
