'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const app = {
  globalData: {
    roomId: '12345678',
    gameMode: 'partner',
    roomSession: {
      getRequestContext: () => ({ deviceSessionId: 'device-1', touchPresence: false })
    }
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
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (typeof callback === 'function') callback();
    }
  };
}

test('房主进入或结束编辑会发布 DESIGN_PROBLEM_EDITING 信号', async () => {
  const calls = [];
  global.wx = {
    showToast() {},
    cloud: {
      async callFunction(request) {
        calls.push(request);
        return { result: { ok: true } };
      }
    }
  };
  const definition = loadPageDefinition('../../pages/main-pages/selectProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    sessionId: 'session-1',
    isHost: true
  });
  page._pageAlive = true;

  await page._syncEditingProblemId('problem-1', { notify: true });
  await page._syncEditingProblemId('');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'roomSignal');
  assert.equal(calls[0].data.signalType, 'DESIGN_PROBLEM_EDITING');
  assert.equal(calls[0].data.sessionId, 'session-1');
  assert.equal(calls[0].data.value, 'problem-1');
  assert.equal(calls[1].data.value, '');
  page._stopEditingHeartbeat();
});

test('编辑态写入失败时会提示，不能把云函数错误当成成功', async () => {
  const toasts = [];
  global.wx = {
    showToast(options) { toasts.push(options); },
    cloud: {
      async callFunction() {
        return { result: { ok: false, errMsg: '未知瞬时信号' } };
      }
    }
  };
  const definition = loadPageDefinition('../../pages/main-pages/selectProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    sessionId: 'session-1',
    isHost: true
  });
  page._pageAlive = true;
  await page._syncEditingProblemId('problem-1', { notify: true });
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, '未知瞬时信号');
});

test('非房主从 Page Model 看到问题列表和房主编辑中标记', async () => {
  global.wx = { showToast() {} };
  const definition = loadPageDefinition('../../pages/main-pages/selectProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    isHost: false,
    myPlayerIndex: 2
  });
  page._pageAlive = true;
  page._syncCategoriesFromBG = () => {};

  await page._applyRoomSnapshot({
    ok: true,
    isHost: false,
    workshopName: '脑暴工作坊',
    members: [
      { memberId: 'member-host', playerIndex: 1, nickName: '房主' },
      { memberId: 'member-2', playerIndex: 2, nickName: '玩家2', isMe: true }
    ],
    selectedBG: null,
    roomState: { editingProblemId: 'p2' },
    view: {
      session: {
        sessionId: 'session-1',
        setup: {
          designProblems: [
            { contributionId: 'p1', memberId: 'member-host', text: '问题 A', entityVersion: 1 },
            { contributionId: 'p2', memberId: 'member-2', text: '问题 B', entityVersion: 1 }
          ]
        }
      }
    }
  });

  assert.equal(page.data.isHost, false);
  assert.equal(page.data.sessionId, 'session-1');
  assert.equal(page.data.remoteEditingProblemId, 'p2');
  assert.equal(page.data.problems.length, 2);
  assert.equal(page.data.problems[0].text, '问题 A');
  assert.equal(page.data.problems[1].isMine, true);
  assert.equal(page.data.problems.some((item) => item.selected), false);
});

test('非房主也可从 ephemeral 信号还原房主编辑中', async () => {
  global.wx = { showToast() {} };
  const definition = loadPageDefinition('../../pages/main-pages/selectProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    isHost: false,
    myPlayerIndex: 2
  });
  page._pageAlive = true;
  page._syncCategoriesFromBG = () => {};

  await page._applyRoomSnapshot({
    ok: true,
    isHost: false,
    workshopName: '脑暴工作坊',
    members: [
      { memberId: 'member-host', playerIndex: 1, nickName: '房主' },
      { memberId: 'member-2', playerIndex: 2, nickName: '玩家2', isMe: true }
    ],
    selectedBG: null,
    roomState: { editingProblemId: '' },
    ephemeral: {
      signals: {
        DESIGN_PROBLEM_EDITING: { value: 'p1', sessionId: 'session-1' }
      }
    },
    view: {
      session: {
        sessionId: 'session-1',
        setup: {
          designProblems: [
            { contributionId: 'p1', memberId: 'member-host', text: '问题 A', entityVersion: 1 }
          ]
        }
      }
    }
  });

  assert.equal(page.data.remoteEditingProblemId, 'p1');
});

test('房主页没有 data.sessionId 时仍可从 RoomClient 取当前场次再广播', async () => {
  const calls = [];
  global.wx = {
    showToast() {},
    cloud: {
      async callFunction(request) {
        calls.push(request);
        return { result: { ok: true } };
      }
    }
  };
  const app = global.getApp();
  const previousSession = app.globalData.roomSession;
  app.globalData.roomSession = {
    getRequestContext: () => ({ deviceSessionId: 'device-1', touchPresence: false }),
    getView: () => ({ session: { sessionId: 'session-from-client' } })
  };
  const definition = loadPageDefinition('../../pages/main-pages/selectProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    sessionId: '',
    isHost: true
  });
  page._pageAlive = true;
  await page._syncEditingProblemId('problem-1', { notify: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.sessionId, 'session-from-client');
  assert.equal(calls[0].data.value, 'problem-1');
  app.globalData.roomSession = previousSession;
});

test('刚进入编辑时的误发 blur 不会清掉房主编辑中信号', async () => {
  const calls = [];
  global.wx = {
    showToast() {},
    cloud: {
      async callFunction(request) {
        calls.push(request);
        return { result: { ok: true } };
      }
    }
  };
  const definition = loadPageDefinition('../../pages/main-pages/selectProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    sessionId: 'session-1',
    isHost: true,
    editingProblemId: 'problem-1',
    problems: [{ id: 'problem-1', text: '如何让协作更顺畅？' }]
  });
  page._pageAlive = true;
  page._editingGuardUntil = Date.now() + 800;
  await page.onProblemBlur({
    currentTarget: { dataset: { id: 'problem-1' } },
    detail: { value: '如何让协作更顺畅？' }
  });
  assert.equal(calls.length, 0);
  assert.equal(page.data.editingProblemId, 'problem-1');
});

test('textarea 真正 focus 后会再次发布编辑中信号', async () => {
  const calls = [];
  global.wx = {
    showToast() {},
    cloud: {
      async callFunction(request) {
        calls.push(request);
        return { result: { ok: true } };
      }
    }
  };
  const definition = loadPageDefinition('../../pages/main-pages/selectProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    sessionId: 'session-1',
    isHost: true,
    editingProblemId: 'problem-1'
  });
  page._pageAlive = true;
  page.onProblemFocus({ currentTarget: { dataset: { id: 'problem-1' } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.value, 'problem-1');
  page._stopEditingHeartbeat();
});
