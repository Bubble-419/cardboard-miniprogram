'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const actor = { userId: 'host', touchPresence: true, deviceSessionId: 'parallel-device' };
const rename = { protocolVersion: 3, commandId: 'parallel-rename', roomId: '12345678',
  knownSeq: 0, type: 'UPDATE_ROOM_PROFILE', context: {}, payload: { workshopName: '并行房间' } };

function observe(promise) {
  const state = { settled: false };
  state.result = promise.then(
    (value) => { state.settled = true; return { value }; },
    (error) => { state.settled = true; return { error }; }
  );
  return state;
}

for (const first of ['presence', 'sync']) {
  test(`Command 提交后并行续租与 Sync：${first} 先完成仍等待另一项，并合并本次在线状态`, async () => {
    const h = createHarness();
    await h.seedMembers(2);
    const presence = deferred();
    const sync = deferred();
    const started = [];
    const upsert = h.repo.upsertPresence.bind(h.repo);
    const readSync = h.repo.readSyncState.bind(h.repo);
    h.repo.upsertPresence = async (input) => {
      assert.equal(h.repo.rooms.get('12345678').room.workshopName, '并行房间', '只能在事务提交后续租');
      started.push('presence');
      await presence.promise;
      return upsert(input);
    };
    h.repo.readSyncState = async (...args) => {
      started.push('sync');
      await sync.promise;
      return readSync(...args);
    };
    // 模拟列表读取先于续租可见，响应仍应包含本次成功续租的成员。
    h.repo.listPresence = async () => [];
    const request = observe(h.app.executeCommand(rename, actor));
    try {
      await flush();
      assert.deepEqual(started.sort(), ['presence', 'sync']);
      (first === 'presence' ? presence : sync).resolve();
      await flush();
      assert.equal(request.settled, false);
      (first === 'presence' ? sync : presence).resolve();
      const { value: response } = await request.result;
      assert.equal(response.ok, true);
      assert.equal(response.sync.throughSeq, response.outcome.committedThroughSeq);
      const host = h.repo.rooms.get('12345678').room.members.find((member) => member.userId === 'host');
      assert.equal(response.sync.ephemeral.presenceByMemberId[host.memberId].online, true);
      assert.equal(started.filter((stage) => stage === 'presence').length, 1, '借用同一次续租，不重复写');
    } finally {
      presence.resolve();
      sync.resolve();
      await request.result;
    }
  });
}

test('Command 附带同步失败也等待在途续租，仍返回已提交成功且可幂等重放', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const presence = deferred();
  h.repo.upsertPresence = async (input) => { await presence.promise; return input; };
  let syncStarted = false;
  h.repo.readSyncState = async () => { syncStarted = true; throw new Error('sync unavailable'); };
  const request = observe(h.app.executeCommand(rename, actor));
  try {
    await flush();
    assert.equal(syncStarted, true);
    assert.equal(request.settled, false);
    presence.resolve();
    const { value: response } = await request.result;
    assert.equal(response.ok, true);
    assert.equal(response.sync, undefined);
    const replay = await h.app.executeCommand(rename, actor);
    assert.deepEqual(replay.outcome, response.outcome);
    assert.equal(h.repo.events.get('12345678').length, 3);
  } finally {
    presence.resolve();
    await request.result;
  }
});

test('Presence 失败不改变 Command、Sync 与提交水位', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  h.repo.upsertPresence = async () => { throw new Error('presence unavailable'); };
  const response = await h.app.executeCommand(rename, actor);
  assert.equal(response.ok, true);
  assert.equal(response.sync.ok, true);
  assert.equal(response.sync.throughSeq, response.outcome.committedThroughSeq);
});

