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
    
    // 加载玩家提交的问题
    this.loadSubmittedProblems();
    
    // 启动倒计时
    this.startCountdown();
    
    // 启动定时器，定期检查新提交的问题
    this.startProblemCheck();
  },

  onShow() {
    // 页面显示时也刷新问题列表
    this.loadSubmittedProblems();
  },

  onUnload() {
    // 清除倒计时
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }
    // 清除问题检查定时器
    if (this.problemCheckTimer) {
      clearInterval(this.problemCheckTimer);
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

  // 加载玩家提交的问题（从云数据库）
  loadSubmittedProblems() {
    const db = wx.cloud.database();
    
    // 从云数据库查询所有问题，按提交时间倒序排列
    // 注意：需要在云开发控制台为 designProblems 集合创建索引，字段：submitTime，排序：desc
    db.collection('designProblems')
      .orderBy('submitTime', 'desc')
      .get({
        success: (res) => {
          console.log('从云数据库获取问题:', res.data);
          
          // 将云数据库的问题转换为页面需要的格式
          const newProblems = res.data.map((item, index) => ({
            id: item._id || `problem_${index}`, // 使用云数据库的 _id 作为唯一标识
            text: item.text,
            selected: false,
            isAISummary: false
          }));
          
          // 如果有提交的问题，使用提交的问题；否则保留默认问题
          if (newProblems.length > 0) {
            // 检查是否有新问题（通过比较问题数量或ID）
            const currentProblemIds = this.data.problems.map(p => p.id);
            const newProblemIds = newProblems.map(p => p.id);
            
            // 检查是否有新问题或问题列表有变化
            const hasNewProblems = newProblemIds.some(id => !currentProblemIds.includes(id));
            const hasRemovedProblems = currentProblemIds.some(id => !newProblemIds.includes(id));
            const lengthChanged = newProblems.length !== this.data.problems.length;
            
            // 如果问题列表有变化，更新列表
            if (hasNewProblems || hasRemovedProblems || lengthChanged) {
              // 保持当前选中的问题ID（如果新列表中有的话）
              let newSelectedId = this.data.selectedProblemId;
              if (!newProblemIds.includes(newSelectedId)) {
                newSelectedId = newProblems.length > 0 ? newProblems[0].id : null;
              }
              
              this.setData({
                problems: newProblems,
                selectedProblemId: newSelectedId
              });
            }
          }
        },
        fail: (err) => {
          console.error('从云数据库获取问题失败:', err);
          // 如果查询失败，保持当前问题列表不变
        }
      });
  },

  // 启动问题检查定时器
  startProblemCheck() {
    // 清除之前的定时器（如果存在）
    if (this.problemCheckTimer) {
      clearInterval(this.problemCheckTimer);
    }
    // 每500毫秒检查一次新提交的问题（提高响应速度）
    this.problemCheckTimer = setInterval(() => {
      this.loadSubmittedProblems();
    }, 500);
  },

  // 刷新问题列表（供外部调用）
  refreshProblems() {
    this.loadSubmittedProblems();
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

