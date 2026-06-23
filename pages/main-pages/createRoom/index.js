function generateClientCreateId() {
  const random = Math.floor(Math.random() * 1000000);
  return `${Date.now()}-${random}`;
}

Page({
  data: {
    isCreating: false,
    clientCreateId: '',
    lastError: null
  },

  onLoad() {
    this.ensureClientCreateId();
  },

  ensureClientCreateId() {
    if (!this.data.clientCreateId) {
      this.setData({
        clientCreateId: generateClientCreateId()
      });
    }
  },

  handleGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/main-pages/halliGalli/modeIndex/index' });
      }
    });
  },

  handleCreateRoom() {
    if (this.data.isCreating) return;

    this.ensureClientCreateId();

    this.setData({
      isCreating: true,
      lastError: null
    });

    // 获取当前网络状态（用于错误观测）
    wx.getNetworkType({
      success: (res) => {
        this.networkType = res.networkType;
      },
      fail: () => {
        this.networkType = 'unknown';
      }
    });

    const clientCreateId = this.data.clientCreateId;

    if (!wx.cloud || !wx.cloud.callFunction) {
      // 云能力不可用时直接降级为本地房间
      const roomId = `local-${clientCreateId}`;
      console.warn('wx.cloud unavailable, fallback to local roomId', {
        clientCreateId,
        roomId
      });
      wx.showToast({
        title: '已离线创建房间',
        icon: 'none'
      });
      this.setData({
        isCreating: false
      });
      wx.navigateTo({
        url: `/pages/main-pages/setRoom/index?roomId=${roomId}`
      });
      return;
    }

    wx.cloud.callFunction({
      name: 'roomCreate',
      data: {
        clientCreateId
      },
      success: (res) => {
        const result = (res && res.result) || {};
        const roomId =
          result.roomId ||
          (result.data && result.data.roomId);

        if (!roomId) {
          // 结果异常时记录错误并降级为本地房间
          this.reportCreateError({
            errMsg: 'roomId missing in result',
            errCode: 'NO_ROOM_ID',
            clientCreateId,
            roomId: '',
            rawResult: result
          });

          const fallbackRoomId = `local-${clientCreateId}`;
          console.warn('roomCreate no roomId, fallback to local roomId', {
            clientCreateId,
            fallbackRoomId
          });
          wx.showToast({
            title: '已离线创建房间',
            icon: 'none'
          });
          wx.navigateTo({
            url: `/pages/main-pages/setRoom/index?roomId=${fallbackRoomId}`
          });
          return;
        }

        wx.navigateTo({
          url: `/pages/main-pages/setRoom/index?roomId=${roomId}`
        });
      },
      fail: (error) => {
        const errMsg = error && error.errMsg ? error.errMsg : '调用 roomCreate 失败';
        const errCode = error && error.errCode ? error.errCode : (error && error.code) || '';

        this.reportCreateError({
          errMsg,
          errCode,
          clientCreateId,
          roomId: '',
          rawError: error
        });

        const fallbackRoomId = `local-${clientCreateId}`;
        console.warn('roomCreate call failed, fallback to local roomId', {
          clientCreateId,
          fallbackRoomId
        });
        wx.showToast({
          title: '已离线创建房间',
          icon: 'none'
        });
        wx.navigateTo({
          url: `/pages/main-pages/setRoom/index?roomId=${fallbackRoomId}`
        });
      },
      complete: () => {
        // 不重置 clientCreateId，保证用户重试时使用同一个幂等键
        this.setData({
          isCreating: false
        });
      }
    });
  },

  reportCreateError(payload) {
    const info = {
      ...payload,
      networkType: this.networkType || 'unknown',
      time: Date.now()
    };

    console.error('roomCreate failed', info);

    this.setData({
      lastError: {
        errMsg: info.errMsg,
        errCode: info.errCode
      }
    });

    // 可选：写入 logs 集合，便于线上排查
    try {
      const db = wx.cloud.database();
      db.collection('logs').add({
        data: {
          type: 'room_create_fail',
          ...info,
          createdAt: db.serverDate()
        }
      });
    } catch (e) {
      console.error('write logs collection failed', e);
    }
  }
});

