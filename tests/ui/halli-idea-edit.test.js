'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('../helpers/room-v3');
const { dispatchRoomCommand } = require('../../modules/room-session/index');

// 仅替换微信云调用这个外部入口，Command、Event、Snapshot、RoomClient 与订阅均走真实实现。
async function openSummaryPage(t, options = {}) {
  const h = createHarness();
  await h.seedMembers(2);
  const mode = options.mode || 'HALLI_GALLI';
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode } });
  const snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  if (mode === 'HALLI_GALLI') {
    await h.command('host', 'SET_SCENARIO', {
      context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
    });
  }
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: snapshot.view.actor.memberId }
  });
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: '原创意' } });
  await h.command('u2', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: '其他创意' } });

  const definition = loadPageDefinition('../../pages/main-pages/creativeSummary/index');
  const page = makePage(definition, { roomId: '12345678' });
  const previous = { getApp: global.getApp, wx: global.wx, getCurrentPages: global.getCurrentPages };
  const app = { globalData: { roomId: '12345678' } };
  const toasts = [];
  global.getApp = () => app;
  global.getCurrentPages = () => [{ route: 'pages/main-pages/creativeSummary/index', data: page.data }];
  global.wx = {
    showToast(value) { toasts.push(value); },
    cloud: {
      async callFunction({ name, data }) {
        let result;
        if (name === 'roomCommand') {
          const intercepted = options.beforeCommand && await options.beforeCommand(data.command);
          result = intercepted || await h.app.executeCommand(data.command, { userId: 'host' });
        } else if (data.action === 'current') {
          result = await h.app.readCurrentRoom({ userId: 'host' });
        } else if (data.action === 'snapshot') {
          result = await h.snapshot('host');
        } else if (data.action === 'sync') {
          result = await h.app.sync(data.roomId, data.afterSeq, { userId: 'host' });
        } else {
          throw new Error(`未预期的云调用 ${name}/${data.action}`);
        }
        return { result };
      }
    }
  };
  t.after(() => {
    page.onUnload();
    if (app.globalData.roomSession) app.globalData.roomSession.dispose();
    Object.assign(global, previous);
  });
  await page.loadData('12345678');
  await new Promise((resolve) => setImmediate(resolve));
  const session = app.globalData.roomSession;
  return { h, page, session, sessionId, toasts };
}

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

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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

