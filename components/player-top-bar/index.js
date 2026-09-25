const { getCapsuleTopBarMetrics } = require('../../utils/capsuleTopBar');

Component({
  properties: {
    avatarList: {
      type: Array,
      value: []
    },
    /** 顶栏始终展示全部头像（超出可横向滑动），不再截断为灰色 +N */
    maxVisible: {
      type: Number,
      value: 0
    },
    /** 是否展示顶栏头像列表；等待页等已有大名单时可关掉避免重复 */
    showAvatars: {
      type: Boolean,
      value: true
    },
    /** 规则活动页使用紧凑头像，使头像与微信胶囊/房间入口保持同一视觉高度。 */
    compactAvatars: {
      type: Boolean,
      value: false
    },
    showRoomEntry: {
      type: Boolean,
      value: true
    },
    showBack: {
      type: Boolean,
      value: false
    },
    backIcon: {
      type: String,
      value: '/assets/icons/icon-nav-back.svg'
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
    /** Master/静默等特殊行动：倒计时强制画在行动者头像 */
    specialMoveActive: {
      type: Boolean,
      value: false
    },
    visualMode: {
      type: String,
      value: 'default'
    },
    onActionPage: {
      type: Boolean,
      value: true
    },
    /** 额外右侧插槽占位（rpx），一般不必再传——组件已按胶囊宽度预留 */
    extraRightRpx: {
      type: Number,
      value: 0
    },
    /** 左侧内边距（rpx）。用属性+内联样式，避免页面 wxss 打不到自定义组件宿主 */
    padLeftRpx: {
      type: Number,
      value: 40
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

    onBack() {
      this.triggerEvent('back');
    },

    onAddTap() {
      this.triggerEvent('addtap');
    },

    onAvatarTap(e) {
      this.triggerEvent('avatartap', (e && e.detail) || {});
    },

    onTimerExpire(e) {
      this.triggerEvent('timerexpire', (e && e.detail) || {});
    }
  }
});
