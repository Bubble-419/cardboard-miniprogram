'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');
const { applyProjectedEvent } = require('../../packages/room-projection');

test('旧模式选择的取消与开始命令不能影响新一轮选择，重复命令仍重放回执', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  await h.command('host', 'BEGIN_MODE_SELECTION');
  const old = await h.snapshot('host');
  const context = old.view.navigation.back.context;
  const cancelled = await h.command('host', 'CANCEL_MODE_SELECTION', { context, commandId: 'cancel-first' });
  assert.equal(cancelled.ok, true);
  await h.command('host', 'BEGIN_MODE_SELECTION');
  const current = await h.snapshot('host');
  assert.ok(current.view.room.modeSelectionRevision > old.view.room.modeSelectionRevision);
  for (const type of ['CANCEL_MODE_SELECTION', 'START_WORKSHOP_SESSION']) {
    const delayed = await h.command('host', type, { context, knownSeq: old.seq,
      payload: type === 'START_WORKSHOP_SESSION' ? { mode: 'PARTNER' } : {} });
    assert.equal(delayed.errCode, 'STALE_CONTEXT');
    assert.deepEqual((await h.snapshot('host')).view, current.view);
  }
  const replay = await h.command('host', 'CANCEL_MODE_SELECTION', { context, commandId: 'cancel-first' });
  assert.equal(replay.ok, true);
  assert.deepEqual((await h.snapshot('host')).view, current.view);
});

test('模式选择轮次由连续 Event 与 Snapshot 等价恢复，成员资料更新不使令牌失效', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const before = await h.snapshot('host');
  await h.command('host', 'BEGIN_MODE_SELECTION');
  const opened = await h.snapshot('host');
  await h.command('u2', 'UPDATE_MEMBER_PROFILE', { payload: { nickName: '新昵称' } });
  assert.equal((await h.snapshot('host')).view.room.modeSelectionRevision, opened.view.room.modeSelectionRevision);
  const response = await h.app.sync('12345678', before.seq, { userId: 'host' });
  let reduced = before.view;
  for (const event of response.events) reduced = applyProjectedEvent(reduced, event);
  assert.deepEqual(reduced, (await h.snapshot('host')).view);
  const back = opened.view.navigation.back;
  assert.deepEqual(back.context, { modeSelectionRevision: opened.view.room.modeSelectionRevision });
  assert.equal((await h.command('host', back.commandType, { context: back.context })).ok, true);
});
