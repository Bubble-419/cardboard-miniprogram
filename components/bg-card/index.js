const TYPE_MAP = {
  scene: {
    label: '场景',
    title: '定义场景',
    placeholder: '点击以输入场景...',
    nextText: '下一张',
    description:
      '场景指用户在进行交互时所处的具体环境，包括周围的物理和社会环境等因素。例如：智能座舱、会议室、商场、室外运动场等。'
  },
  user: {
    label: '用户',
    title: '定义用户',
    placeholder: '点击以输入用户...',
    nextText: '下一张',
    description:
      '用户指进行交互活动的个体或群体。包括对用户特征、行为习惯、技能水平等方面的描述。例如：下班后的网约车乘客、视力听力下降的老年人等。'
  },
  platform: {
    label: '平台',
    title: '定义平台',
    placeholder: '点击以输入平台...',
    nextText: '下一张',
    description:
      '平台是指支撑交互活动实现的设备环境，能够确保设计方案在技术上具有可行性。例如：手机、平板电脑、电脑、智能穿戴设备、VR、餐厅点单机等。'
  },
  function: {
    label: '功能',
    title: '定义功能',
    placeholder: '点击以输入功能...',
    nextText: '下一张',
    description:
      '功能是系统提供的具体能力或特性，支持用户完成特定的操作；与活动相比，功能颗粒度更细，专注于实现活动所需的具体步骤。例如：PPT上下翻页、浏览商品、点赞分享等。'
  }
};

Component({
  properties: {
    // 类型：scene | user | platform | function
    type: {
      type: String,
      value: 'scene'
    },
    // 输入值
    value: {
      type: String,
      value: ''
    },
    // 是否为当前激活卡片（非激活会半透明）
    active: {
      type: Boolean,
      value: false
    }
  },

  data: {
    typeInfo: TYPE_MAP.scene
  },

  lifetimes: {
    attached() {
      this.updateTypeInfo(this.data.type);
    }
  },

  observers: {
    type(val) {
      this.updateTypeInfo(val);
    }
  },

  methods: {
    updateTypeInfo(type) {
      const info = TYPE_MAP[type] || TYPE_MAP.scene;
      this.setData({ typeInfo: info });
    },

    onTapInput() {
      this.triggerEvent('tapinput', { type: this.data.type });
    },

    onNext() {
      this.triggerEvent('next', { type: this.data.type });
    }
  }
});
