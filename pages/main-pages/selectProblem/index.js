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
    problems: [
      { 
        id: 1, 
        text: "调节看不到：吹发中 UI 在背后，用户无法直观看到风量与温度。", 
        selected: true 
      },
      { 
        id: 2, 
        text: "档位信息不清晰：希望变冷按钮有明确反馈、档位状态能被感知。", 
        selected: false 
      },
      { 
        id: 3, 
        text: "希望更自由调节风档：不满足于传统\"死档位\"，希望能有滑动/细粒度控制。", 
        selected: false 
      },
      { 
        id: 4, 
        text: "调节看不到：吹发中 UI 在背后，用户无法直观看到风量与温度。", 
        selected: false 
      },
      { 
        id: 5, 
        text: "模式繁多、操作繁琐：要按多次才找到合适模式，用户容易放弃调节。", 
        selected: false 
      },
      { 
        id: 6, 
        text: "调节看不到：吹发中 UI 在背后，用户无法直观看到风量与温度。", 
        selected: false 
      },
      { 
        id: 7, 
        text: "AI总结：希望更自由调节风档：不满足于传统\"死档位\"，希望能有滑动/细粒度控制。", 
        selected: false,
        isAISummary: true
      }
    ],
    selectedProblemId: 1,
    countdown: 5
  },

  onLoad() {
    // 页面加载
    const app = getApp();
    if (app.globalData.workshopName) {
      this.setData({
        workshopName: app.globalData.workshopName
      });
    }
    
    // 启动倒计时
    this.startCountdown();
  },

  onUnload() {
    // 清除倒计时
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }
  },

  startCountdown() {
    this.countdownTimer = setInterval(() => {
      if (this.data.countdown > 0) {
        this.setData({
          countdown: this.data.countdown - 1
        });
      } else {
        clearInterval(this.countdownTimer);
      }
    }, 1000);
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
    
    // TODO: 根据分类筛选问题列表
  },

  selectProblem(e) {
    const problemId = e.currentTarget.dataset.id;
    const problems = this.data.problems.map(item => {
      return {
        ...item,
        selected: item.id === problemId
      };
    });
    
    this.setData({
      problems,
      selectedProblemId: problemId
    });
  },

  confirmSelection() {
    if (!this.data.selectedProblemId) {
      wx.showToast({
        title: '请选择一个设计问题',
        icon: 'none'
      });
      return;
    }

    const problem = this.data.problems.find(p => p.id === this.data.selectedProblemId);
    getApp().globalData.selectedProblem = problem;
    
    wx.navigateTo({
      url: '/pages/main-pages/selectMode/index'
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

