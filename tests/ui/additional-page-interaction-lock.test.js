const test = require('node:test');
const assert = require('node:assert/strict');

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
