Page({
  data: {
    roomId: '',
    workshopName: '脑暴工作坊',
    godNickName: '玩家1',
    displayName: '玩家1',
    godAvatarUrl: '',
    avatarUrl: '',
    defaultAvatarUrl: '/assets/icons/passenger.png',
    isSubmitting: false,
    isEditingName: false
  },

  onLoad(options) {
    const roomId = options && options.roomId;
    if (!roomId) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      });
      setTimeout(() => {
        wx.reLaunch({
          url: '/pages/main-pages/halliGalli/modeIndex/index'
        });
      }, 1500);
      return;
    }

    this.setData({
      roomId,
      workshopName: '脑暴工作坊',
      godNickName: '玩家1',
      displayName: '玩家1'
    });
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: '/pages/main-pages/halliGalli/modeIndex/index'
        });
      }
    });
  },

  onWorkshopNameInput(e) {
    this.setData({
      workshopName: e.detail.value
    });
  },

  clearWorkshopName() {
    this.setData({
      workshopName: ''
    });
  },

  startEditNickName() {
    this.setData({
      isEditingName: true
    });
  },

  onNickNameInput(e) {
    const value = e.detail.value;
    this.setData({
      godNickName: value,
      displayName: value
    });
  },

  confirmEditNickName() {
    let nick = (this.data.godNickName || '').trim();
    if (!nick) {
      nick = '玩家1';
    }
    if (nick.length > 12) {
      wx.showToast({
        title: '昵称建议不超过12字',
        icon: 'none'
      });
      return;
    }
    this.setData({
      godNickName: nick,
      displayName: nick,
      isEditingName: false
    });
  },

  chooseAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = res.tempFilePaths || [];
        if (paths.length > 0) {
          this.setData({
            godAvatarUrl: paths[0],
            avatarUrl: paths[0]
          });
        }
      },
      fail: () => {
        wx.showToast({
          title: '选择头像失败',
          icon: 'none'
        });
      }
    });
  },

  validateFields() {
    const rawName = (this.data.workshopName || '').trim();
    const effectiveName = rawName || '脑暴工作坊';
    if (effectiveName.length > 20) {
      wx.showToast({
        title: '工作坊名称建议不超过20字',
        icon: 'none'
      });
      return false;
    }

    return true;
  },

  handleStartWorkshop() {
    if (this.data.isSubmitting) return;
    if (!this.data.roomId) {
      wx.showToast({
        title: '房间参数错误',
        icon: 'none'
      });
      return;
    }
    if (!this.validateFields()) return;

    let workshopName = (this.data.workshopName || '').trim();
    if (!workshopName) {
      workshopName = '脑暴工作坊';
    }
    const godNickName = (this.data.godNickName || '').trim();
    const payload = {
      roomId: this.data.roomId,
      workshopName,
      godNickName: godNickName || null,
      godAvatarUrl: this.data.godAvatarUrl || null
    };

    this.setData({
      isSubmitting: true
    });

    wx.cloud.callFunction({
      name: 'roomStartWorkshop',
      data: payload,
      success: (res) => {
        const result = (res && res.result) || {};
        if (result.ok === false) {
          console.error('roomStartWorkshop result error', result);
          wx.showToast({
            title: '发起失败，请重试',
            icon: 'none'
          });
          return;
        }

        const app = getApp();
        app.globalData.workshopName = workshopName || '脑暴工作坊';

        wx.navigateTo({
          url: `/pages/main-pages/addPlayer/index?roomId=${this.data.roomId}`
        });
      },
      fail: (error) => {
        console.error('roomStartWorkshop failed', {
          errMsg: error && error.errMsg,
          errCode: error && (error.errCode || error.code),
          roomId: this.data.roomId
        });
        wx.showToast({
          title: '发起失败，请重试',
          icon: 'none'
        });
      },
      complete: () => {
        this.setData({
          isSubmitting: false
        });
      }
    });
  }
});

