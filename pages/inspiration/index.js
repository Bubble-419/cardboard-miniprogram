const { withSessionFields } = require('../../utils/partnerInspirationSession');
const { isAiFeatureEnabled } = require('../../utils/aiFeature');
const { persistTempPhoto } = require('../../utils/partnerRoundPrivateNotes');
const { goRoomPage } = require('../../utils/goRoomPage');

Page({
  data: {
    roomId: '',
    workshopOnly: false,
    brainstormSessionSeq: 0,
    // AI_TEMP_DISABLED: 恢复 AI 时保留下列字段供生成/引用使用
    aiFeatureEnabled: isAiFeatureEnabled(),
    aiPrompt: '',
    referencedInspirations: [],
    inspirations: [],
    displayInspirations: [],
    waterfallColumns: [{ items: [] }, { items: [] }],
    isGenerating: false,
    inspirationDraftText: '',
    inspirationDraftPhotos: [],
    inspirationInputFocused: false,
    inspirationAutoFocus: false,
    inspirationHoldKeyboard: false,
    inspirationKeyboardHeight: 0,
    inspirationSaving: false,
    inspirationHasText: false,
    navbarPaddingTop: 44
  },

  _applyNavbarInset() {
    try {
      const menu = wx.getMenuButtonBoundingClientRect();
      const sys = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const statusBarHeight = (sys && sys.statusBarHeight) || 44;
      // 与右上角胶囊对齐，保证顶部有明确留白
      const paddingTop = (menu && menu.top > 0) ? menu.top : statusBarHeight;
      this.setData({ navbarPaddingTop: paddingTop });
    } catch (e) {
      this.setData({ navbarPaddingTop: 44 });
    }
  },

  onLoad(options) {
    this._applyNavbarInset();
    const roomId = (options && options.roomId) || (getApp().globalData && getApp().globalData.roomId) || '';
    // 带房间进入时一律按「本房间本人灵感」展示，与灯泡角标一致
    const workshopOnly = (options && options.scope) === 'workshop' || !!roomId;
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

  onUnload() {
    if (this._inspirationBlurTimer) {
      clearTimeout(this._inspirationBlurTimer);
      this._inspirationBlurTimer = null;
    }
    this._syncCountToOpener({ refreshCloud: true });
  },

  goBack() {
    this._syncCountToOpener({ refreshCloud: true });
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    goRoomPage(this.data.roomId);
  },

  /** 把当前列表数量写回上一页灯泡角标，避免返回后仍显示旧数字 */
  _syncCountToOpener(options = {}) {
    const count = (this.data.inspirations || []).length;
    const pages = getCurrentPages();
    const prev = pages.length >= 2 ? pages[pages.length - 2] : null;
    if (prev && typeof prev.setData === 'function') {
      try {
        prev.setData({ inspirationCount: count });
      } catch (e) {
        // ignore
      }
    }
    if (options.refreshCloud && prev && typeof prev._refreshInspirationCount === 'function') {
      prev._refreshInspirationCount();
    }
  },

  _refreshDisplay() {
    // listInspirations 已按 updateTime/createTime 降序，越新越靠前；文字与图像混排展示
    const displayInspirations = this.data.inspirations || [];
    this.setData({ displayInspirations });
    this.layoutWaterfall(displayInspirations);
    this._syncCountToOpener();
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
        // 游戏内进入（workshop）按房间拉本人全部灵感；否则可按对局序号缩小
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
        wx.showToast({ title: result.errMsg || '加载失败', icon: 'none' });
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
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  layoutWaterfall(inspirations) {
    const list = inspirations || this.data.inspirations || [];
    const columns = [{ items: [], height: 0 }, { items: [], height: 0 }];

    // 按列表顺序（已是新→旧）依次填入较短列，保证越新越靠上
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

  onInspirationComposerTap() {
    if (!this.data.inspirationInputFocused) {
      this.setData({
        inspirationInputFocused: true,
        inspirationAutoFocus: true
      });
    }
  },

  onInspirationFocus() {
    if (this._inspirationBlurTimer) {
      clearTimeout(this._inspirationBlurTimer);
      this._inspirationBlurTimer = null;
    }
    this.setData({
      inspirationInputFocused: true,
      inspirationAutoFocus: false
    });
  },

  onInspirationBlur() {
    if (this._inspirationBlurTimer) clearTimeout(this._inspirationBlurTimer);
    this._inspirationBlurTimer = setTimeout(() => {
      this.setData({
        inspirationInputFocused: false,
        inspirationAutoFocus: false,
        inspirationHoldKeyboard: false,
        inspirationKeyboardHeight: 0
      });
    }, 180);
  },

  onInspirationDismissFocus() {
    if (this._inspirationBlurTimer) {
      clearTimeout(this._inspirationBlurTimer);
      this._inspirationBlurTimer = null;
    }
    this.setData({
      inspirationInputFocused: false,
      inspirationAutoFocus: false,
      inspirationHoldKeyboard: false,
      inspirationKeyboardHeight: 0
    });
  },

  onInspirationKeyboardHeightChange(e) {
    const height = (e && e.detail && e.detail.height) || 0;
    if (height === this.data.inspirationKeyboardHeight) return;
    this.setData({ inspirationKeyboardHeight: height });
  },

  onInspirationInput(e) {
    const text = (e.detail && e.detail.value) || '';
    this.setData({
      inspirationDraftText: text,
      inspirationHasText: !!text.trim()
    });
  },

  onInspirationActionTap() {
    const hasPhotos = (this.data.inspirationDraftPhotos || []).length > 0;
    if (!this.data.inspirationHasText && !hasPhotos) {
      this.onInspirationAddPhoto();
      return;
    }
    this.onInspirationSave();
  },

  onInspirationAddPhoto() {
    const photos = this.data.inspirationDraftPhotos || [];
    if (photos.length >= 9) {
      wx.showToast({ title: '最多 9 张图片', icon: 'none' });
      return;
    }
    this.setData({ inspirationHoldKeyboard: true });
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        wx.chooseImage({
          count: 9 - photos.length,
          sizeType: ['compressed'],
          sourceType,
          success: (chooseRes) => {
            const paths = chooseRes.tempFilePaths || [];
            if (!paths.length) {
              this.setData({ inspirationHoldKeyboard: false });
              return;
            }
            this.setData({
              inspirationDraftPhotos: photos.concat(paths),
              inspirationInputFocused: true,
              inspirationAutoFocus: true,
              inspirationHoldKeyboard: true
            });
          },
          fail: () => {
            this.setData({
              inspirationHoldKeyboard: false,
              inspirationInputFocused: true,
              inspirationAutoFocus: true
            });
          }
        });
      },
      fail: () => {
        this.setData({ inspirationHoldKeyboard: false });
      }
    });
  },

  onInspirationRemovePhoto(e) {
    const index = e.currentTarget.dataset.index;
    if (index == null) return;
    const photos = (this.data.inspirationDraftPhotos || []).slice();
    photos.splice(index, 1);
    this.setData({ inspirationDraftPhotos: photos });
  },

  onInspirationPreviewPhoto(e) {
    const url = e.currentTarget.dataset.url;
    const urls = this.data.inspirationDraftPhotos || [];
    if (!url) return;
    wx.previewImage({ current: url, urls });
  },

  async _uploadInspirationPhotos(paths) {
    const roomId = this.data.roomId || 'default';
    const results = [];
    for (let i = 0; i < paths.length; i += 1) {
      const filePath = paths[i];
      try {
        const cloudPath = `inspiration/${roomId}/${Date.now()}_${i}.jpg`;
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
        if (uploadRes && uploadRes.fileID) {
          results.push(uploadRes.fileID);
          continue;
        }
      } catch (e) {
        console.warn('_uploadInspirationPhotos cloud fail', e);
      }
      results.push(await persistTempPhoto(filePath));
    }
    return results;
  },

  async onInspirationSave() {
    if (this.data.inspirationSaving) return;
    const content = (this.data.inspirationDraftText || '').trim();
    const draftPhotos = this.data.inspirationDraftPhotos || [];
    if (!content && !draftPhotos.length) {
      wx.showToast({ title: '请输入灵感内容', icon: 'none' });
      return;
    }

    this.setData({ inspirationSaving: true });
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      const imageUrls = draftPhotos.length
        ? await this._uploadInspirationPhotos(draftPhotos)
        : [];
      const saveRes = await wx.cloud.callFunction({
        name: 'saveInspiration',
        data: withSessionFields({
          type: imageUrls.length ? 'image' : 'text',
          content,
          imageUrls,
          isAIGenerated: false
        }, this.data.roomId, this.data.brainstormSessionSeq)
      });
      const result = (saveRes && saveRes.result) || {};
      if (result.ok !== true) {
        throw new Error(result.errMsg || '保存失败');
      }
      this.setData({
        inspirationDraftText: '',
        inspirationDraftPhotos: [],
        inspirationHasText: false,
        inspirationInputFocused: false,
        inspirationAutoFocus: false,
        inspirationHoldKeyboard: false,
        inspirationKeyboardHeight: 0
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.loadInspirations();
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ inspirationSaving: false });
      wx.hideLoading();
    }
  }
});
