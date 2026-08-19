const { CONTEXT_ICONS, buildContextDisplayItems } = require('../../utils/scenarioCategories');

function enrichDisplayItems(items) {
  return items.map((item) => ({
    ...item,
    label: item.label || item.key || '',
    icon: item.icon || CONTEXT_ICONS[item.key] || ''
  }));
}

Component({
  properties: {
    /** 情境对象 { scene, user, platform?, function } */
    bg: {
      type: Object,
      value: null
    },
    /** 直接传入展示项，优先级高于 bg */
    items: {
      type: Array,
      value: []
    }
  },

  data: {
    displayItems: []
  },

  observers: {
    'bg, items': function (bg, items) {
      this._syncDisplayItems(bg, items);
    }
  },

  lifetimes: {
    attached() {
      this._syncDisplayItems(this.properties.bg, this.properties.items);
    }
  },

  methods: {
    _syncDisplayItems(bg, items) {
      let displayItems = [];
      if (Array.isArray(items) && items.length > 0) {
        displayItems = enrichDisplayItems(
          items.filter((item) => {
            if (!item || !item.name) return false;
            if (item.label && item.name === item.label) return false;
            return true;
          })
        );
      } else {
        displayItems = enrichDisplayItems(buildContextDisplayItems(bg));
      }
      const fingerprint = displayItems
        .map((item) => `${item.key || ''}:${item.name || ''}:${item.icon || ''}`)
        .join('|');
      if (fingerprint === this._displayFingerprint) return;
      this._displayFingerprint = fingerprint;
      this.setData({ displayItems });
    },

    onDisplayTap() {
      this.triggerEvent('opentap');
    }
  }
});
