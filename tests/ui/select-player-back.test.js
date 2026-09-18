'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

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
  global.wx = {
    showToast() {},
    redirectTo() {},
    navigateBack() {}
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

test('selectPlayer 上一页会提交 RESET_DESIGN_PROBLEM 并跟随权威 route', async () => {
  const commands = [];
  let redirectUrl = '';
  const previousPages = global.getCurrentPages;
  const definition = loadPageDefinition('../../pages/main-pages/selectPlayer/index');
  global.getCurrentPages = () => [{
    route: 'pages/main-pages/selectPlayer/index',
    data: {}
  }];
  global.wx = {
    showToast() {},
    redirectTo(options) {
      redirectUrl = options.url;
      if (typeof options.complete === 'function') options.complete({});
      else if (typeof options.success === 'function') options.success({});
    }
  };
  app.globalData.roomSession = {
    roomId: '12345678',
    dispatch: async (command) => {
      commands.push(command);
      return { ok: true, outcome: { committedThroughSeq: 12 } };
    },
    getView: () => ({
      actor: { capabilities: { RESET_DESIGN_PROBLEM: { allowed: true } } },
      session: { sessionId: 's1', workflow: { step: 'SELECT_FIRST_PLAYER', revision: 3 } },
      navigation: { back: { kind: 'COMMAND', commandType: 'RESET_DESIGN_PROBLEM',
        context: { sessionId: 's1', workflowRevision: 3 }, after: 'FOLLOW_ROUTE' } }
    }),
    getSnapshot: () => ({
      ok: true,
      roomId: '12345678',
      revision: 12,
      view: { route: { name: 'selectProblem', params: { phase: 'SELECT_DESIGN_PROBLEM' } } }
    })
  };
  const page = makePage(definition, {
    roomId: '12345678',
    selectedModeId: 'partner',
    isHost: true
  });
  try {
    await page.goBack();
    assert.equal(commands[0].type, 'RESET_DESIGN_PROBLEM');
    assert.deepEqual(commands[0].context, { sessionId: 's1', workflowRevision: 3 });
    assert.match(redirectUrl, /selectProblem/);
  } finally {
    global.getCurrentPages = previousPages;
    delete app.globalData.roomSession;
  }
});

test('selectPlayer 等待态和 subAwait 都不展示上一页', () => {
  const selectPlayer = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/selectPlayer/index.wxml'),
    'utf8'
  );
  const subAwait = fs.readFileSync(
    path.resolve(__dirname, '../../pages/sub-pages/subAwait/index.wxml'),
    'utf8'
  );
  assert.match(selectPlayer, /empty-wait-state" wx:if="\{\{isWaiting\}\}"/);
  assert.match(selectPlayer, /navbar-left" wx:if="\{\{isHost\}\}"/);
  assert.doesNotMatch(selectPlayer, /empty-wait-state[\s\S]{0,240}page-footer/);
  assert.doesNotMatch(subAwait, /page-footer/);
  assert.doesNotMatch(subAwait, /bindtap="goBack"/);
  assert.doesNotMatch(subAwait, /back-icon/);
  assert.match(subAwait, /src="\{\{waitHeroSrc\}\}"/);
});
