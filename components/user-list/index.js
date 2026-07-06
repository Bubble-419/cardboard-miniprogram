Component({
  properties: {
    avatarList: {
      type: Array,
      value: []
    },
    // 兼容旧用法：当前行动中玩家 id
    currentUser: {
      type: String,
      optionalTypes: [Number, null],
      value: null
    },
    // 当前轮次正在行动的玩家
    actingUser: {
      type: String,
      optionalTypes: [Number, null],
      value: null
    },
    // 当前查看纪要卡对应的玩家（需配合 enableSelectedFrame）
    selectedUser: {
      type: String,
      optionalTypes: [Number, null],
      value: null
    },
    enableAdd: {
      type: Boolean,
      value: true
    },
    isFold: {
      type: Boolean,
      value: false
    },
    showName: {
      type: Boolean,
      value: true
    },
    // scroll：横向滚动；stack：头像重叠（如 halliGalli 顶栏）
    layout: {
      type: String,
      value: 'scroll'
    },
    // 是否展示行动中双圈光晕
    showActingFrame: {
      type: Boolean,
      value: false
    },
    // 是否展示选中态光晕（仅 partnerMode gamepage 开启）
    enableSelectedFrame: {
      type: Boolean,
      value: false
    },
    enableAvatarTap: {
      type: Boolean,
      value: false
    }
  },

  data: {
    defaultAvatar: '/assets/avatar/Frame 2085662241.png',
    resolvedActingUser: null,
    resolvedSelectedUser: null
  },

  observers: {
    'actingUser, currentUser, selectedUser, showActingFrame, enableSelectedFrame': function syncFrameUsers() {
      this._syncFrameUsers();
    }
  },

  lifetimes: {
    attached() {
      this._syncFrameUsers();
    }
  },

  methods: {
    _syncFrameUsers() {
      const acting = this.properties.actingUser != null
        ? this.properties.actingUser
        : this.properties.currentUser;
      const selected = this.properties.selectedUser;
      const showSelected = this.properties.enableSelectedFrame === true;
      this.setData({
        resolvedActingUser: this.properties.showActingFrame ? acting : null,
        resolvedSelectedUser: showSelected && selected != null && selected != acting
          ? selected
          : null
      });
    },

    onAddTap() {
      this.triggerEvent('addtap');
    },

    onAvatarTap(e) {
      if (!this.properties.enableAvatarTap) return;
      const dataset = e.currentTarget && e.currentTarget.dataset;
      const playerIndex = dataset && (dataset.playerIndex != null ? dataset.playerIndex : dataset.id);
      if (playerIndex == null || playerIndex === '') return;
      this.triggerEvent('avatartap', { playerIndex, id: playerIndex });
    }
  }
});
