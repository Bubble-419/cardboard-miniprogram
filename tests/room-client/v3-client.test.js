'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomClient, createCloudRoomGateway } = require('@cardboard/room-client');
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

test('Cloud gateway keeps room commands isolated from injected event metadata', async () => {
  let request = null;
  const gateway = createCloudRoomGateway({
    callFunction: async (input) => {
      request = input;
      return { result: { ok: true } };
    }
  });
  const command = {
    protocolVersion: 3,
    commandId: 'create-room-1',
    roomId: '',
    knownSeq: 0,
    type: 'CREATE_ROOM',
    context: {},
    payload: { nickName: '房主' },
    clientSentAt: 1
  };

  await gateway.dispatch(command);

  assert.deepEqual(request, {
    name: 'roomCommand',
    data: { command }
  });
});

test('CloudBase 注入 tcbContext 时仍只校验 command 内的协议字段', async () => {
  const h = createHarness();
  const gateway = createCloudRoomGateway({
    callFunction: async ({ data }) => {
      // 模拟共享云环境在事件根节点注入运行时上下文。
      const event = { ...data, tcbContext: { env: 'test' } };
      const envelope = event && event.type
        ? event
        : (event && event.command) || event || {};
      return { result: await h.app.executeCommand(envelope, { userId: 'host' }) };
    }
  });

  const result = await gateway.dispatch({
    protocolVersion: 3,
    commandId: 'create-with-runtime-context',
    roomId: '',
    knownSeq: 0,
    type: 'CREATE_ROOM',
    context: {},
    payload: { nickName: '房主' }
  });

  assert.equal(result.ok, true, result.errMsg);
});

async function reduceFromSnapshot(h, userId, before, limit = 3) {
  let reduced = before.view;
  let afterSeq = before.seq;
  while (true) {
    const batch = await h.app.sync('12345678', afterSeq, { userId }, { limit });
    assert.equal(batch.ok, true);
    assert.equal(batch.snapshotRequired, false);
    const groups = [];
    batch.events.forEach((item) => {
      const last = groups.at(-1);
      if (!last || last[0].commandId !== item.commandId) groups.push([item]);
      else last.push(item);
    });
    groups.forEach((group) => { reduced = applyEventGroup(reduced, group); });
    afterSeq = batch.throughSeq;
    if (!batch.hasMore) {
      reduced = { ...reduced, ...batch.actorView };
      break;
    }
  }
  return reduced;
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

test('跨配置、Partner 换轮和中途加入后，分批 Event 仍与最新 Snapshot 等价', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  const beforeByUser = {
    host: await h.snapshot('host'),
    u2: await h.snapshot('u2'),
    u3: await h.snapshot('u3')
  };
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  let current = await h.snapshot('host');
  const sessionId = current.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  const hostMemberId = (await h.snapshot('host')).view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId: hostMemberId }
  });
  await h.command('host', 'CONFIRM_FIRST_PLAYER', {
    context: { sessionId }, payload: { memberId: hostMemberId }
  });
  current = await h.snapshot('host');
  const turnId = current.view.session.activeTurn.turnId;
  await h.command('host', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId, workflowStep: 'PARTNER_TURN' },
    payload: { operationId: 'event-equivalence-card', text: '共享素材' }
  });
  await h.command('u2', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId }, payload: { scoreHalfSteps: 7 }
  });
  await h.command('u3', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId }, payload: { scoreHalfSteps: 8 }
  });
  await h.command('u2', 'POST_PARTNER_MESSAGE', {
    context: { sessionId, turnId, workflowStep: 'PARTNER_TURN' }, payload: { text: '事件等价性' }
  });
  await h.command('host', 'START_PARTNER_STATEMENT', { context: { sessionId, turnId } });
  await h.command('host', 'ADVANCE_PARTNER_TURN', {
    context: { sessionId, turnId }, payload: { statementResult: 'allPass' }
  });
  await h.command('u4', 'JOIN_ROOM', { payload: { nickName: '旁观者' } });

  for (const userId of ['host', 'u2', 'u3']) {
    const reduced = await reduceFromSnapshot(h, userId, beforeByUser[userId]);
    const latest = await h.snapshot(userId);
    assert.deepEqual(reduced, latest.view, `${userId} 的 Event 还原结果必须等于 Snapshot`);
    assert.equal(JSON.stringify(latest.view).includes('commitSeq'), false,
      '存储提交水位不属于 MemberView 协议字段');
  }
});

test('Spy 分牌后的公开 Event + 最终 ActorView 可完整恢复每个人的私密视图', async () => {
  const h = createHarness({ wordPairPicker: () => ({
    id: 'fixed', civilianWord: '白板', civilianBlurb: '民词', spyWord: '黑板', spyBlurb: '卧底词'
  }) });
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'SPY' } });
  const beforeByUser = {
    host: await h.snapshot('host'),
    u2: await h.snapshot('u2'),
    u3: await h.snapshot('u3')
  };
  const sessionId = beforeByUser.host.view.session.sessionId;
  await h.command('host', 'START_SPY_GAME', { context: { sessionId } });

  const privateRoles = [];
  for (const userId of ['host', 'u2', 'u3']) {
    const reduced = await reduceFromSnapshot(h, userId, beforeByUser[userId], 2);
    const latest = await h.snapshot(userId);
    assert.deepEqual(reduced, latest.view);
    privateRoles.push(reduced.actor.privateModeState.role);
  }
  assert.equal(privateRoles.filter((role) => role === 'spy').length, 1);
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
  assert.equal(client.getState().error.roomId, '12345678');
});

test('CREATE_ROOM 不把当前连接的 roomId 发给服务端', async () => {
  let sent = null;
  const view = { room: { roomId: '12345678' }, session: null,
    actor: { memberId: 'm1' }, route: { name: 'addPlayer', params: {} } };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1,
      roomId: '12345678', seq: 1, stateVersion: 1, view, ephemeral: {} }),
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1, eventSchemaVersion: 1,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false,
      snapshotRequired: false, events: [], actorView: { actor: view.actor, route: view.route } }),
    dispatch: async (envelope) => {
      sent = envelope;
      return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'CREATE_ROOM 不接受客户端 roomId', retryable: false };
    }
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  assert.equal(client.getState().roomId, '12345678');
  await client.dispatch({ type: 'CREATE_ROOM', roomId: '12345678', payload: { nickName: '房主' } });
  assert.equal(sent.type, 'CREATE_ROOM');
  assert.equal(sent.roomId, '');
});

test('写指令返回终态成员错误时不等待下一轮 poll，立即关闭旧 View', async () => {
  const view = { room: { roomId: '12345678' }, session: null,
    actor: { memberId: 'm1' }, route: { name: 'addPlayer', params: {} } };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: 1,
      roomId: '12345678', seq: 1, stateVersion: 1, view, ephemeral: {} }),
    sync: async () => null,
    dispatch: async () => ({ ok: false, errCode: 'NOT_MEMBER', errMsg: '已经被移出' })
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  const result = await client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: 'x' } });
  assert.equal(result.errCode, 'NOT_MEMBER');
  assert.equal(client.getView(), null);
  assert.equal(client.getState().status, 'DISCONNECTED');
  assert.equal(client.getState().error.roomId, '12345678');
});
