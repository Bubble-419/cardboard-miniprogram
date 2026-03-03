Component({
  properties: {
    roomId: {
      type: String,
      value: ''
    },
    label: {
      type: String,
      value: '邀请'
    },
    variant: {
      type: String,
      value: 'primary' // primary / ghost / icon
    },
    disabled: {
      type: Boolean,
      value: false
    },
    to: {
      type: String,
      value: '/pages/add-player/index'
    },
    icon: {
      type: String,
      value: ''
    }
  },

  methods: {
    handleTap() {
      if (this.data.disabled) return;

      // 对外透出 tap 事件，方便页面做埋点或拦截
      this.triggerEvent('tap', {
        roomId: this.data.roomId
      });

      if (!this.data.roomId) {
        wx.showToast({
          title: '房间信息缺失',
          icon: 'none'
        });
        return;
      }

      const url = `${this.data.to}?roomId=${encodeURIComponent(this.data.roomId)}`;
      wx.navigateTo({
        url
      });
    }
  }
});

