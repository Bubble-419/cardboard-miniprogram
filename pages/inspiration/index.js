Page({
  data: {
    tabType: 'text', // 'text' 或 'image'
    aiPrompt: '', // AI 提示词
    referencedInspirations: [], // 已引用的灵感ID列表
    inspirations: [], // 所有灵感
    waterfallColumns: [{ items: [] }, { items: [] }], // 瀑布流两列数据
    recordText: '' // 底部记录框文本
  },

  onLoad() {
    // 加载灵感列表
    this.loadInspirations();
  },

  onShow() {
    // 页面显示时刷新灵感列表
    this.loadInspirations();
  },

  // 切换文本/图像标签
  switchTab(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      tabType: type
    });
  },

  // AI 输入框输入
  onAIInput(e) {
    this.setData({
      aiPrompt: e.detail.value
    });
  },

  // 记录框输入
  onRecordInput(e) {
    this.setData({
      recordText: e.detail.value
    });
  },

  // 切换引用状态
  toggleReference(e) {
    const inspirationId = e.currentTarget.dataset.id;
    const referencedInspirations = [...this.data.referencedInspirations];
    const index = referencedInspirations.indexOf(inspirationId);
    
    if (index > -1) {
      // 取消引用
      referencedInspirations.splice(index, 1);
    } else {
      // 添加引用
      referencedInspirations.push(inspirationId);
    }
    
    // 更新灵感引用状态
    const inspirations = this.data.inspirations.map(item => {
      return {
        ...item,
        referenced: referencedInspirations.includes(item.id)
      };
    });
    
    this.setData({
      referencedInspirations,
      inspirations
    });
    
    // 重新布局瀑布流
    this.layoutWaterfall();
  },

  // 生成 AI 灵感
  async generateAIInspiration() {
    const aiPrompt = this.data.aiPrompt.trim();
    if (!aiPrompt) {
      wx.showToast({
        title: '请输入提示词',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({
      title: 'AI生成中...',
      mask: true
    });

    try {
      // 获取已引用的灵感内容
      const referencedContents = this.data.inspirations
        .filter(item => this.data.referencedInspirations.includes(item.id))
        .map(item => item.content)
        .join('\n');

      // 构建系统提示词
      const systemPrompt = `你是一个创意灵感生成助手。基于用户提供的已引用灵感和新的提示词，生成一个创新、实用的设计灵感。灵感应该简洁明了，具有可操作性。`;

      // 构建用户提示词
      let userPrompt = aiPrompt;
      if (referencedContents) {
        userPrompt = `已引用的灵感：\n${referencedContents}\n\n基于以上灵感和以下提示词，生成新的灵感：\n${aiPrompt}`;
      }

      // 创建 AI 模型实例
      const model = wx.cloud.extend.AI.createModel("deepseek");

      // 调用 AI 生成文本
      const res = await model.streamText({
        data: {
          model: "deepseek-r1",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        }
      });

      // 接收流式响应
      let generatedText = '';
      for await (let str of res.textStream) {
        generatedText += str;
      }

      // 保存 AI 生成的灵感到云数据库
      const db = wx.cloud.database();
      await db.collection('inspirations').add({
        data: {
          type: 'text',
          content: generatedText.trim(),
          isAIGenerated: true,
          referencedInspirations: this.data.referencedInspirations,
          createTime: db.serverDate()
        }
      });

      wx.hideLoading();
      wx.showToast({
        title: '生成成功',
        icon: 'success'
      });

      // 清空输入框和引用
      this.setData({
        aiPrompt: '',
        referencedInspirations: []
      });

      // 重新加载灵感列表
      this.loadInspirations();

    } catch (error) {
      console.error('AI 生成失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '生成失败，请重试',
        icon: 'none'
      });
    }
  },

  // 保存灵感
  saveInspiration() {
    const recordText = this.data.recordText.trim();
    if (!recordText) {
      wx.showToast({
        title: '请输入灵感内容',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({
      title: '保存中...',
      mask: true
    });

    const db = wx.cloud.database();
    db.collection('inspirations').add({
      data: {
        type: this.data.tabType,
        content: recordText,
        isAIGenerated: false,
        createTime: db.serverDate()
      },
      success: () => {
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        
        // 清空输入框
        this.setData({
          recordText: ''
        });
        
        // 重新加载灵感列表
        this.loadInspirations();
      },
      fail: (err) => {
        console.error('保存灵感失败:', err);
        wx.hideLoading();
        wx.showToast({
          title: '保存失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  // 开始录音（语音输入）
  startRecord() {
    wx.showToast({
      title: '语音功能开发中',
      icon: 'none'
    });
  },

  // 加载灵感列表
  loadInspirations() {
    const db = wx.cloud.database();
    
    db.collection('inspirations')
      .orderBy('createTime', 'desc')
      .get({
        success: (res) => {
          console.log('加载灵感列表:', res.data);
          
          // 转换数据格式
          const inspirations = res.data.map(item => ({
            id: item._id,
            type: item.type || 'text',
            content: item.content || '',
            imageUrl: item.imageUrl || '',
            duration: item.duration || '',
            isAIGenerated: item.isAIGenerated || false,
            referenced: this.data.referencedInspirations.includes(item._id)
          }));
          
          this.setData({
            inspirations
          });
          
          // 布局瀑布流
          this.layoutWaterfall();
        },
        fail: (err) => {
          console.error('加载灵感列表失败:', err);
        }
      });
  },

  // 瀑布流布局
  layoutWaterfall() {
    const inspirations = this.data.inspirations;
    const columns = [{ items: [], height: 0 }, { items: [], height: 0 }];
    
    inspirations.forEach(item => {
      // 选择高度较小的列
      const columnIndex = columns[0].height <= columns[1].height ? 0 : 1;
      columns[columnIndex].items.push(item);
      // 估算高度（文本类型按内容长度，图像类型固定高度，音频类型固定高度）
      let estimatedHeight = 100; // 基础高度（padding + margin）
      if (item.type === 'image') {
        estimatedHeight += 200; // 图片高度
      } else if (item.type === 'audio') {
        estimatedHeight += 80; // 音频播放器高度
      }
      // 文本内容高度估算（每行约40rpx，每字约2rpx宽，屏幕宽度约350rpx）
      if (item.content) {
        const textHeight = Math.ceil(item.content.length / 17) * 40; // 每行约17个字
        estimatedHeight += textHeight;
      }
      columns[columnIndex].height += estimatedHeight;
    });
    
    this.setData({
      waterfallColumns: columns
    });
  },

  // 返回
  goBack() {
    wx.navigateBack();
  }
})

