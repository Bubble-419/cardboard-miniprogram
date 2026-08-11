const { getCapsuleTopBarMetrics } = require('../../utils/capsuleTopBar');

Component({
  properties: {
    avatarList: {
      type: Array,
      value: []
    },
    /** 最多直接展示的头像数，超出显示 +N */
    maxVisible: {
      type: Number,
      value: 5
    },
    /** 是否展示顶栏头像列表；等待页等已有大名单时可关掉避免重复 */
    showAvatars: {
      type: Boolean,
      value: true
    },
    showRoomEntry: {
      type: Boolean,
      value: true
    },
    roomIcon: {
      type: String,
      value: '/assets/icons/icon-room-entry.svg'
    },
    enableAdd: {
      type: Boolean,
      value: false
    },
    currentUser: {
      type: null,
      value: null
    },
    actingUser: {
      type: null,
      value: null
    },
    selectedUser: {
      type: null,
      value: null
    },
    indicatorUser: {
      type: null,
      value: null
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
    roundStartedAt: {
      type: null,
      value: 0
    },
    roundTimerActive: {
      type: Boolean,
      value: false
    },
    roundTimerKey: {
      type: String,
      value: ''
    },
    /** 额外右侧插槽占位（rpx），一般不必再传——组件已按胶囊宽度预留 */
    extraRightRpx: {
      type: Number,
      value: 0
    }
  },

  data: {
    padTop: 20,
    barHeight: 32,
    iconSize: 32,
    capsuleWidth: 87,
    padRightPx: 8
  },

  lifetimes: {
    attached() {
      this._applyMetrics();
    }
  },

  pageLifetimes: {
    resize() {
      this._applyMetrics();
    },
    show() {
      this._applyMetrics();
    }
  },

  methods: {
    _applyMetrics() {
      const m = getCapsuleTopBarMetrics();
      this.setData({
        padTop: m.padTop,
        barHeight: m.barHeight,
        iconSize: m.iconSize,
        capsuleWidth: m.capsuleWidth,
        padRightPx: m.padRightPx
      });
      this.triggerEvent('layout', {
        padTop: m.padTop,
        barHeight: m.barHeight,
        iconSize: m.iconSize,
        capsuleWidth: m.capsuleWidth,
        padRightPx: m.padRightPx,
        padRightRpx: m.padRightRpx,
        totalHeight: m.padTop + m.barHeight
      });
    },

    onGoRoom() {
      this.triggerEvent('goroom');
    },

    onAddTap() {
      this.triggerEvent('addtap');
    },

    onAvatarTap(e) {
      this.triggerEvent('avatartap', (e && e.detail) || {});
    }
  }
});
