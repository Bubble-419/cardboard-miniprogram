const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = {
  globalData: {
    roomId: '12345678',
    gameMode: 'partner'
  }
};

global.getApp = () => app;

function loadPageDefinition(modulePath) {
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  return definition;
}

function makePage(definition, data = {}) {
  return {
    ...definition,
    data: {
      ...definition.data,
      ...data
    },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
}

test('selectBG confirm locks the whole page through redirect completion', async () => {
  let finishNavigation = null;
  global.wx = {
    cloud: {
      async callFunction() {
        return { result: { ok: true } };
      }
    },
    showToast() {},
    redirectTo(options) {
      finishNavigation = () => options.success({});
    }
  };

  const definition = loadPageDefinition('../../pages/main-pages/selectBG/index');
  const page = makePage(definition, {
    includePlatform: true,
    canConfirm: true,
    bg: {
      scene: 'scene',
      user: 'user',
      platform: 'platform',
      function: 'function'
    }
  });

  const running = page.confirmBG();
  assert.equal(page.data.interactionLocked, true, '点击确认后应立即锁住整页');

  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishNavigation, 'function', '应已发起路由跳转');
  assert.equal(page.data.interactionLocked, true, '路由完成前应保持锁定');

  finishNavigation();
  await running;
  assert.equal(page.data.interactionLocked, false, '路由回调后应释放锁');
});

test('selectPlayer confirm blocks reselect until redirect completion', async () => {
  let finishNavigation = null;
  global.wx = {
    showToast() {},
    redirectTo(options) {
      finishNavigation = () => options.success({});
    }
  };

  const definition = loadPageDefinition('../../pages/main-pages/selectPlayer/index');
  const page = makePage(definition, {
    roomId: '12345678',
    members: [{ memberId: 'member-2', playerIndex: 2, nickName: '玩家2' }],
    selectedPlayerIndex: 2,
    selectedModeId: 'partner',
    selectionAnimationDone: true
  });
  app.globalData.roomSession = {
    getView: () => ({ session: { sessionId: 'session-1' } }),
    dispatch: async () => ({ ok: true })
  };

  const running = page.confirmSelection();
  assert.equal(page.data.interactionLocked, true, '点击确认后应立即锁住整页');

  page.reselectSelection();
  assert.equal(page.data.selectedPlayerIndex, 2, '跳转期间应忽略重新选择');

  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishNavigation, 'function', '应已发起路由跳转');
  finishNavigation();
  await running;
  assert.equal(page.data.interactionLocked, false, '路由回调后应释放锁');
  delete app.globalData.roomSession;
});

test('Halli Galli 自定义情境确认后进入选择首位玩家页', async () => {
  const commands = [];
  let redirectUrl = '';
  global.wx = {
    showToast() {},
    redirectTo(options) {
      redirectUrl = options.url;
      if (typeof options.complete === 'function') options.complete({});
      else if (typeof options.success === 'function') options.success({});
    }
  };
  app.globalData.gameMode = 'halliGalli';
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

  const definition = loadPageDefinition('../../pages/main-pages/selectBG/index');
  const page = makePage(definition, {
    includePlatform: false,
    canConfirm: true,
    bg: { scene: '会议室', user: '设计师', platform: '', function: '协作' }
  });

  await page.confirmBG();
  assert.equal(commands[0].type, 'SET_SCENARIO');
  assert.match(redirectUrl, /^\/pages\/main-pages\/selectPlayer\/index\?/);
  assert.match(redirectUrl, /phase=SELECT_FIRST_PLAYER/);
  delete app.globalData.roomSession;
});

test('大富翁情境确认后进入提交问题页', async () => {
  const commands = [];
  let redirectUrl = '';
  global.wx = {
    showToast() {},
    redirectTo(options) {
      redirectUrl = options.url;
      if (typeof options.complete === 'function') options.complete({});
      else if (typeof options.success === 'function') options.success({});
    }
  };
  app.globalData.gameMode = 'partner';
  app.globalData.selectedBGSource = 'case';
  app.globalData.selectedBG = {
    scene: '会议室', user: '设计师', platform: '小程序', function: '协作'
  };
  app.globalData.roomSession = {
    dispatch: async (command) => {
      commands.push(command);
      return { ok: true };
    },
    getSnapshot: () => ({
      ok: true,
      roomId: '12345678',
      revision: 4,
      view: { route: { name: 'submitProblem', params: { phase: 'COLLECT_DESIGN_PROBLEMS' } } }
    })
  };

  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/confirmBG/index');
  const page = makePage(definition, {
    roomId: '12345678',
    isHost: true,
    canConfirm: true,
    fromGameView: false
  });

  await page.handleConfirm();
  assert.equal(commands[0].type, 'SET_SCENARIO');
  assert.match(redirectUrl, /^\/pages\/main-pages\/submitProblem\/index\?/);
  delete app.globalData.roomSession;
});

test('大富翁确认首位玩家后进入游戏页', async () => {
  const commands = [];
  let redirectUrl = '';
  global.wx = {
    showToast() {},
    redirectTo(options) {
      redirectUrl = options.url;
      if (typeof options.complete === 'function') options.complete({});
      else if (typeof options.success === 'function') options.success({});
    }
  };
  app.globalData.gameMode = 'partner';
  app.globalData.roomSession = {
    dispatch: async (command) => {
      commands.push(command);
      return { ok: true };
    },
    getSnapshot: () => ({
      ok: true,
      roomId: '12345678',
      revision: 6,
      view: { route: { name: 'partnerGame', params: { currentPlayerIndex: 2 } } }
    })
  };

  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/confirmFirstPlayer/index');
  const page = makePage(definition, {
    roomId: '12345678',
    isHost: true,
    canConfirm: true,
    selectedPlayerIndex: 2,
    members: [{ memberId: 'member-2', playerIndex: 2, nickName: '玩家2' }]
  });

  await page.handleConfirm();
  assert.deepEqual(commands.map((command) => command.type), [
    'SELECT_FIRST_PLAYER',
    'CONFIRM_FIRST_PLAYER'
  ]);
  assert.match(redirectUrl, /^\/pages\/main-pages\/partnerMode\/gamepage\/index\?/);
  delete app.globalData.roomSession;
});

test('Halli Galli 活动页保持原业务语义：房主使用短文案“结束游戏”进入创意阶段', () => {
  const wxml = fs.readFileSync(path.join(
    __dirname,
    '../../pages/main-pages/halliGalli/gamepage/index.wxml'
  ), 'utf8');
  assert.match(wxml, /线下游戏进行中/);
  assert.match(wxml, />结束游戏<\/button>/);
  assert.doesNotMatch(wxml, /完成线下游戏，进入创意/);
});
