'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadPageDefinition(modulePath) {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: { roomId: '12345678' } });
  global.wx = { showToast() {} };
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  require(resolved);
  delete require.cache[resolved];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition, data = {}) {
  const page = {
    ...definition,
    data: { ...definition.data, ...data },
    setData(patch) { Object.assign(this.data, patch); }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key].bind(page);
  });
  return page;
}

function editableSnapshot() {
  return {
    ok: true,
    isHost: true,
    members: [{ memberId: 'm1', playerIndex: 1, nickName: '房主', isMe: true }],
    view: {
      actor: {
        memberId: 'm1',
        contributionStatus: { submitted: true, text: '原创意' },
        capabilities: {
          REOPEN_HALLI_IDEA: { allowed: true, reason: null },
          SUBMIT_HALLI_IDEA: { allowed: true, reason: null },
          COMPLETE_HALLI_SESSION: { allowed: false, reason: 'INVALID_TRANSITION' }
        }
      },
      session: {
        status: 'RUNNING',
        participants: [{ memberId: 'm1', seatNoAtStart: 1, status: 'ACTIVE' }],
        progress: { contributionProgress: { submittedCount: 1, requiredCount: 1 } },
        publicModeState: { ideas: [{ memberId: 'm1', text: '原创意' }], revisingCount: 1 }
      }
    }
  };
}

test('Halli 汇总页提供修改入口，有人修改时不允许房主完成场次', () => {
  const definition = loadPageDefinition('../../pages/main-pages/creativeSummary/index');
  const page = makePage(definition, { roomId: '12345678' });
  const snapshot = editableSnapshot();
  page._applySummary(snapshot, snapshot.members);

  assert.equal(page.data.canEditIdea, true);
  assert.equal(page.data.canRestartRound, false);
  const wxml = fs.readFileSync(path.resolve(__dirname,
    '../../pages/main-pages/creativeSummary/index.wxml'), 'utf8');
  assert.match(wxml, /bindtap="handleEditIdea"/);
});

test('Halli 修改页从 Actor View 完整恢复原创意和编辑态', () => {
  const definition = loadPageDefinition('../../pages/main-pages/creativeInput/index');
  const page = makePage(definition, { roomId: '12345678' });
  const snapshot = editableSnapshot();
  page._applySnapshot(snapshot);

  assert.equal(page.data.ideaText, '原创意');
  assert.equal(page.data.submitted, true);
  assert.equal(page.data.editing, true);
});
