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
          SUBMIT_HALLI_IDEA: { allowed: false, reason: 'INVALID_TRANSITION' },
          COMPLETE_HALLI_SESSION: { allowed: false, reason: 'INVALID_TRANSITION' }
        }
      },
      session: {
        status: 'RUNNING',
        participants: [{ memberId: 'm1', seatNoAtStart: 1, status: 'ACTIVE' }],
        progress: { contributionProgress: { submittedCount: 1, requiredCount: 1 } },
        publicModeState: { ideas: [{ memberId: 'm1', text: '原创意' }], revisingCount: 0 }
      }
    }
  };
}

function revisingSnapshot() {
  const snapshot = editableSnapshot();
  snapshot.view.actor.capabilities.REOPEN_HALLI_IDEA = { allowed: false, reason: 'INVALID_TRANSITION' };
  snapshot.view.actor.capabilities.SUBMIT_HALLI_IDEA = { allowed: true, reason: null };
  snapshot.view.session.publicModeState.revisingCount = 1;
  return snapshot;
}

test('Halli 汇总页提供原地修改入口，有人修改时不允许房主完成场次', () => {
  const definition = loadPageDefinition('../../pages/main-pages/creativeSummary/index');
  const page = makePage(definition, { roomId: '12345678' });
  const snapshot = editableSnapshot();
  page._applySummary(snapshot, snapshot.members);

  assert.equal(page.data.canEditIdea, true);
  assert.equal(page.data.editing, false);
  assert.equal(page.data.canRestartRound, false);
  const wxml = fs.readFileSync(path.resolve(__dirname,
    '../../pages/main-pages/creativeSummary/index.wxml'), 'utf8');
  assert.match(wxml, /catchtap="handleEditIdea"/);
  assert.match(wxml, /catchtap="handleSaveIdea"/);
  assert.match(wxml, /icon-problem-arrow\.svg/);
  assert.match(wxml, /icon-problem-confirm\.svg/);
  assert.doesNotMatch(wxml, /修改我的创意/);
  assert.match(wxml, /item\.isMe && canEditIdea/);
  assert.match(wxml, /footer" wx:if="\{\{isHost\}\}"/);
});

test('非房主进入汇总页同样可原地修改本人创意', () => {
  const definition = loadPageDefinition('../../pages/main-pages/creativeSummary/index');
  const page = makePage(definition, { roomId: '12345678', isHost: false });
  const snapshot = editableSnapshot();
  snapshot.isHost = false;
  snapshot.members = [{ memberId: 'm2', playerIndex: 2, nickName: '玩家2', isMe: true }];
  snapshot.view.actor.memberId = 'm2';
  snapshot.view.actor.contributionStatus = { submitted: true, text: '副屏创意' };
  snapshot.view.session.participants = [{ memberId: 'm2', seatNoAtStart: 2, status: 'ACTIVE' }];
  snapshot.view.session.publicModeState = {
    ideas: [{ memberId: 'm2', text: '副屏创意' }],
    revisingCount: 0
  };
  page._applySummary(snapshot, snapshot.members);

  assert.equal(page.data.isHost, false);
  assert.equal(page.data.canEditIdea, true);
  assert.equal(page.data.summaryList[0].isMe, true);
  assert.equal(page.data.summaryList[0].ideaText, '副屏创意');
});

test('断线恢复时汇总页从 Actor View 原地还原编辑态', () => {
  const definition = loadPageDefinition('../../pages/main-pages/creativeSummary/index');
  const page = makePage(definition, { roomId: '12345678' });
  page._applySummary(revisingSnapshot(), revisingSnapshot().members);

  assert.equal(page.data.editing, true);
  assert.equal(page.data.editDraft, '原创意');
  assert.equal(page.data.canEditIdea, false);
});
