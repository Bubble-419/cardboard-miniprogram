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
  const result = await client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: '新工作坊' } });
  assert.equal(result.ok, true);
  assert.equal(client.getView().room.workshopName, '新工作坊');
  assert.equal(client.getState().seq, 3);
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
      ok: true, afterSeq: 0, throughSeq: 2, roomCurrentSeq: 2, hasMore: false, snapshotRequired: false,
      events: [{ eventSchemaVersion: 1, seq: 2, commandId: 'x', commandEventIndex: 1, commandEventCount: 1,
        payload: { publicPatch: { set: {}, remove: [] } } }], actorView: { actor: view.actor, route: view.route }
    } }),
    sync: async () => ({ ok: true, afterSeq: 0, throughSeq: 0, roomCurrentSeq: 0, hasMore: false,
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
