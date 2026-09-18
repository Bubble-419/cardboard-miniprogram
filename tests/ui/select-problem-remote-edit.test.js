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
    setData(patch) {
      Object.assign(this.data, patch);
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
    workflowRevision: 7,
    isHost: true
  });
  page._pageAlive = true;

  await page._syncEditingProblemId('problem-1');
  await page._syncEditingProblemId('');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'roomSignal');
  assert.equal(calls[0].data.signalType, 'DESIGN_PROBLEM_EDITING');
  assert.equal(calls[0].data.sessionId, 'session-1');
  assert.equal(calls[0].data.workflowRevision, 7);
  assert.equal(calls[0].data.value, 'problem-1');
  assert.equal(calls[1].data.value, '');
  page._stopEditingHeartbeat();
});

test('编辑心跳与清空按调用顺序串行发送', async () => {
  const calls = [];
  let releaseFirst;
  global.wx = {
    showToast() {},
    cloud: {
      callFunction(request) {
        calls.push(request);
        if (calls.length === 1) {
          return new Promise((resolve) => { releaseFirst = () => resolve({ result: { ok: true } }); });
        }
        return Promise.resolve({ result: { ok: true } });
      }
    }
  };
  const definition = loadPageDefinition('../../pages/main-pages/selectProblem/index');
  const page = makePage(definition, {
    roomId: '12345678', sessionId: 'session-1', workflowRevision: 7, isHost: true
  });

  const heartbeat = page._syncEditingProblemId('problem-1');
  const clear = page._syncEditingProblemId('');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);

  releaseFirst();
  await Promise.all([heartbeat, clear]);
  assert.deepEqual(calls.map((item) => item.data.value), ['problem-1', '']);
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
        workflow: { step: 'SELECT_DESIGN_PROBLEM', revision: 7 },
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