for (const mode of ['HALLI_GALLI', 'GAN_DENG_YAN']) {
  test(`${mode}: 汇总页仅更新成员头像时，Event 和 Snapshot 都刷新对应创意条`, async (t) => {
    const { h, page, session } = await openSummaryPage(t, { mode });
    const eventAvatar = 'https://example.com/first.png';
    const result = await dispatchRoomCommand('UPDATE_MEMBER_PROFILE', { avatarRef: eventAvatar });
    assert.equal(result.ok, true, result.errMsg);
    assert.equal(page.data.summaryList.find((item) => item.isMe).avatar, eventAvatar,
      '资料 Event 不改变创意文字时也必须刷新头像');

    const snapshotAvatar = 'https://example.com/second.png';
    await h.command('host', 'UPDATE_MEMBER_PROFILE', { payload: { avatarRef: snapshotAvatar } });
    await session.refresh();
    assert.equal(page.data.summaryList.find((item) => item.isMe).avatar, snapshotAvatar,
      '跳过 Event、直接安装最新 Snapshot 时也应刷新头像');
  });

  test(`${mode}: 汇总页在文本中间输入后，资料 Event 和 Snapshot 不移动光标或覆盖草稿`, async (t) => {
    const { page, session } = await openSummaryPage(t, { mode });
    await page.handleEditIdea();
    page.onIdeaInput({ detail: { value: 'ABCD', cursor: 2 } });
    await dispatchRoomCommand('UPDATE_MEMBER_PROFILE', { nickName: '新昵称' });

    assert.equal(page.data.editDraft, 'ABCD');
    assert.equal(page.data.editingCursor, 2, '同步不能把中间的光标重置到末尾');
    await session.refresh();
    assert.equal(page.data.editDraft, 'ABCD');
    assert.equal(page.data.editingCursor, 2, 'Snapshot 替换也不能改变本地光标');
    assert.equal(page.data.editing, true);
  });

  test(`${mode}: 失焦自动保存也锁定编辑，阻止在途旧保存清空重新输入的草稿`, async (t) => {
    const started = deferred();
    const response = deferred();
    const { h, page } = await openSummaryPage(t, {
      mode,
      beforeCommand: async (command) => {
        if (command.type !== 'SUBMIT_HALLI_IDEA') return;
        started.resolve();
        await response.promise;
      }
    });
    await page.handleEditIdea();
    page.onIdeaInput({ detail: { value: '失焦时的完整草稿', cursor: 3 } });
    const saving = page.onIdeaBlur({ detail: { value: '失焦时的完整草稿' } });
    try {
      await started.promise;
      assert.equal(page.data.interactionLocked, true, '自动保存必须与按钮保存共用排他交互');
      page.onIdeaInput({ detail: { value: '在途时不应能重新编辑', cursor: 2 } });
      await page.handleEditIdea();
      await page.handleSaveIdea();
      assert.equal(page.data.editDraft, '失焦时的完整草稿');
    } finally {
      response.resolve();
      await saving;
    }

    assert.equal(page.data.interactionLocked, false);
    assert.equal(page.data.editing, false);
    assert.equal((await h.snapshot('host')).view.actor.contributionStatus.text, '失焦时的完整草稿');
    await page.handleEditIdea();
    page.onIdeaInput({ detail: { value: '保存结束后的新草稿', cursor: 2 } });
    assert.equal(page.data.editDraft, '保存结束后的新草稿');
  });
}

test('自动保存网络失败后保留草稿并释放锁，可以用确认按钮重试', async (t) => {
  let failSave = true;
  const { h, page, toasts } = await openSummaryPage(t, {
    beforeCommand: (command) => {
      if (command.type === 'SUBMIT_HALLI_IDEA' && failSave) throw new Error('测试断网');
    }
  });
  await page.handleEditIdea();
  page.onIdeaInput({ detail: { value: '断网仍保留', cursor: 2 } });
  await page.onIdeaBlur({ detail: { value: '断网仍保留' } });

  assert.equal(page.data.interactionLocked, false);
  assert.equal(page.data.editing, true);
  assert.equal(page.data.editDraft, '断网仍保留');
  assert.equal(page.data.editingCursor, 2);
  assert.equal(toasts.at(-1).title, '保存失败，请重试');
  failSave = false;
  await page.handleSaveIdea();
  assert.equal(page.data.editing, false);
  assert.equal((await h.snapshot('host')).view.actor.contributionStatus.text, '断网仍保留');
});

test('创意保存完成前页面卸载，迟到响应不再刷新已销毁的编辑器', async (t) => {
  const started = deferred();
  const response = deferred();
  const { page } = await openSummaryPage(t, {
    beforeCommand: async (command) => {
      if (command.type !== 'SUBMIT_HALLI_IDEA') return;
      started.resolve();
      await response.promise;
    }
  });
  await page.handleEditIdea();
  page.onIdeaInput({ detail: { value: '离页前的草稿', cursor: 3 } });
  const saving = page.onIdeaBlur({ detail: { value: '离页前的草稿' } });
  await started.promise;
  page.onUnload();
  const writes = [];
  page.setData = (patch) => {
    const businessKeys = Object.keys(patch).filter((key) => !key.startsWith('interaction'));
    writes.push(...businessKeys);
  };
  response.resolve();
  await saving;
  assert.deepEqual(writes, [], '原生页面销毁后不能再安装旧保存结果');
});
