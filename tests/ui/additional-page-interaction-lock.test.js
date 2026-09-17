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
      finishNavigation = () => options.complete({});
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
    roomId: '12345678',
    getView: () => ({ session: { sessionId: 'session-1' } }),
    getSnapshot: () => ({
      ok: true,
      roomId: '12345678',
      revision: 2,
      view: { route: { name: 'confirmFirstPlayer', params: { phase: 'CONFIRM_FIRST_PLAYER' } } }
    }),
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

test('最后提交设计问题的普通玩家按 Member View 进入等待页，而不是房主选择页', async () => {
  let redirectUrl = '';
  global.wx = {
    showToast() {},
    redirectTo(options) {
      redirectUrl = options.url;
      if (typeof options.complete === 'function') options.complete({});
    }
  };
  const snapshot = {
    ok: true,
    roomId: '12345678',
    revision: 8,
    memberCount: 2,
    members: [
      { memberId: 'member-host', playerIndex: 1, nickName: '房主' },
      { memberId: 'member-2', playerIndex: 2, nickName: '玩家2', isMe: true }
    ],
    view: {
      route: { name: 'subAwait', params: { phase: 'SELECT_DESIGN_PROBLEM' } },
      actor: {
        memberId: 'member-2',
        contributionStatus: { submitted: true, text: '问题 B' }
      },
      session: {
        setup: {
          designProblems: [
            { contributionId: 'p1', memberId: 'member-host', text: '问题 A' },
            { contributionId: 'p2', memberId: 'member-2', text: '问题 B' }
          ]
        },
        progress: { contributionProgress: { submittedCount: 2, requiredCount: 2 } }
      }
    }
  };
  app.globalData.roomSession = {
    roomId: '12345678',
    getState: () => ({ status: 'READY', roomId: '12345678' }),
    getView: () => snapshot.view,
    getSnapshot: () => snapshot,
    refresh: async () => snapshot,
    dispatch: async () => ({ ok: true })
  };

  const definition = loadPageDefinition('../../pages/main-pages/submitProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    myPlayerIndex: 2,
    myNickName: '玩家2',
    problemText: '问题 B',
    totalMembers: 2
  });

  await page.submitProblem();
  assert.match(redirectUrl, /^\/pages\/sub-pages\/subAwait\/index\?/);
  assert.doesNotMatch(redirectUrl, /selectProblem/);
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
      revision: 10,
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
      revision: 12,
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
      revision: 14,
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

test('共享玩家列表引用的小程序包内图标必须真实存在', () => {
  const componentPath = path.join(__dirname, '../../components/user-list/index.wxml');
  const wxml = fs.readFileSync(componentPath, 'utf8');
  const assetPaths = Array.from(wxml.matchAll(/src="(\/assets\/[^"]+)"/g), (match) => match[1]);

  assert.ok(assetPaths.length > 0, '共享玩家列表应包含本地图标');
  assetPaths.forEach((assetPath) => {
    assert.equal(
      fs.existsSync(path.join(__dirname, '../..', assetPath.slice(1))),
      true,
      `缺少静态资源：${assetPath}`
    );
  });
});