test('被拒绝 Command 的追赶 Sync 同样与续租并行，不能改变原权限错误', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const presence = deferred();
  let syncStarted = false;
  const read = h.repo.readSyncState.bind(h.repo);
  h.repo.readSyncState = (...args) => { syncStarted = true; return read(...args); };
  h.repo.upsertPresence = async (input) => { await presence.promise; return input; };
  const request = observe(h.app.executeCommand(rename, { ...actor, userId: 'u2' }));
  try {
    await flush();
    assert.equal(syncStarted, true);
    assert.equal(request.settled, false);
    presence.resolve();
    const { value: response } = await request.result;
    assert.equal(response.errCode, 'HOST_REQUIRED');
    assert.equal(response.sync.ok, true);
    assert.equal(h.repo.events.get('12345678').length, 2);
  } finally {
    presence.resolve();
    await request.result;
  }
});

test('创建重放的 Snapshot 与续租并行，借用结果仍按当前成员权限投影', async () => {
  const h = createHarness();
  const command = { protocolVersion: 3, commandId: 'parallel-create', roomId: '', knownSeq: 0,
    type: 'CREATE_ROOM', context: {}, payload: { nickName: '房主' } };
  await h.app.executeCommand(command, { userId: 'host' });
  await h.command('u2', 'JOIN_ROOM', { payload: { nickName: '玩家' } });
  const presence = deferred();
  let snapshotStarted = false;
  const read = h.repo.readAggregate.bind(h.repo);
  h.repo.readAggregate = (...args) => { snapshotStarted = true; return read(...args); };
  h.repo.upsertPresence = async (input) => { await presence.promise; return input; };
  h.repo.listPresence = async () => [];
  const request = observe(h.app.executeCommand(command, actor));
  try {
    await flush();
    assert.equal(snapshotStarted, true);
    assert.equal(request.settled, false);
    presence.resolve();
    const { value: response } = await request.result;
    assert.equal(response.ok, true);
    assert.equal(response.snapshot.view.room.members.length, 2);
    assert.equal(response.snapshot.ephemeral.presenceByMemberId[response.snapshot.view.actor.memberId].online, true);
  } finally {
    presence.resolve();
    await request.result;
  }
});

test('Command 积压超过 25 条改发 Snapshot 时仍并行续租，只写一次并合并成功租约', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  for (let index = 0; index < 26; index += 1) {
    await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: `积压${index}` } });
  }
  const presence = deferred();
  let snapshotStarted = false;
  let writes = 0;
  const read = h.repo.readAggregate.bind(h.repo);
  h.repo.readAggregate = (...args) => { snapshotStarted = true; return read(...args); };
  h.repo.upsertPresence = async (input) => { writes += 1; await presence.promise; return input; };
  h.repo.listPresence = async () => [];
  const request = observe(h.app.executeCommand(rename, actor));
  try {
    await flush();
    assert.equal(snapshotStarted, true);
    assert.equal(request.settled, false);
    presence.resolve();
    const { value: response } = await request.result;
    assert.equal(response.sync.delivery, 'SNAPSHOT');
    assert.equal(response.sync.snapshot.seq, response.outcome.committedThroughSeq);
    const snapshot = response.sync.snapshot;
    assert.equal(snapshot.ephemeral.presenceByMemberId[snapshot.view.actor.memberId].online, true);
    assert.equal(writes, 1);
    assert.deepEqual(snapshot.view, (await h.snapshot('host')).view);
  } finally {
    presence.resolve();
    await request.result;
  }
});

test('借用续租作用域不得把离房前旧 memberId 合入重放的当前 Snapshot', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const join = { protocolVersion: 3, commandId: 'join-old-membership', roomId: '12345678', knownSeq: 0,
    type: 'JOIN_ROOM', context: {}, payload: { nickName: '玩家' } };
  const original = await h.app.executeCommand(join, { userId: 'u2' });
  const oldMemberId = original.snapshot.view.actor.memberId;
  await h.command('u2', 'LEAVE_ROOM');
  await h.command('u2', 'JOIN_ROOM', { payload: { nickName: '再次加入' } });
  h.repo.listPresence = async () => [];
  h.repo.upsertPresence = async (input) => input;
  const replay = await h.app.executeCommand(join, { ...actor, userId: 'u2' });
  assert.equal(replay.ok, true);
  assert.notEqual(replay.snapshot.view.actor.memberId, oldMemberId);
  assert.equal(replay.snapshot.ephemeral.presenceByMemberId[oldMemberId], undefined);
});

