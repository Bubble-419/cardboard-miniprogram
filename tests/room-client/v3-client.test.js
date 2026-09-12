'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomClient } = require('@cardboard/room-client');
const { applyEventGroup } = require('@cardboard/room-projection');
const { createHarness } = require('../helpers/room-v3');

function inertTimers() {
  let id = 0;
  return { setTimeoutFn: () => ++id, clearTimeoutFn: () => {} };
}

function manualTimers() {
  let task = null;
  return {
    setTimeoutFn(callback) { task = callback; return 1; },
    clearTimeoutFn() { task = null; },
    async run() {
      const current = task;
      task = null;
      if (current) await current();
    }
  };
}

test('RoomClient 用 Snapshot 打开，并在命令响应中原子消费 Sync', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const gateway = {
    currentRoom: () => h.app.readCurrentRoom({ userId: 'host' }),
    snapshot: (roomId) => h.app.readSnapshot(roomId, { userId: 'host' }),
    sync: (roomId, seq, limit) => h.app.sync(roomId, seq, { userId: 'host' }, { limit }),
    dispatch: (envelope) => h.app.executeCommand(envelope, { userId: 'host' }),
    presence: () => Promise.resolve({ ok: true })
  };
  const client = createRoomClient({ gateway, ...inertTimers(), commandIdFactory: () => 'rename-command' });
  const published = [];
  client.subscribe((view) => { if (view) published.push(view); });
  await client.open();
  assert.equal(client.getState().seq, 2);
  assert.equal(client.getState().stateVersion, 2);
  const result = await client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: '新工作坊' } });
  assert.equal(result.ok, true);
  assert.equal(client.getView().room.workshopName, '新工作坊');
  assert.equal(client.getState().seq, 3);
  assert.equal(client.getState().stateVersion, 3);
  assert.equal(published.at(-1).actor.role, 'HOST');
  client.close();
});

test('Snapshot@N + Event Groups + Actor@M 等于 Snapshot@M', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const before = await h.snapshot('u2');
  await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: '等价性' } });
  await h.command('u2', 'UPDATE_MEMBER_PROFILE', { payload: { nickName: '成员二' }, knownSeq: before.seq });
  const batch = await h.app.sync('12345678', before.seq, { userId: 'u2' });
  let reduced = before.view;
  const groups = [];
  batch.events.forEach((item) => {
    const last = groups.at(-1);
    if (!last || last[0].commandId !== item.commandId) groups.push([item]); else last.push(item);
  });
  groups.forEach((group) => { reduced = applyEventGroup(reduced, group); });
  reduced = { ...reduced, ...batch.actorView };
  const latest = await h.snapshot('u2');
  assert.deepEqual(reduced, latest.view);
});

test('事件缺口触发 Snapshot 恢复，不猜测修补', async () => {
  let snapshotCalls = 0;
  const view = { room: { roomId: '12345678', workshopName: '恢复后' }, session: null,
    actor: { memberId: 'm1' }, route: { name: 'addPlayer', params: {} } };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1, roomId: '12345678',
      seq: snapshotCalls++, stateVersion: snapshotCalls, view, ephemeral: {}, minAvailableSeq: 1 }),
    dispatch: async () => ({ ok: true, outcome: { kind: 'ACCEPTED', roomId: '12345678' }, sync: {
      ok: true, protocolVersion: 3, viewSchemaVersion: 1, eventSchemaVersion: 1,
      afterSeq: 0, throughSeq: 2, roomCurrentSeq: 2, hasMore: false, snapshotRequired: false,
      events: [{ eventSchemaVersion: 1, roomId: '12345678', type: 'ROOM_PROFILE_UPDATED', seq: 2,
        commandId: 'x', commandEventIndex: 1, commandEventCount: 1,
        payload: { publicPatch: { set: {}, remove: [] } } }], actorView: { actor: view.actor, route: view.route }
    } }),
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1, eventSchemaVersion: 1,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 0, hasMore: false,
      snapshotRequired: false, events: [], actorView: { actor: view.actor, route: view.route } })
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  await client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: 'x' } });
  assert.equal(snapshotCalls, 2);
  assert.equal(client.getView().room.workshopName, '恢复后');
});

