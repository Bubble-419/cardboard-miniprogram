const test = require('node:test');
const assert = require('node:assert/strict');

let pageDefinition = null;

const app = {
  globalData: {
    roomId: '12345678',
    gameMode: 'spy'
  }
};

global.Page = (definition) => {
  pageDefinition = definition;
};
global.getApp = () => app;

require('../../packageSpy/pages/modeIndex/index');

function makePage() {
  return {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      roomId: '12345678',
      isHost: true
    },
    _pageAlive: true,
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
}

test('Spy 规则页后退时先停止订阅，避免大厅 reLaunch 抢占模式选择叠层', async () => {
  const page = makePage();
  const roomId = page.data.roomId;
  const beforeView = {
    actor: { capabilities: { CANCEL_WORKSHOP_SESSION: { allowed: true } } },
    session: { sessionId: 'spy-session', status: 'CONFIGURING' },
    navigation: {
      back: {
        kind: 'COMMAND',
        commandType: 'CANCEL_WORKSHOP_SESSION',
        context: { sessionId: 'spy-session' },
        after: 'OPEN_MODE_PICKER'
      }
    },
    route: { name: 'spyIntro', params: {} }
  };
  const afterSnapshot = {
    ok: true,
    roomId,
    revision: 12,
    members: [],
    view: {
      actor: { capabilities: {} },
      session: null,
      route: { name: 'addPlayer', params: {} }
    }
  };
  let currentView = beforeView;
  let listener = null;
  let visibleUrl = '/packageSpy/pages/modeIndex/index';
  let currentRoute = 'packageSpy/pages/modeIndex/index';
  let reLaunchBusy = false;

  app.globalData.roomSession = {
    roomId,
    getState: () => ({ status: 'READY', roomId }),
    getView: () => currentView,
    getSnapshot: () => currentView === beforeView
      ? { ...afterSnapshot, view: beforeView, revision: 11 }
      : afterSnapshot,
    subscribe(callback) {
      listener = callback;
      callback({ ...afterSnapshot, view: beforeView, revision: 11 });
      return () => { listener = null; };
    },
    async dispatch() {
      currentView = afterSnapshot.view;
      if (listener) listener(afterSnapshot);
      return { ok: true, outcome: { committedThroughSeq: afterSnapshot.revision } };
    }
  };

  const previousWx = global.wx;
  const previousGetCurrentPages = global.getCurrentPages;
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
    redirectTo(options) {
      if (reLaunchBusy) {
        if (typeof options.fail === 'function') {
          options.fail({ errMsg: 'redirectTo:fail page is reLaunching' });
        }
        return;
      }
      visibleUrl = options.url;
      currentRoute = 'pages/main-pages/brainstormMode/index';
      if (typeof options.success === 'function') options.success({});
    }
  };

  try {
    await page.startPolling();
    await page.handleGoBack();
    assert.match(visibleUrl, /brainstormMode/,
      '取消 Spy 场次后应打开模式选择，不能被订阅导航留在大厅');
  } finally {
    page.stopPolling();
    global.wx = previousWx;
    global.getCurrentPages = previousGetCurrentPages;
    delete app.globalData.roomSession;
  }
});
