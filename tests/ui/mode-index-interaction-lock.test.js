const test = require('node:test');
const assert = require('node:assert/strict');

let pageDefinition = null;

global.Page = (definition) => {
  pageDefinition = definition;
};
global.getApp = () => ({
  globalData: {
    roomId: '12345678',
    gameMode: 'partner'
  }
});
global.wx = {
  showToast() {},
  navigateTo(options) {
    if (options && typeof options.success === 'function') options.success({});
  },
  redirectTo(options) {
    if (options && typeof options.success === 'function') options.success({});
  }
};

require('../../pages/main-pages/modeIndex/index');

function makePage() {
  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      roomId: '12345678',
      modeId: 'partner',
      isHost: true,
      scenarios: [{ id: 'existing', type: 'case', bg: { scene: 'test' } }]
    },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  return page;
}

test('ignores an existing-scenario tap while add-scenario navigation is locked', async () => {
  const page = makePage();
  const originalNavigateTo = global.wx.navigateTo;
  let navigationCalls = 0;
  let finishNavigation = null;
  global.wx.navigateTo = (options) => {
    navigationCalls += 1;
    finishNavigation = () => options.success({});
  };

  try {
    const addScenario = page._goAddScenario();
    await new Promise((resolve) => setImmediate(resolve));

    page.onCardArrow({ currentTarget: { dataset: { id: 'existing' } } });
    assert.equal(navigationCalls, 1, '全屏锁期间不应启动第二个情境跳转请求');

    finishNavigation();
    await addScenario;
  } finally {
    global.wx.navigateTo = originalNavigateTo;
  }
});

test('ignores add-scenario while existing-scenario navigation is locked', async () => {
  const page = makePage();
  const originalNavigateTo = global.wx.navigateTo;
  let navigationCalls = 0;
  let finishNavigation = null;
  global.wx.navigateTo = (options) => {
    navigationCalls += 1;
    finishNavigation = () => options.success({});
  };

  try {
    page.onCardArrow({ currentTarget: { dataset: { id: 'existing' } } });
    await new Promise((resolve) => setImmediate(resolve));

    page.handleAddScenario();
    assert.equal(navigationCalls, 1, '选择情境的全屏锁期间不应启动新增情境请求');

    finishNavigation();
    await Promise.resolve();
  } finally {
    global.wx.navigateTo = originalNavigateTo;
  }
});

test('keeps the page locked while navigation is still transitioning', async () => {
  const page = makePage();
  let navigationCalls = 0;
  let completeNavigation = null;
  const originalNavigateTo = global.wx.navigateTo;
  global.wx.navigateTo = (options) => {
    navigationCalls += 1;
    completeNavigation = () => options.success({});
  };
  try {
    page.handleAddScenario();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(navigationCalls, 1, '已发起第一次页面跳转');
    await new Promise((resolve) => setImmediate(resolve));

    page.onCardArrow({ currentTarget: { dataset: { id: 'existing' } } });
    await Promise.resolve();

    assert.equal(navigationCalls, 1, '页面切换完成前不应启动第二次请求');
    completeNavigation();
    await Promise.resolve();
  } finally {
    global.wx.navigateTo = originalNavigateTo;
  }
});
