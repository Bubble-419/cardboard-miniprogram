'use strict';

Component({
  properties: {
    count: { type: Number, value: 0 },
    draftText: { type: String, value: '' },
    hasText: { type: Boolean, value: false },
    draftPhotos: { type: Array, value: [] },
    holdKeyboard: { type: Boolean, value: false },
    saving: { type: Boolean, value: false },
    keyboardHeight: { type: Number, value: 0 },
    closing: { type: Boolean, value: false },
    history: { type: Boolean, value: false },
    historyWithFooter: { type: Boolean, value: false },
    safeBottom: { type: Boolean, value: false },
    hiddenByKeyboard: { type: Boolean, value: false }
  },

  methods: {
    onOpenCenter() { this.triggerEvent('opencenter', {}); },
    onFocus(e) { this.triggerEvent('focus', (e && e.detail) || {}); },
    onBlur(e) { this.triggerEvent('blur', (e && e.detail) || {}); },
    onInput(e) { this.triggerEvent('input', (e && e.detail) || {}); },
    onKeyboardHeightChange(e) {
      this.triggerEvent('keyboardheightchange', (e && e.detail) || {});
    },
    onActionTap() { this.triggerEvent('action', {}); },
    onPreviewPhoto(e) {
      const url = e && e.currentTarget && e.currentTarget.dataset
        && e.currentTarget.dataset.url;
      this.triggerEvent('previewphoto', { url: url || '' });
    },
    onRemovePhoto(e) {
      const index = e && e.currentTarget && e.currentTarget.dataset
        && e.currentTarget.dataset.index;
      this.triggerEvent('removephoto', { index });
    }
  }
});
