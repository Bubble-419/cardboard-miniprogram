Component({
  properties: {
    // 头像列表 [{ id, avatar/url }]
    avatarList: {
      type: Array,
      value: []
    },
    // 当前选中用户 id
    currentUser: {
      type: String,
      optionalTypes: [Number, null],
      value: null
    },
    // 是否显示添加按钮
    enableAdd: {
      type: Boolean,
      value: true
    },
    // 是否折叠（用于顶部空间受限场景）
    isFold: {
      type: Boolean,
      value: false
    },
    // 是否显示昵称（与 addPlayer 一致时开启）
    showName: {
      type: Boolean,
      value: true
    }
  },

  data: {
    defaultAvatar: '/assets/avatar.png'
  },

  methods: {
    onAddTap() {
      this.triggerEvent('addtap');
    }
  }
});