test('传输超时使用相同 commandId 重试', async () => {
  const sent = [];
  let attempt = 0;
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: null }),
    snapshot: async () => null,
    sync: async () => null,
    dispatch: async (envelope) => {
      sent.push(envelope.commandId);
      if (attempt++ === 0) throw new Error('timeout');
      return { ok: false, errCode: 'ROOM_NOT_FOUND', retryable: false };
    }
  };
  const client = createRoomClient({ gateway, ...inertTimers(), commandIdFactory: () => 'stable-id' });
  await client.open();
  await client.dispatch({ type: 'JOIN_ROOM', roomId: '12345678', payload: { nickName: 'A' } });
  assert.deepEqual(sent, ['stable-id', 'stable-id']);
});

test('同步完成水位矛盾时强制 Snapshot，不发布不完整 View', async () => {
  let snapshotCalls = 0;
  const view = { room: { roomId: '12345678', workshopName: '完整状态' }, session: null,
    actor: { memberId: 'm1' }, route: { name: 'addPlayer', params: {} } };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1,
      roomId: '12345678', seq: snapshotCalls++, stateVersion: snapshotCalls, view, ephemeral: {} }),
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1, eventSchemaVersion: 1,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 2, hasMore: false,
      snapshotRequired: false, events: [], actorView: { actor: view.actor, route: view.route } }),
    dispatch: async () => ({ ok: true, outcome: { kind: 'ACCEPTED' }, sync: {
      ok: true, protocolVersion: 3, viewSchemaVersion: 1, eventSchemaVersion: 1,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 2, hasMore: false,
      snapshotRequired: false, events: [], actorView: { actor: view.actor, route: view.route }
    } })
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  await client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: 'x' } });
  assert.equal(snapshotCalls, 2);
  assert.equal(client.getView().room.workshopName, '完整状态');
});

test('hasMore 却没有事件时强制 Snapshot，避免空批无限追赶', async () => {
  let snapshotCalls = 0;
  const view = { room: { roomId: '12345678' }, session: null,
    actor: { memberId: 'm1' }, route: { name: 'addPlayer', params: {} } };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: 1,
        roomId: '12345678', seq: 0, stateVersion: snapshotCalls, view, ephemeral: {} };
    },
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1, eventSchemaVersion: 1,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 1, hasMore: true,
      snapshotRequired: false, events: [], actorView: null }),
    dispatch: async () => null
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });
  await client.open();
  await timers.run();
  assert.equal(snapshotCalls >= 2, true);
  assert.equal(client.getState().status, 'READY');
});

test('连续事件缺少最终 publicPatch 时也强制 Snapshot', async () => {
  let snapshotCalls = 0;
  const view = { room: { roomId: '12345678', workshopName: '快照权威' }, session: null,
    actor: { memberId: 'm1' }, route: { name: 'addPlayer', params: {} } };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1,
      roomId: '12345678', seq: snapshotCalls++, stateVersion: snapshotCalls, view, ephemeral: {} }),
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1, eventSchemaVersion: 1,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 0, hasMore: false,
      snapshotRequired: false, events: [], actorView: { actor: view.actor, route: view.route } }),
    dispatch: async () => ({ ok: true, outcome: { kind: 'ACCEPTED' }, sync: {
      ok: true, protocolVersion: 3, viewSchemaVersion: 1, eventSchemaVersion: 1,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false,
      snapshotRequired: false,
      events: [{ eventSchemaVersion: 1, roomId: '12345678', type: 'ROOM_PROFILE_UPDATED',
        seq: 1, stateVersion: 1, commandId: 'x', commandEventIndex: 1, commandEventCount: 1,
        payload: {} }],
      actorView: { actor: view.actor, route: view.route }
    } })
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  await client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: 'x' } });
  assert.equal(snapshotCalls, 2);
  assert.equal(client.getView().room.workshopName, '快照权威');
});

