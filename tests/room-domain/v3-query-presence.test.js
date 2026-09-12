'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');

test('Snapshot 是可独立恢复的成员视图且不暴露 userId', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const before = h.repo.rooms.get('12345678').room.stateVersion;
  const snapshot = await h.snapshot('u2');
  assert.equal(snapshot.seq, 2);
  assert.equal(snapshot.stateVersion, 2);
  assert.equal(snapshot.view.actor.role, 'PLAYER');
  assert.equal(JSON.stringify(snapshot.view).includes('"userId"'), false);
  assert.equal(h.repo.rooms.get('12345678').room.stateVersion, before);
  assert.equal((await h.snapshot('stranger')).errCode, 'NOT_MEMBER');
});

test('Presence 不改变业务水位，只进入 ephemeral', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const before = await h.snapshot('host');
  const beat = await h.app.heartbeat('12345678', { userId: 'u2' }, { deviceSessionId: 'd1' });
  assert.equal(beat.ok, true);
  const after = await h.snapshot('host');
  assert.equal(after.seq, before.seq);
  assert.equal(after.stateVersion, before.stateVersion);
  assert.equal(after.ephemeral.presenceByMemberId[beat.presence.memberId].online, true);
});

test('Sync 返回连续完整事件组；过期与越界水位要求 Snapshot', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const batch = await h.app.sync('12345678', 0, { userId: 'host' });
  assert.deepEqual(batch.events.map((item) => item.seq), [1, 2]);
  assert.equal(batch.throughSeq, 2);
  assert.ok(batch.actorView.actor);
  h.repo.rooms.get('12345678').room.minAvailableSeq = 2;
  assert.equal((await h.app.sync('12345678', 0, { userId: 'host' })).snapshotRequired, true);
  assert.equal((await h.app.sync('12345678', 999, { userId: 'host' })).snapshotRequired, true);
});
