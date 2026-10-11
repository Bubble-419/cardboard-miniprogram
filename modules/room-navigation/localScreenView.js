'use strict';

/** 展示组件只接收本地 Model、发出语义意图，不连接 RoomSession 或执行 Command。 */
function localScreenView(intents) {
  const methods = {};
  intents.forEach((name) => {
    methods[name] = function emitIntent(event = {}) {
      this.triggerEvent('intent', { token: this.properties.token, name, event: {
        type: event.type, detail: event.detail || {},
        currentTarget: { dataset: event.currentTarget && event.currentTarget.dataset || {} },
        target: { dataset: event.target && event.target.dataset || {} },
        touches: event.touches || [], changedTouches: event.changedTouches || []
      } });
    };
  });
  return {
    // 完整 Model 安装后才创建子组件，避免首帧传递 undefined 的类型/交互状态。
    data: { modelReady: false },
    properties: { model: { type: Object, value: {} }, token: { type: Number, value: 0 } },
    observers: {
      model(model) {
        if (!model || !Object.keys(model).length) return;
        const previous = this._renderModel || {};
        const patch = {};
        Object.keys(model || {}).forEach((key) => { if (model[key] !== previous[key]) patch[key] = model[key]; });
        if (!this._renderModel) patch.modelReady = true;
        this._renderModel = { ...model };
        if (Object.keys(patch).length) this.setData(patch);
      }
    },
    lifetimes: { ready() { this.triggerEvent('screenready', { token: this.properties.token }); } },
    methods
  };
}

module.exports = { localScreenView };
