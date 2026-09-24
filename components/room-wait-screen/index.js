'use strict';

/**
 * RoomShell 的通用纯展示等待屏幕。
 * 权威 View 的解释由 Shell 完成，组件只渲染已经投影好的显示模型。
 */
Component({
  properties: {
    model: { type: Object, value: null },
    waitHeroSrc: { type: String, value: '' }
  }
});
