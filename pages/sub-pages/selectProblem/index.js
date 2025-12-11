Page({
  data: {
    workshopName: "工作坊名称",
    players: [1, 2, 3, 4, 5, 6], // 玩家数量
    categories: [
      { id: 1, name: "智能座舱显示屏", icon: "/assets/icons/display.png" },
      { id: 2, name: "智能穿戴设备", icon: "/assets/icons/wearable.png" },
      { id: 3, name: "网约车乘客", icon: "/assets/icons/passenger.png" },
      { id: 4, name: "点赞分享", icon: "/assets/icons/share.png" }
    ],
    problems: []
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
    
    // 启动定时器，定期检查新提交的问题
    this.startProblemCheck();
  },

  onShow() {
    // 页面显示时也刷新问题列表
    this.loadSubmittedProblems();
  },

  onUnload() {
    // 清除问题检查定时器
    if (this.problemCheckTimer) {
      clearInterval(this.problemCheckTimer);
    }
  },

  // 加载玩家提交的问题（从云数据库）
  loadSubmittedProblems() {
    const db = wx.cloud.database();
    
    // 从云数据库查询所有问题，按提交时间倒序排列
    db.collection('designProblems')
      .orderBy('submitTime', 'desc')
      .get({
        success: (res) => {
          console.log('从云数据库获取问题:', res.data);
          
          // 将云数据库的问题转换为页面需要的格式
          const newProblems = res.data.map((item, index) => ({
            id: item._id || `problem_${index}`, // 使用云数据库的 _id 作为唯一标识
            text: item.text,
            isAISummary: false
          }));
          
          // 更新问题列表
          if (newProblems.length > 0) {
            this.setData({
              problems: newProblems
            });
          } else {
            // 如果没有问题，显示默认问题
            this.setData({
              problems: [
                { 
                  id: 1, 
                  text: "调节看不到：吹发中 UI 在背后，用户无法直观看到风量与温度。", 
                  isAISummary: false
                }
              ]
            });
          }
        },
        fail: (err) => {
          console.error('从云数据库获取问题失败:', err);
          // 如果查询失败，显示默认问题
          this.setData({
            problems: [
              { 
                id: 1, 
                text: "调节看不到：吹发中 UI 在背后，用户无法直观看到风量与温度。", 
                isAISummary: false
              }
            ]
          });
        }
      });
  },

  // 启动问题检查定时器
  startProblemCheck() {
    // 清除之前的定时器（如果存在）
    if (this.problemCheckTimer) {
      clearInterval(this.problemCheckTimer);
    }
    // 每500毫秒检查一次新提交的问题
    this.problemCheckTimer = setInterval(() => {
      this.loadSubmittedProblems();
    }, 500);
  }
})

