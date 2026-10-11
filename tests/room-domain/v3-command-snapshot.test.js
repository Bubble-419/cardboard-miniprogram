'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');

test('创建与加入附带提交后的成员 Snapshot，不再重读 Aggregate', async () => {
  const h = createHarness();
  let aggregateReads = 0;
  const read = h.repo.readAggregate.bind(h.repo);
  h.repo.readAggregate = (...args) => { aggregateReads += 1; return read(...args); };
  for (const [user, type] of [['host', 'CREATE_ROOM'], ['u2', 'JOIN_ROOM']]) {
    const response = await h.command(user, type, { payload: { nickName: user } });
    assert.equal(response.ok, true);
    assert.equal(response.snapshot?.ok, true);
    assert.equal(response.snapshot.seq, response.outcome.committedThroughSeq);
    assert.equal(aggregateReads, 0);
    const latest = await h.snapshot(user);
    assert.deepEqual(response.snapshot.view, latest.view);
    assert.equal(response.snapshot.stateVersion, latest.stateVersion);
    aggregateReads = 0;
  }
  for (const receipt of h.repo.actions.values()) {
    assert.equal(receipt.snapshot, undefined, '幂等回执不保存可能过时的私有 View');
    assert.equal(receipt.aggregate, undefined);
  }
});

test('重放创建命令返回当前 Snapshot，而不是创建时的旧 View', async () => {
  const h = createHarness();
  const fields = { commandId: 'create-replay', payload: { nickName: 'host' } };
  const created = await h.command('host', 'CREATE_ROOM', fields);
  await h.command('u2', 'JOIN_ROOM', { payload: { nickName: 'u2' } });
  await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: '更新后的房间' } });
  const replay = await h.command('host', 'CREATE_ROOM', fields);
  assert.deepEqual(replay.outcome, created.outcome);
  assert.deepEqual(replay.snapshot?.view, (await h.snapshot('host')).view);
  assert.ok(replay.snapshot.seq > created.snapshot.seq);
});

test('Snapshot 附带失败不改变已经提交的创建结果', async () => {
  const h = createHarness();
  const fields = { commandId: 'create-with-read-failure', payload: { nickName: 'host' } };
  await h.command('host', 'CREATE_ROOM', fields);
  h.repo.readAggregate = async () => { throw new Error('database unavailable'); };
  const replay = await h.command('host', 'CREATE_ROOM', fields);
  assert.equal(replay.ok, true);
  assert.equal(replay.snapshot, undefined);
});

test('Spy 运行期创建重放及中途加入的 Snapshot 仍按调用者投影秘密', async () => {
  const h = createHarness();
  const fields = { commandId: 'spy-create', payload: { nickName: '房主' } };
  await h.command('host', 'CREATE_ROOM', fields);
  await h.command('u2', 'JOIN_ROOM', { payload: { nickName: 'u2' } });
  await h.command('u3', 'JOIN_ROOM', { payload: { nickName: 'u3' } });
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'SPY' } });
  const sessionId = (await h.snapshot('host')).view.session.sessionId;
  assert.equal((await h.command('host', 'START_SPY_GAME', { context: { sessionId } })).ok, true);
  const replay = await h.command('host', 'CREATE_ROOM', fields);
  assert.deepEqual(replay.snapshot.view, (await h.snapshot('host')).view);
  const joined = await h.command('u4', 'JOIN_ROOM', { payload: { nickName: 'u4' } });
  assert.equal(joined.ok, true);
  assert.deepEqual(joined.snapshot.view, (await h.snapshot('u4')).view);
  assert.equal(joined.snapshot.view.actor.isParticipant, false);
  assert.equal(joined.snapshot.view.actor.privateModeState, null);
  assert.equal(joined.snapshot.view.route.name, 'addPlayer');
});

test('解散成功后不再写入无意义的在线心跳', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  let writes = 0;
  h.repo.upsertPresence = async () => { writes += 1; };
  const response = await h.app.executeCommand({ protocolVersion: 3, commandId: 'dissolve-presence',
    roomId: '12345678', knownSeq: 2, type: 'DISSOLVE_ROOM', context: {}, payload: {} },
  { userId: 'host', touchPresence: true, deviceSessionId: 'test-device' });
  assert.equal(response.ok, true);
  assert.equal(writes, 0);
});

test('二维码授权只读取 Room，校验成员和生命周期，不加载私有场次', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  h.repo.readAggregate = async () => { throw new Error('二维码不应加载 Aggregate'); };
  assert.deepEqual(await h.app.readRoomAccess('12345678', { userId: 'host' }),
    { ok: true, role: 'HOST' });
  assert.deepEqual(await h.app.readRoomAccess('12345678', { userId: 'u2' }),
    { ok: true, role: 'MEMBER' });
  assert.equal((await h.app.readRoomAccess('12345678', { userId: 'outsider' })).errCode, 'NOT_MEMBER');
  assert.equal((await h.app.readRoomAccess('12345678', {})).errCode, 'UNAUTHENTICATED');
  assert.equal((await h.app.readRoomAccess('x', { userId: 'host' })).errCode, 'INVALID_ARGUMENT');
  await h.command('host', 'DISSOLVE_ROOM');
  assert.equal((await h.app.readRoomAccess('12345678', { userId: 'host' })).errCode, 'ROOM_DISSOLVED');
});