test('事件组 stateVersion 不连续时强制 Snapshot', async () => {
  let snapshotCalls = 0;
  const view = { room: { roomId: '12345678', workshopName: '权威快照' }, session: null,
    actor: { memberId: 'm1' }, route: { name: 'addPlayer', params: {} } };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: 1,
        roomId: '12345678', seq: 0, stateVersion: 4, view, ephemeral: {} };
    },
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1, eventSchemaVersion: 1,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false,
      snapshotRequired: false,
      events: [{ eventSchemaVersion: 1, roomId: '12345678', type: 'ROOM_PROFILE_UPDATED',
        seq: 1, stateVersion: 7, commandId: 'broken-version', commandEventIndex: 1,
        commandEventCount: 1, payload: { publicPatch: { set: {}, remove: [] } } }],
      actorView: { actor: view.actor, route: view.route }
    }),
    dispatch: async () => null
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });
  await client.open();
  await timers.run();
  assert.equal(snapshotCalls, 2);
  assert.equal(client.getState().stateVersion, 4);
});

test('从后台恢复时立即重新读取 Snapshot', async () => {
  let snapshotCalls = 0;
  const makeView = () => ({ room: { roomId: '12345678', workshopName: `快照${snapshotCalls}` },
    session: null, actor: { memberId: 'm1' }, route: { name: 'addPlayer', params: {} } });
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: 1,
        roomId: '12345678', seq: snapshotCalls, stateVersion: snapshotCalls,
        view: makeView(), ephemeral: {} };
    },
    sync: async () => null,
    dispatch: async () => null
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  client.pause();
  await client.resume();
  assert.equal(snapshotCalls, 2);
  assert.equal(client.getView().room.workshopName, '快照2');
});

test('首次 current-room 暂时失败时自动退避重试', async () => {
  let calls = 0;
  const timers = manualTimers();
  const gateway = {
    currentRoom: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('temporary'), { code: 'DEPENDENCY_UNAVAILABLE' });
      return { ok: true, roomId: null };
    },
    snapshot: async () => null,
    sync: async () => null,
    dispatch: async () => null
  };
  const client = createRoomClient({ gateway, ...timers, intervalMs: 1000 });
  await client.open();
  assert.equal(client.getState().status, 'DEGRADED');
  await timers.run();
  assert.equal(calls, 2);
  assert.equal(client.getState().status, 'READY');
});

test('归档场次查询可显式指定房间且不依赖当前活跃连接', async () => {
  const calls = [];
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: null }),
    snapshot: async () => null,
    sync: async () => null,
    dispatch: async () => null,
    session: async (roomId, sessionId) => {
      calls.push({ roomId, sessionId });
      return { ok: true, roomId, sessionId };
    }
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  const result = await client.sessionSnapshot('session-1', '87654321');
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ roomId: '87654321', sessionId: 'session-1' }]);
  assert.equal(client.getState().roomId, null, '只读历史查询不能篡改当前连接');
});

test('手动 refresh 遇到终态成员错误时立即断开并发布错误状态', async () => {
  let snapshotCalls = 0;
  const view = { room: { roomId: '12345678' }, session: null,
    actor: { memberId: 'm1' }, route: { name: 'addPlayer', params: {} } };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      if (snapshotCalls > 1) return { ok: false, errCode: 'NOT_MEMBER', errMsg: '已被移出' };
      return { ok: true, protocolVersion: 3, viewSchemaVersion: 1,
        roomId: '12345678', seq: 1, stateVersion: 1, view, ephemeral: {} };
    },
    sync: async () => null,
    dispatch: async () => null
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  await client.refresh();
  assert.equal(client.getState().status, 'DISCONNECTED');
  assert.equal(client.getState().roomId, null);
  assert.equal(client.getState().error.errCode, 'NOT_MEMBER');
});
