Component({
  options: {
    styleIsolation: 'apply-shared',
    multipleSlots: false
  },

  properties: {
    showPrev: {
      type: Boolean,
      value: true
    },
    showPrimary: {
      type: Boolean,
      value: true
    },
    prevText: {
      type: String,
      value: '上一页'
    },
    fixed: {
      type: Boolean,
      value: true
    },
    extClass: {
      type: String,
      value: ''
    }
  },

  methods: {
    onPrevTap() {
      this.triggerEvent('prev');
    }
  }
});
