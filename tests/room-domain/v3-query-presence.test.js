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

test('完成场次可从历史分页发现，并在返回大厅后由 View 完整还原', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', { context: { sessionId }, payload: { source: 'OFFLINE' } });
  snapshot = await h.snapshot('host');
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId }, payload: { memberId: snapshot.view.actor.memberId }
  });
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'A' } });
  await h.command('u2', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'B' } });
  await h.command('host', 'COMPLETE_HALLI_SESSION', { context: { sessionId } });

  const history = await h.app.readHistory('12345678', { userId: 'host' }, { limit: 10 });
  assert.equal(history.ok, true);
  assert.deepEqual(history.sessions.map((item) => item.sessionId), [sessionId]);

  await h.command('host', 'RETURN_TO_LOBBY', { context: { sessionId } });
  assert.equal((await h.snapshot('host')).view.session, null);
  const archived = await h.app.readSessionSnapshot('12345678', sessionId, { userId: 'host' });
  assert.equal(archived.ok, true);
  assert.equal(archived.view.session.status, 'COMPLETED');
  assert.deepEqual(archived.view.session.publicModeState.ideas.map((item) => item.text), ['A', 'B']);
});
