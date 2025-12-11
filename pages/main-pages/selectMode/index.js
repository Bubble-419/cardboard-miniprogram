Page({
  data: {
    workshopName: "工作坊名称",
    players: [1, 2, 3, 4, 5, 6], // 玩家数量
    categories: [
      { id: 1, name: "智能座舱显示屏", icon: "/assets/icons/display.png", selected: false },
      { id: 2, name: "智能穿戴设备", icon: "/assets/icons/wearable.png", selected: false },
      { id: 3, name: "网约车乘客", icon: "/assets/icons/passenger.png", selected: false },
      { id: 4, name: "点赞分享", icon: "/assets/icons/share.png", selected: false }
    ],
    selectedProblem: null, // 从上一页传入的问题
    brainstormModes: [
      {
        id: 1,
        title: "全新创意",
        description: "所有玩家从0开始，共同进行脑暴",
        selected: true
      },
      {
        id: 2,
        title: "残局模式",
        description: "在现有方案基础上，共同进行脑暴",
        selected: false
      },
      {
        id: 3,
        title: "各自为战",
        description: "每个人先拼出一组表达式（5张牌）",
        selected: false
      }
    ],
    selectedModeId: 1,
    goalSliderValue: 0, // 0-100，0为数量优先，100为质量优先
    goalLabels: ["数量优先", "质量优先"]
  },

  onLoad() {
    // 页面加载
    const app = getApp();
    
    // 获取上一页选择的问题
    if (app.globalData.selectedProblem) {
      this.setData({
        selectedProblem: app.globalData.selectedProblem
      });
    }
    
    if (app.globalData.workshopName) {
      this.setData({
        workshopName: app.globalData.workshopName
      });
    }
  },

  selectCategory(e) {
    const categoryId = e.currentTarget.dataset.id;
    const categories = this.data.categories.map(item => {
      return {
        ...item,
        selected: item.id === categoryId
      };
    });
    
    this.setData({
      categories
    });
  },

  selectMode(e) {
    const modeId = e.currentTarget.dataset.id;
    const brainstormModes = this.data.brainstormModes.map(item => {
      return {
        ...item,
        selected: item.id === modeId
      };
    });
    
    this.setData({
      brainstormModes,
      selectedModeId: modeId
    });
  },

  onSliderChange(e) {
    const value = e.detail.value;
    this.setData({
      goalSliderValue: value
    });
  },

  nextStep() {
    if (!this.data.selectedModeId) {
      wx.showToast({
        title: '请选择脑暴模式',
        icon: 'none'
      });
      return;
    }

    const selectedMode = this.data.brainstormModes.find(m => m.id === this.data.selectedModeId);
    getApp().globalData.selectedMode = {
      mode: selectedMode,
      goalValue: this.data.goalSliderValue
    };
    
    // 更新云数据库中的游戏状态，通知所有副屏跳转到 awaitPlayer
    const db = wx.cloud.database();
    db.collection('gameState').add({
      data: {
        currentPage: 'selectPlayer',
        updateTime: db.serverDate()
      },
      success: () => {
        console.log('游戏状态已更新为 selectPlayer');
        // 跳转到 selectPlayer 页面
        wx.navigateTo({
          url: '/pages/main-pages/selectPlayer/index'
        });
      },
      fail: (err) => {
        console.error('更新游戏状态失败:', err);
        // 即使更新失败也跳转
        wx.navigateTo({
          url: '/pages/main-pages/selectPlayer/index'
        });
      }
    });
  },

  addPlayer() {
    // 添加玩家功能
    wx.showToast({
      title: '添加玩家功能',
      icon: 'none'
    });
  },

  goBack() {
    wx.navigateBack();
  }
})