async function sessionFixture() {
  const h = createHarness();
  await h.seedMembers(3);
  const started = await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  return { h, sessionId: started.outcome.sessionId };
}

for (const action of ['history', 'messages']) {
  for (const first of ['presence', 'read']) {
    test(`${action} 授权后的分页读取与续租并行：${first} 先完成仍等待另一项`, async () => {
      const { h, sessionId } = await sessionFixture();
      const presence = deferred();
      const read = deferred();
      const started = [];
      h.repo.upsertPresence = async (input) => { started.push('presence'); await presence.promise; return input; };
      const list = async () => { started.push('read'); await read.promise; return []; };
      if (action === 'history') {
        h.repo.readAggregate = async () => { throw new Error('历史列表只需 Room 授权'); };
        h.repo.listSessions = list;
      } else h.repo.listMessages = list;
      const request = observe(action === 'history'
        ? h.app.readHistory('12345678', actor, { limit: 1 })
        : h.app.readMessages('12345678', sessionId, actor, { limit: 1 }));
      try {
        await flush();
        assert.deepEqual(started.sort(), ['presence', 'read']);
        (first === 'presence' ? presence : read).resolve();
        await flush();
        assert.equal(request.settled, false);
        (first === 'presence' ? read : presence).resolve();
        const { value: response, error } = await request.result;
        assert.equal(error, undefined);
        assert.equal(response.ok, true);
        assert.equal(response.hasMore, false);
      } finally {
        presence.resolve();
        read.resolve();
        await request.result;
      }
    });
  }

  test(`${action} 拒绝非成员时不读取分页数据、不续租`, async () => {
    const { h, sessionId } = await sessionFixture();
    const calls = [];
    h.repo.upsertPresence = async () => { calls.push('presence'); };
    h.repo.listSessions = h.repo.listMessages = async () => { calls.push('list'); return []; };
    const result = action === 'history'
      ? await h.app.readHistory('12345678', { ...actor, userId: 'outsider' }, {})
      : await h.app.readMessages('12345678', sessionId, { ...actor, userId: 'outsider' }, {});
    assert.equal(result.errCode, 'NOT_MEMBER');
    assert.deepEqual(calls, []);
  });

  test(`${action} 分页依赖失败仍等待在途续租，保留原读取错误`, async () => {
    const { h, sessionId } = await sessionFixture();
    const presence = deferred();
    const error = new Error('list unavailable');
    h.repo.upsertPresence = async () => { await presence.promise; return null; };
    h.repo.listSessions = h.repo.listMessages = async () => { throw error; };
    const request = observe(action === 'history'
      ? h.app.readHistory('12345678', actor, {})
      : h.app.readMessages('12345678', sessionId, actor, {}));
    try {
      await flush();
      assert.equal(request.settled, false);
      presence.resolve();
      assert.equal((await request.result).error, error);
    } finally {
      presence.resolve();
      await request.result;
    }
  });
}

test('消息分页的非法 cursor 在续租或列表读取前拒绝', async () => {
  const { h, sessionId } = await sessionFixture();
  const calls = [];
  h.repo.upsertPresence = async () => { calls.push('presence'); };
  h.repo.listMessages = async () => { calls.push('list'); return []; };
  assert.equal((await h.app.readMessages('12345678', sessionId, actor, { beforeSeq: -1 })).errCode,
    'INVALID_ARGUMENT');
  assert.deepEqual(calls, []);
});

test('归档消息仍允许离房参与者读取，不为已离房成员续租', async () => {
  const { h, sessionId } = await sessionFixture();
  await h.command('host', 'CANCEL_WORKSHOP_SESSION', { context: { sessionId } });
  await h.command('u2', 'LEAVE_ROOM');
  let touches = 0;
  h.repo.upsertPresence = async () => { touches += 1; };
  const result = await h.app.readMessages('12345678', sessionId, { ...actor, userId: 'u2' }, {});
  assert.equal(result.ok, true);
  assert.equal(touches, 0);
});
