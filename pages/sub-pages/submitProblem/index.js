Page({
  data: {
    categories: [
      { id: 1, name: "智能座舱显示屏", icon: "/assets/icons/display.png", selected: false },
      { id: 2, name: "智能穿戴设备", icon: "/assets/icons/wearable.png", selected: false },
      { id: 3, name: "网约车乘客", icon: "/assets/icons/passenger.png", selected: false },
      { id: 4, name: "点赞分享", icon: "/assets/icons/share.png", selected: false }
    ],
    problemText: "",
    maxLength: 50,
    selectedCategory: null
  },

  onLoad() {
    // 页面加载
  },

  // 选择分类
  selectCategory(e) {
    const categoryId = e.currentTarget.dataset.id;
    const categories = this.data.categories.map(item => {
      return {
        ...item,
        selected: item.id === categoryId
      };
    });
    
    this.setData({
      categories,
      selectedCategory: categoryId
    });
  },

  // 输入框内容变化
  onInput(e) {
    const value = e.detail.value;
    this.setData({
      problemText: value
    });
  },

  // 提交问题
  submitProblem() {
    const problemText = this.data.problemText.trim();
    
    if (!problemText) {
      wx.showToast({
        title: '请输入设计问题',
        icon: 'none'
      });
      return;
    }

    if (problemText.length > this.data.maxLength) {
      wx.showToast({
        title: `问题不能超过${this.data.maxLength}字`,
        icon: 'none'
      });
      return;
    }

    // 显示加载提示
    wx.showLoading({
      title: '提交中...',
      mask: true
    });

    // 创建问题对象，保存到云数据库
    const db = wx.cloud.database();
    const problem = {
      text: problemText,
      category: this.data.selectedCategory,
      submitTime: db.serverDate() // 使用服务器时间，便于排序
    };

    // 保存到云数据库
    db.collection('designProblems').add({
      data: problem,
      success: (res) => {
        console.log('提交问题成功:', res);
        wx.hideLoading();
        wx.showToast({
          title: '提交成功',
          icon: 'success',
          duration: 1500
        });

        // 延迟跳转，让用户看到成功提示
        setTimeout(() => {
          wx.redirectTo({
            url: '/pages/sub-pages/selectProblem/index'
          });
        }, 1500);
      },
      fail: (err) => {
        console.error('提交问题失败:', err);
        wx.hideLoading();
        wx.showToast({
          title: '提交失败，请重试',
          icon: 'none',
          duration: 2000
        });
      }
    });
  }
})

