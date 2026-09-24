'use strict';

Component({
  properties: {
    avatarList: { type: Array, value: [] },
    actingUser: { type: Number, value: -1 },
    selectedUser: { type: Number, value: -1 },
    indicatorUser: { type: Number, value: -1 },
    actionPage: { type: Boolean, value: false },
    specialMoveActive: { type: Boolean, value: false },
    interactive: { type: Boolean, value: true },
    roundStartedAt: { type: null, value: null },
    roundTimerActive: { type: Boolean, value: false },
    roundTimerKey: { type: String, value: '' },
    suppressTimerCanvas: { type: Boolean, value: false }
  },

  methods: {
    onAvatarTap(e) { this.triggerEvent('avatartap', (e && e.detail) || {}); },
    onTimerExpire(e) { this.triggerEvent('timerexpire', (e && e.detail) || {}); }
  }
});
