Component({
  options: {
    virtualHost: true
  },

  properties: {
    locked: {
      type: Boolean,
      value: false
    },
    loading: {
      type: Boolean,
      value: false
    },
    text: {
      type: String,
      value: '加载中…'
    }
  },

  methods: {
    noop() {}
  }
});
