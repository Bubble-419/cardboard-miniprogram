const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('选择情境房主页底栏参与纵向布局，不覆盖最后一张情境卡', () => {
  const wxml = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/modeIndex/index.wxml'
  ), 'utf8');
  const wxss = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/modeIndex/index.wxss'
  ), 'utf8');
  const footers = [...wxml.matchAll(/<page-footer[\s\S]*?<\/page-footer>/g)];
  const hostFooter = footers[footers.length - 1];
  const containerRule = wxss.match(/\.container\s*\{[\s\S]*?\}/);
  const hostPageRule = wxss.match(/\.host-page\s*\{[\s\S]*?\}/);

  assert.ok(hostFooter);
  assert.match(hostFooter[0], /fixed="\{\{false\}\}"/);
  assert.ok(containerRule);
  assert.match(containerRule[0], /display:\s*flex;/);
  assert.match(containerRule[0], /flex-direction:\s*column;/);
  assert.ok(hostPageRule);
  assert.match(hostPageRule[0], /flex:\s*1;/);
  assert.match(hostPageRule[0], /min-height:\s*0;/);
  assert.doesNotMatch(hostPageRule[0], /padding-bottom:\s*160rpx/);
});

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
      session: { sessionId: 's1', status: 'CONFIGURING' },
      navigation: { back: { kind: 'COMMAND', commandType: 'CANCEL_WORKSHOP_SESSION',
        context: { sessionId: 's1' }, after: 'OPEN_MODE_PICKER' } }
    }),
    getSnapshot: () => ({
      ok: true,
      roomId: '12345678',
      isHost: true,
      revision: 300,
      view: {
        session: null,
        route: { name: 'addPlayer', params: {} }
      }
    }),
    dispatch: async (command) => {
      commands.push(command);
      return { ok: true };
    }
  };
  const originalRedirectTo = global.wx.redirectTo;
  const originalNavigateTo = global.wx.navigateTo;
  const captureNavigation = (options) => {
    redirectUrl = options.url;
    if (typeof options.complete === 'function') options.complete({});
    else if (typeof options.success === 'function') options.success({});
  };
  global.wx.redirectTo = captureNavigation;
  global.wx.navigateTo = captureNavigation;
  try {
    await page.handleGoBack();
    assert.equal(commands[0].type, 'CANCEL_WORKSHOP_SESSION');
    assert.deepEqual(commands[0].context, { sessionId: 's1' });
    assert.match(redirectUrl, /brainstormMode/);
    assert.match(redirectUrl, /isHost=1/);
  } finally {
    global.wx.redirectTo = originalRedirectTo;
    global.wx.navigateTo = originalNavigateTo;
    delete app.globalData.roomSession;
  }
});

test('情境页后退不得在 reLaunch 忙期丢失选模式叠层', async () => {
  const page = makePage();
  const roomId = '87654321';
  page.setData({ roomId });
  app.globalData.roomId = roomId;
  app.globalData.roomSession = {
    roomId,
    getState: () => ({ status: 'READY', roomId }),
    getView: () => ({
      actor: { capabilities: { CANCEL_WORKSHOP_SESSION: { allowed: true } } },
      session: { sessionId: 's-race', status: 'CONFIGURING' },
      navigation: { back: { kind: 'COMMAND', commandType: 'CANCEL_WORKSHOP_SESSION',
        context: { sessionId: 's-race' }, after: 'OPEN_MODE_PICKER' } }
    }),
    getSnapshot: () => ({
      ok: true,
      roomId,
      revision: 901,
      view: { session: null, route: { name: 'addPlayer', params: {} } }
    }),
    dispatch: async () => ({ ok: true })
  };

  const previousWx = global.wx;
  const previousGetCurrentPages = global.getCurrentPages;
  let currentRoute = 'pages/main-pages/modeIndex/index';
  let visibleUrl = '/pages/main-pages/modeIndex/index';
  let reLaunchBusy = false;
  global.getCurrentPages = () => [{ route: currentRoute, data: {} }];
  global.wx = {
    showToast() {},
    reLaunch(options) {
      visibleUrl = options.url;
      currentRoute = 'pages/main-pages/addPlayer/index';
      reLaunchBusy = true;
      if (typeof options.complete === 'function') options.complete({});
      setImmediate(() => { reLaunchBusy = false; });
    },
    navigateTo(options) {
      if (reLaunchBusy) {
        if (typeof options.fail === 'function') {
          options.fail({ errMsg: 'navigateTo:fail page is reLaunching' });
        }
        return;
      }
      visibleUrl = options.url;
      currentRoute = 'pages/main-pages/brainstormMode/index';
      if (typeof options.success === 'function') options.success({});
    },
    redirectTo(options) {
      visibleUrl = options.url;
      currentRoute = 'pages/main-pages/brainstormMode/index';
      if (typeof options.success === 'function') options.success({});
    }
  };

  try {
    await page.handleGoBack();
    assert.match(visibleUrl, /brainstormMode/,
      '用户最终应看到模式选择，不能因为 reLaunch 竞态停在大厅');
  } finally {
    global.wx = previousWx;
    global.getCurrentPages = previousGetCurrentPages;
    app.globalData.roomId = '12345678';
    delete app.globalData.roomSession;
  }
});
