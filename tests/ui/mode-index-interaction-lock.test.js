const test = require('node:test');
const assert = require('node:assert/strict');

let pageDefinition = null;

const app = {
  globalData: {
    roomId: '12345678',
    gameMode: 'partner'
  }
};

global.Page = (definition) => {
  pageDefinition = definition;
};
global.getApp = () => app;
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

test('Halli Galli 选择情境后立即进入选择首位玩家页', async () => {
  const page = makePage();
  page.setData({
    modeId: 'halliGalli',
    selectedScenarioId: 'existing',
    scenarios: [{
      id: 'existing',
      type: 'case',
      bg: { scene: '办公室', user: '设计师', function: '协作' }
    }]
  });

  const commands = [];
  app.globalData.roomSession = {
    dispatch: async (command) => {
      commands.push(command);
      return { ok: true };
    },
    getSnapshot: () => ({
      ok: true,
      roomId: '12345678',
      revision: 4,
      view: { route: { name: 'selectPlayer', params: { phase: 'SELECT_FIRST_PLAYER' } } }
    })
  };

  let redirectUrl = '';
  const originalRedirectTo = global.wx.redirectTo;
  global.wx.redirectTo = (options) => {
    redirectUrl = options.url;
    if (typeof options.complete === 'function') options.complete({});
    else if (typeof options.success === 'function') options.success({});
  };

  try {
    await page._confirmSelectedScenario();
    assert.equal(commands.length, 1);
    assert.equal(commands[0].type, 'SET_SCENARIO');
    assert.match(redirectUrl, /^\/pages\/main-pages\/selectPlayer\/index\?/);
    assert.match(redirectUrl, /phase=SELECT_FIRST_PLAYER/);
  } finally {
    global.wx.redirectTo = originalRedirectTo;
    delete app.globalData.roomSession;
  }
});

test('情境页上一页取消场次后带着 isHost=1 回到选模式页', async () => {
  const page = makePage();
  const commands = [];
  let redirectUrl = '';
  app.globalData.roomSession = {
    roomId: '12345678',
    getState: () => ({ status: 'READY', roomId: '12345678' }),
    getView: () => ({
      actor: { capabilities: { CANCEL_WORKSHOP_SESSION: { allowed: true } } },
      session: { sessionId: 's1', status: 'CONFIGURING' }
    }),
    getSnapshot: () => ({
      ok: true,
      roomId: '12345678',
      isHost: true,
      revision: 3,
      view: { session: { sessionId: 's1', status: 'CONFIGURING' } }
    }),
    dispatch: async (command) => {
      commands.push(command);
      return { ok: true };
    }
  };
  const originalRedirectTo = global.wx.redirectTo;
  global.wx.redirectTo = (options) => {
    redirectUrl = options.url;
    if (typeof options.complete === 'function') options.complete({});
    else if (typeof options.success === 'function') options.success({});
  };
  try {
    await page.handleGoBack();
    assert.equal(commands[0].type, 'CANCEL_WORKSHOP_SESSION');
    assert.match(redirectUrl, /brainstormMode/);
    assert.match(redirectUrl, /isHost=1/);
  } finally {
    global.wx.redirectTo = originalRedirectTo;
    delete app.globalData.roomSession;
  }
});
