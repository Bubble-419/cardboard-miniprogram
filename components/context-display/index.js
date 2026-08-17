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
      if (Array.isArray(items) && items.length > 0) {
        const displayItems = enrichDisplayItems(
          items.filter((item) => {
            if (!item || !item.name) return false;
            if (item.label && item.name === item.label) return false;
            return true;
          })
        );
        this.setData({ displayItems });
        return;
      }
      this.setData({ displayItems: enrichDisplayItems(buildContextDisplayItems(bg)) });
    },

    onDisplayTap() {
      this.triggerEvent('opentap');
    }
  }
});
