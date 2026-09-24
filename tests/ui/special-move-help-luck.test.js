'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadPageDefinition(app) {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => app;
  global.wx = {
    showToast() {},
    getStorageSync() { return null; },
    setStorageSync() {},
    getWindowInfo() { return { windowHeight: 800, statusBarHeight: 44 }; },
    getMenuButtonBoundingClientRect() { return { top: 48, height: 32, width: 87, right: 360 }; }
  };
  const modulePath = require.resolve('../../pages/main-pages/partnerMode/specialMove/index');
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition, data) {
  const page = {
    ...definition,
    data: { ...definition.data, ...data },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (typeof callback === 'function') callback();
    }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key].bind(page);
  });
  page._jumpToActionCard = () => {};
  page.loadRoomData = async () => {};
  page._stopStatePolling = () => {};
  page._returnToGamepage = async () => {};
  return page;
}

async function withRuntime(app, run) {
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  global.getApp = () => app;
  global.wx = { showToast() {} };
  try {
    return await run();
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
}

function fixture() {
  const commands = [];
  const app = { globalData: {} };
  app.globalData.roomId = '12345678';
  app.globalData.roomSession = {
    roomId: '12345678',
    getSnapshot: () => ({
      ok: true,
      revision: 2,
      roomId: '12345678',
      roomState: { partnerGamePhase: 'closing' },
      view: { route: { name: 'closingStatement', params: {} } }
    }),
    getView: () => ({
      actor: { capabilities: { USE_PARTNER_SPECIAL: { allowed: true } } },
      session: { sessionId: 's1', activeTurn: { turnId: 't1' } }
    }),
    dispatch: async (command) => {
      commands.push(command);
      return { ok: true };
    }
  };
  const definition = loadPageDefinition(app);
  const page = makePage(definition, {
    roomId: '12345678', sessionId: 's1', turnId: 't1', currentRound: 1,
    selectedAction: 'helpLuck', viewMode: 'wheel'
  });
  return { app, page, commands };
}

test('反面随机拼预览和返回转盘不消耗特殊行动', async () => {
  const { app, page, commands } = fixture();
  await withRuntime(app, async () => {
    await page.handleConfirm();
    assert.equal(page.data.viewMode, 'reverseRandom');
    assert.equal(commands.length, 0, '打开预览不应发送 USE_PARTNER_SPECIAL');

    await page.handleGoBack();
    assert.equal(page.data.viewMode, 'wheel');
    assert.equal(commands.length, 0, '从预览返回转盘不应消耗特殊行动');
  });
});

test('反面随机拼只在取消采用或采用卡组时消耗特殊行动', async () => {
  for (const action of ['handleCancelAdopt', 'handleAdoptDeck']) {
    const { app, page, commands } = fixture();
    page.setData({ viewMode: 'reverseRandom' });
    await withRuntime(app, async () => page[action]());
    assert.equal(commands.length, 1, `${action} 应当只发送一次指令`);
    assert.equal(commands[0].type, 'USE_PARTNER_SPECIAL');
    assert.deepEqual(commands[0].payload, { kind: 'HELP_LUCK' });
  }
});

test('Master 完成后关闭本地叠层并复用下层 gamepage，不用 redirect 重建页面', async () => {
  const { app, page } = fixture();
  const definition = loadPageDefinition(app);
  page._returnToGamepage = definition._returnToGamepage.bind(page);
  page._redirectToGamepageFromRoom = definition._redirectToGamepageFromRoom.bind(page);

  const calls = [];
  const previousPages = global.getCurrentPages;
  global.getCurrentPages = () => [
    { route: 'pages/main-pages/partnerMode/gamepage/index', data: {} },
    { route: 'pages/main-pages/partnerMode/specialMove/index', data: {} }
  ];
  try {
    await withRuntime(app, async () => {
      global.wx = {
        showToast() {},
        navigateBack(options) {
          calls.push('navigateBack');
          options.success({});
        },
        redirectTo(options) {
          calls.push('redirectTo');
          options.success({});
        },
        reLaunch(options) {
          calls.push('reLaunch');
          options.success({});
        }
      };
      const result = await page._returnToGamepage();
      assert.equal(result.ok, true);
      assert.deepEqual(calls, ['navigateBack']);
    });
  } finally {
    global.getCurrentPages = previousPages;
  }
});

test('进入收尾阶段后关闭本地叠层，由下层 RoomShell 消费权威 View', async () => {
  const { app, page, commands } = fixture();
  let returnedState = null;
  page._redirectToGamepageFromRoom = async (snapshot) => {
    returnedState = snapshot.roomState;
    return { ok: true };
  };

  await withRuntime(app, async () => page.activateClosing());

  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'USE_PARTNER_SPECIAL');
  assert.deepEqual(commands[0].payload, { kind: 'CLOSING' });
  assert.deepEqual(returnedState, { partnerGamePhase: 'closing' });
});

test('特殊行动页点击设计问题进入详情并传递当前情境', async () => {
  const { app, page } = fixture();
  const selectedBG = { title: '通勤途中', content: '用户正在赶时间' };
  app.globalData.roomSession.getView = () => ({
    session: {
      setup: {
        selectedProblem: { contributionId: 'problem-1' },
        scenario: selectedBG
      }
    }
  });
  page.setData({ selectedProblemText: '如何改善通勤体验？' });

  let navigationOptions = null;
  let channelEvent = null;
  await withRuntime(app, async () => {
    global.wx = {
      showToast() {},
      navigateTo(options) {
        navigationOptions = options;
        options.success({
          eventChannel: {
            emit(name, payload) {
              channelEvent = { name, payload };
            }
          }
        });
      }
    };
    const result = await page.handleViewSituation();
    assert.equal(result.ok, true);
  });

  assert.match(navigationOptions.url, /partnerMode\/confirmBG\/index/);
  assert.match(navigationOptions.url, /from=specialMove/);
  assert.match(navigationOptions.url, /currentPlayerIndex=1/);
  assert.match(navigationOptions.url, /problemText=/);
  assert.deepEqual(channelEvent, {
    name: 'initGameDetail',
    payload: {
      problemText: '如何改善通勤体验？',
      problemId: 'problem-1',
      selectedBG
    }
  });
  assert.deepEqual(app.globalData.selectedProblem, {
    id: 'problem-1',
    text: '如何改善通勤体验？'
  });
  assert.equal(app.globalData.selectedBG, selectedBG);
});

test('特殊行动页设计问题区域绑定详情导航', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/specialMove/index.wxml'),
    'utf8'
  );
  assert.match(wxml, /class="problem-chip[^\"]*"[\s\S]*?bindtap="handleViewSituation"/);

  const detailPageJs = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/confirmBG/index.js'),
    'utf8'
  );
  assert.match(detailPageJs, /from === 'specialMove'/);
  assert.match(detailPageJs, /expectedPrev: 'pages\/main-pages\/partnerMode\/specialMove\/index'/);
});
