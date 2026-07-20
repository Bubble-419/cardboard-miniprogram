const { withSessionFields } = require('../../utils/partnerInspirationSession');
const { isAiFeatureEnabled } = require('../../utils/aiFeature');

Page({
  data: {
    roomId: '',
    workshopOnly: false,
    brainstormSessionSeq: 0,
    tabType: 'text',
    // AI_TEMP_DISABLED: 恢复 AI 时保留下列字段供生成/引用使用
    aiFeatureEnabled: isAiFeatureEnabled(),
    aiPrompt: '',
    referencedInspirations: [],
    inspirations: [],
    displayInspirations: [],
    waterfallColumns: [{ items: [] }, { items: [] }],
    isGenerating: false
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const workshopOnly = (options && options.scope) === 'workshop';
    const brainstormSessionSeq = options && options.brainstormSessionSeq != null
      ? parseInt(options.brainstormSessionSeq, 10)
      : 0;
    this.setData({
      roomId,
      workshopOnly,
      brainstormSessionSeq: Number.isFinite(brainstormSessionSeq) ? brainstormSessionSeq : 0
    });
    this.loadInspirations();
  },

  onShow() {
    this.loadInspirations();
  },

  switchTab(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ tabType: type }, () => {
      this._refreshDisplay();
    });
  },

  _filterByTab(list) {
    const { tabType } = this.data;
    if (tabType === 'image') {
      return (list || []).filter((item) => item.type === 'image');
    }
    return (list || []).filter((item) => item.type !== 'image');
  },

  _refreshDisplay() {
    const displayInspirations = this._filterByTab(this.data.inspirations);
    this.setData({ displayInspirations });
    this.layoutWaterfall(displayInspirations);
  },

  // AI_TEMP_DISABLED: 以下 onAIInput / toggleReference / generateAIInspiration 在开关关闭时不生效
  onAIInput(e) {
    if (!isAiFeatureEnabled()) return;
    this.setData({ aiPrompt: e.detail.value });
  },

  toggleReference(e) {
    // 引用灵感仅服务于 AI 生成，暂未接入时不响应点击，避免无效交互
    if (!isAiFeatureEnabled()) return;
    const inspirationId = e.currentTarget.dataset.id;
    const referencedInspirations = [...this.data.referencedInspirations];
    const index = referencedInspirations.indexOf(inspirationId);

    if (index > -1) {
      referencedInspirations.splice(index, 1);
    } else {
      referencedInspirations.push(inspirationId);
    }

    const inspirations = (this.data.inspirations || []).map((item) => ({
      ...item,
      referenced: referencedInspirations.includes(item.id)
    }));

    this.setData({ referencedInspirations, inspirations });
    this._refreshDisplay();
  },

  async generateAIInspiration() {
    if (!isAiFeatureEnabled()) {
      wx.showToast({ title: 'AI 功能暂未开放', icon: 'none' });
      return;
    }
    if (this.data.isGenerating) return;
    const aiPrompt = this.data.aiPrompt.trim();
    if (!aiPrompt) {
      wx.showToast({ title: '请输入提示词', icon: 'none' });
      return;
    }

    this.setData({ isGenerating: true });
    wx.showLoading({ title: 'AI生成中…', mask: true });

    try {
      const referencedContents = (this.data.inspirations || [])
        .filter((item) => this.data.referencedInspirations.includes(item.id))
        .map((item) => item.content)
        .join('\n');

      const systemPrompt = '你是一个创意灵感生成助手。基于用户提供的已引用灵感和新的提示词，生成一个创新、实用的设计灵感。灵感应该简洁明了，具有可操作性。';
      let userPrompt = aiPrompt;
      if (referencedContents) {
        userPrompt = `已引用的灵感：\n${referencedContents}\n\n基于以上灵感和以下提示词，生成新的灵感：\n${aiPrompt}`;
      }

      const model = wx.cloud.extend.AI.createModel('deepseek');
      const res = await model.streamText({
        data: {
          model: 'deepseek-r1',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        }
      });

      let generatedText = '';
      for await (const str of res.textStream) {
        generatedText += str;
      }

      const saveRes = await wx.cloud.callFunction({
        name: 'saveInspiration',
        data: withSessionFields({
          type: 'text',
          content: generatedText.trim(),
          isAIGenerated: true,
          referencedInspirations: this.data.referencedInspirations
        }, this.data.roomId, this.data.brainstormSessionSeq)
      });
      const result = (saveRes && saveRes.result) || {};
      if (result.ok !== true) {
        throw new Error(result.errMsg || '保存失败');
      }

      wx.showToast({ title: '生成成功', icon: 'success' });
      this.setData({
        aiPrompt: '',
        referencedInspirations: []
      });
      await this.loadInspirations();
    } catch (error) {
      console.error('AI 生成失败:', error);
      wx.showToast({ title: error.message || '生成失败，请重试', icon: 'none' });
    } finally {
      this.setData({ isGenerating: false });
      wx.hideLoading();
    }
  },

  async loadInspirations() {
    const { roomId, brainstormSessionSeq, workshopOnly } = this.data;
    try {
      let listData = {};
      if (roomId) {
        listData = workshopOnly
          ? { roomId, workshopOnly: true }
          : { roomId, brainstormSessionSeq };
      }
      const res = await wx.cloud.callFunction({
        name: 'listInspirations',
        data: listData
      });
      const result = (res && res.result) || {};
      if (result.ok !== true) {
        console.warn('loadInspirations', result.errMsg);
        return;
      }

      const inspirations = (result.inspirations || []).map((item) => {
        const imageUrls = Array.isArray(item.imageUrls) && item.imageUrls.length
          ? item.imageUrls
          : (item.imageUrl ? [item.imageUrl] : []);
        return {
          ...item,
          imageUrl: item.imageUrl || imageUrls[0] || '',
          imageUrls,
          referenced: this.data.referencedInspirations.includes(item.id)
        };
      });

      this.setData({ inspirations });
      this._refreshDisplay();
    } catch (err) {
      console.error('加载灵感列表失败:', err);
    }
  },

  layoutWaterfall(inspirations) {
    const list = inspirations || this.data.inspirations || [];
    const columns = [{ items: [], height: 0 }, { items: [], height: 0 }];

    list.forEach((item) => {
      const columnIndex = columns[0].height <= columns[1].height ? 0 : 1;
      columns[columnIndex].items.push(item);

      let estimatedHeight = 100;
      if (item.type === 'image') {
        estimatedHeight += 200;
      } else if (item.type === 'audio') {
        estimatedHeight += 80;
      }
      if (item.content) {
        estimatedHeight += Math.ceil(item.content.length / 17) * 40;
      }
      columns[columnIndex].height += estimatedHeight;
    });

    this.setData({ waterfallColumns: columns });
  },

  goBack() {
    wx.navigateBack();
  }
});
