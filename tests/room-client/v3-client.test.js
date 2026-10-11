'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROOM_POLL_INTERVAL_MS, PRESENCE_TOUCH_INTERVAL_MS, PRESENCE_READ_INTERVAL_MS,
  ROOM_REQUEST_TIMEOUT_MS, createRoomClient, createCloudRoomGateway
} = require('@cardboard/room-client');
const {
  VIEW_SCHEMA_VERSION, EVENT_SCHEMA_VERSION, MAX_INCREMENTAL_SYNC_EVENTS
} = require('@cardboard/room-contracts');
const { applyProjectedEvent } = require('@cardboard/room-projection');
const { createHarness } = require('../helpers/room-v3');
const { projectPageSnapshot } = require('../../modules/room-session/page-model');

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

function recordingTimers() {
  let task = null;
  const delays = [];
  return {
    delays,
    setTimeoutFn(callback, delay) {
      task = callback;
      delays.push(delay);
      return delays.length;
    },
    clearTimeoutFn() { task = null; },
    async run() {
      const current = task;
      task = null;
      if (current) await current();
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function makeStableView(roomId, workshopName) {
  return {
    room: {
      roomId,
      lifecycle: 'OPEN',
      workshopName: workshopName || '测试工作坊',
      createdAt: 1,
      hostMemberId: 'member-1',
      modeSelectionRevision: 0,
      members: [{
        memberId: 'member-1', seatNo: 1, nickName: '房主', avatarRef: null,
        avatarIndex: null, color: '#5EC159', joinedAt: 1
      }]
    },
    session: null,
    actor: {
      memberId: 'member-1', role: 'HOST', seatNo: 1, isParticipant: false,
      contributionStatus: { submitted: false }, scoreStatus: { submitted: false },
      voteStatus: { submitted: false }, privateModeState: null, capabilities: {}
    },
    route: { name: 'addPlayer', params: {} },
    navigation: { back: { kind: 'NONE' } }
  };
}

test('Cloud gateway 在 SDK 丢失回调时按统一预算结束请求', async () => {
  const gateway = createCloudRoomGateway({
    callFunction: () => new Promise(() => {}),
    requestTimeoutMs: 5
  });

  await assert.rejects(
    gateway.dispatch({ type: 'CREATE_ROOM' }),
    (error) => error.code === 'DEPENDENCY_UNAVAILABLE' && error.retryable === true
  );
  assert.equal(ROOM_REQUEST_TIMEOUT_MS, 12000);
});

test('并发 open/refresh 合并为一次连接恢复，避免写命令排在重复查询后', async () => {
  const currentGate = deferred();
  let currentCalls = 0;
  const gateway = {
    currentRoom: async () => {
      currentCalls += 1;
      return currentGate.promise;
    },
    snapshot: async () => null,
    sync: async () => null,
    dispatch: async () => ({ ok: false, errCode: 'ROOM_NOT_FOUND', retryable: false })
  };
  const client = createRoomClient({ gateway, ...inertTimers() });

  const first = client.open();
  const second = client.open();
  const refreshed = client.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(currentCalls, 1);

  currentGate.resolve({ ok: true, roomId: null });
  await Promise.all([first, second, refreshed]);
  client.close();
});

test('恢复途中切换前后台会重新读取 Snapshot，且继续轮询', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const oldSnapshot = await h.snapshot('host');
  const gate = deferred();
  const entered = deferred();
  const timers = manualTimers();
  let snapshotCalls = 0;
  let syncCalls = 0;
  const client = createRoomClient({
    ...timers,
    gateway: {
      currentRoom: () => h.app.readCurrentRoom({ userId: 'host' }),
      snapshot: () => {
        snapshotCalls += 1;
        if (snapshotCalls === 1) { entered.resolve(); return gate.promise; }
        return h.snapshot('host');
      },
      sync: (roomId, seq) => { syncCalls += 1; return h.app.sync(roomId, seq, { userId: 'host' }); }
    }
  });
  const opening = client.open();
  await entered.promise;
  client.pause();
  const updated = await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: '前台最新房间' } });
  assert.equal(updated.ok, true);
  const resumed = client.resume();
  gate.resolve(oldSnapshot);
  await Promise.all([opening, resumed]);
  assert.equal(client.getView().room.workshopName, '前台最新房间');
  await timers.run();
  assert.equal(syncCalls, 1, '恢复后不能保持 paused 而永久停轮询');
  client.close();
});

test('前后台切换后丢弃在途旧 Snapshot，不能先发布旧 View 再恢复', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const oldSnapshot = await h.snapshot('host');
  const gates = [deferred(), deferred()];
  const entered = [deferred(), deferred()];
  let snapshotCalls = 0;
  const published = [];
  const client = createRoomClient({ ...inertTimers(), gateway: {
    currentRoom: () => h.app.readCurrentRoom({ userId: 'host' }),
    snapshot: () => {
      const index = snapshotCalls++;
      entered[index].resolve();
      return gates[index].promise;
    }
  } });
  client.subscribe((view) => { if (view) published.push(view.room.workshopName); });
  try {
    const opening = client.open();
    await entered[0].promise;
    client.pause();
    await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: '前台最新房间' } });
    const resumed = client.resume();
    gates[0].resolve(oldSnapshot);
    await opening;
    await entered[1].promise;
    assert.deepEqual(published, [], '旧恢复响应不能驱动订阅导航或屏幕副作用');
    assert.equal(client.getView(), null);
    gates[1].resolve(await h.snapshot('host'));
    await resumed;
    assert.deepEqual(published, ['前台最新房间']);
  } finally {
    gates.forEach((gate) => gate.resolve(oldSnapshot));
    client.close();
  }
});

test('自动 Sync 的在途 Snapshot 也不能跨前后台周期发布旧 View', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const oldSnapshot = await h.snapshot('host');
  const syncGate = deferred(), syncEntered = deferred();
  const recoveryGate = deferred(), recoveryEntered = deferred();
  const timers = manualTimers();
  let snapshotCalls = 0;
  const published = [];
  const client = createRoomClient({ ...timers, gateway: {
    currentRoom: () => h.app.readCurrentRoom({ userId: 'host' }),
    snapshot: () => {
      if (++snapshotCalls === 1) return h.snapshot('host');
      recoveryEntered.resolve();
      return recoveryGate.promise;
    },
    sync: () => { syncEntered.resolve(); return syncGate.promise; }
  } });
  client.subscribe((view) => { if (view) published.push(view.room.workshopName); });
  try {
    await client.open();
    published.length = 0;
    const polling = timers.run();
    await syncEntered.promise;
    client.pause();
    await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: '最新房间' } });
    const resumed = client.resume();
    syncGate.resolve({ ok: true, protocolVersion: oldSnapshot.protocolVersion,
      viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      delivery: 'SNAPSHOT', snapshot: oldSnapshot });
    await polling;
    await recoveryEntered.promise;
    assert.deepEqual(published, []);
    recoveryGate.resolve(await h.snapshot('host'));
    await resumed;
    assert.deepEqual(published, ['最新房间']);
  } finally {
    syncGate.resolve(null);
    recoveryGate.resolve(oldSnapshot);
    client.close();
  }
});

test('前后台切换丢弃旧创建快照，但保留已提交 Command 结果和房间归属', async () => {
  const h = createHarness();
  const commandGate = deferred(), commandEntered = deferred();
  const snapshotGate = deferred(), snapshotEntered = deferred();
  const published = [];
  const client = createRoomClient({ ...inertTimers(), gateway: {
    dispatch: () => { commandEntered.resolve(); return commandGate.promise; },
    snapshot: () => { snapshotEntered.resolve(); return snapshotGate.promise; },
    currentRoom: () => h.app.readCurrentRoom({ userId: 'host' })
  } });
  client.subscribe((view) => { if (view) published.push(view.room.workshopName); });
  let committed;
  try {
    const creating = client.dispatch({ type: 'CREATE_ROOM', payload: {} });
    await commandEntered.promise;
    committed = await h.command('host', 'CREATE_ROOM');
    assert.equal(committed.ok, true);
    client.pause();
    await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: '最新创建房间' } });
    const resumed = client.resume();
    commandGate.resolve(committed);
    assert.deepEqual(await creating, committed, '丢弃读模型不能把已提交写入改成失败');
    await snapshotEntered.promise;
    assert.deepEqual(published, []);
    assert.equal(client.getState().roomId, committed.outcome.roomId);
    snapshotGate.resolve(await h.snapshot('host'));
    await resumed;
    assert.deepEqual(published, ['最新创建房间']);
  } finally {
    commandGate.resolve(committed);
    snapshotGate.resolve(null);
    client.close();
  }
});

test('旧 current 握手成功、空房间或失败都不能跨生命周期继续恢复或发布', async () => {
  for (const result of [
    { ok: true, roomId: '12345678' }, { ok: true, roomId: null },
    { ok: false, errCode: 'DEPENDENCY_UNAVAILABLE', errMsg: '旧失败' },
    Object.assign(new Error('旧网络异常'), { code: 'DEPENDENCY_UNAVAILABLE' })
  ]) {
    const gate = deferred(), entered = deferred();
    let snapshotCalls = 0, currentCalls = 0;
    const published = [];
    const client = createRoomClient({ ...inertTimers(), gateway: {
      currentRoom: () => {
        if (++currentCalls === 1) { entered.resolve(); return gate.promise; }
        return { ok: true, roomId: null };
      },
      snapshot: () => { snapshotCalls += 1; return null; }
    } });
    client.subscribe((_view, state) => published.push(state.status), { emitCurrent: false });
    try {
      const opening = client.open();
      await entered.promise;
      client.pause();
      const resumed = client.resume();
      if (result instanceof Error) gate.reject(result);
      else gate.resolve(result);
      await Promise.all([opening, resumed]);
      assert.deepEqual(published, ['READY']);
      assert.equal(snapshotCalls, 0, '旧 current 成功也不能继续读取旧房 Snapshot');
    } finally { client.close(); }
  }
});

test('旧 Snapshot 终态错误、传输失败或无效结构不得断开新恢复', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const expectedRoomId = (await h.snapshot('host')).roomId;
  for (const result of [
    { ok: false, errCode: 'NOT_MEMBER', errMsg: '旧成员错误' },
    Object.assign(new Error('旧超时'), { code: 'DEPENDENCY_UNAVAILABLE' }),
    { ok: true, roomId: expectedRoomId }
  ]) {
    const gate = deferred(), entered = deferred();
    let snapshotCalls = 0;
    const published = [];
    const client = createRoomClient({ ...inertTimers(), gateway: {
      currentRoom: () => h.app.readCurrentRoom({ userId: 'host' }),
      snapshot: () => {
        if (++snapshotCalls === 1) { entered.resolve(); return gate.promise; }
        return h.snapshot('host');
      }
    } });
    client.subscribe((_view, state) => published.push(state.status), { emitCurrent: false });
    try {
      const opening = client.open();
      await entered.promise;
      client.pause();
      const resumed = client.resume();
      if (result instanceof Error) gate.reject(result);
      else gate.resolve(result);
      await Promise.all([opening, resumed]);
      assert.deepEqual(published, ['READY']);
      assert.equal(client.getState().error, null);
      assert.equal(client.getView().room.roomId, expectedRoomId);
    } finally { client.close(); }
  }
});

test('close 使在途读取失效，后续显式 open 不被旧恢复覆盖', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const oldSnapshot = await h.snapshot('host');
  const gate = deferred(), entered = deferred();
  let snapshotCalls = 0;
  const client = createRoomClient({ ...inertTimers(), gateway: {
    currentRoom: () => h.app.readCurrentRoom({ userId: 'host' }),
    snapshot: () => {
      if (++snapshotCalls === 1) { entered.resolve(); return gate.promise; }
      return h.snapshot('host');
    }
  } });
  const published = [];
  try {
    const opening = client.open();
    await entered.promise;
    client.close();
    client.subscribe((view) => { if (view) published.push(view.room.workshopName); });
    gate.resolve(oldSnapshot);
    await opening;
    assert.equal(client.getState().status, 'CLOSED');
    assert.equal(client.getView(), null);
    assert.deepEqual(published, []);
    await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: '重新打开的房间' } });
    await client.open();
    assert.deepEqual(published, ['重新打开的房间']);
  } finally { client.close(); }
});

test('恢复尚在队列中再次进入后台，不得被旧恢复任务重新开启轮询', async () => {
  const gate = deferred();
  const entered = deferred();
  const timers = manualTimers();
  let currentCalls = 0;
  const client = createRoomClient({ ...timers, gateway: {
    currentRoom: () => { currentCalls += 1; entered.resolve(); return gate.promise; }
  } });
  const opening = client.open();
  await entered.promise;
  client.pause();
  const resumed = client.resume();
  client.pause();
  gate.resolve({ ok: true, roomId: null });
  await Promise.all([opening, resumed]);
  await timers.run();
  assert.equal(currentCalls, 1);
  client.close();
});

test('启动查询丢失回调超时后，排队的创建命令仍会执行', async () => {
  const calls = [];
  const gateway = createCloudRoomGateway({
    requestTimeoutMs: 5,
    callFunction: ({ name }) => {
      calls.push(name);
      if (name === 'roomQuery') return new Promise(() => {});
      return Promise.resolve({ result: {
        ok: false, errCode: 'ROOM_NOT_FOUND', retryable: false
      } });
    }
  });
  const client = createRoomClient({ gateway, ...inertTimers() });

  const opening = client.open();
  const result = await client.dispatch({ type: 'CREATE_ROOM', payload: {} });
  await opening;

  assert.equal(result.errCode, 'ROOM_NOT_FOUND');
  assert.deepEqual(calls, ['roomQuery', 'roomCommand']);
  client.close();
});

test('RoomClient 在前一次请求完成后统一静默 2 秒再轮询', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const gateway = {
    currentRoom: () => h.app.readCurrentRoom({ userId: 'host' }),
    snapshot: (roomId) => h.app.readSnapshot(roomId, { userId: 'host' }),
    sync: (roomId, seq, limit) => h.app.sync(roomId, seq, { userId: 'host' }, { limit }),
    dispatch: async () => null,
  };
  const timers = recordingTimers();
  const client = createRoomClient({ gateway, ...timers, intervalMs: 800 });

  await client.open();
  assert.equal(timers.delays.at(-1), ROOM_POLL_INTERVAL_MS,
    '首次 Snapshot 已经是一致视图，后续 poll 应从请求完成时重新计时');
  await timers.run();
  assert.equal(ROOM_POLL_INTERVAL_MS, 2000);
  assert.equal(timers.delays.at(-1), ROOM_POLL_INTERVAL_MS);
  client.close();
});

test('Command 入队后废弃已到期 poll，并从 Command 结束重新计时', async () => {
  const commandGate = deferred();
  const timers = manualTimers();
  let syncCalls = 0;
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const enter = () => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
  };
  const leave = () => { activeRequests -= 1; };
  const view = makeStableView('12345678');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      roomId: '12345678', seq: 1, stateVersion: 1, view, ephemeral: {} }),
    sync: async () => {
      enter();
      syncCalls += 1;
      leave();
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        eventSchemaVersion: EVENT_SCHEMA_VERSION, afterSeq: 1, throughSeq: 1,
        roomCurrentSeq: 1, hasMore: false, delivery: 'EVENTS', events: [], ephemeral: {} };
    },
    dispatch: async () => {
      enter();
      try {
        await commandGate.promise;
        return { ok: false, errCode: 'INVALID_TRANSITION', retryable: false };
      } finally {
        leave();
      }
    }
  };
  const client = createRoomClient({ gateway, ...timers });
  await client.open();
  await timers.run();
  assert.equal(syncCalls, 1);

  const command = client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: 'x' } });
  // 模拟 poll 回调和用户指令在同一轮 event loop 竞态；旧 poll 不得跟在指令后立即执行。
  const expiredPoll = timers.run();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(activeRequests, 1);
  commandGate.resolve();
  await command;
  await expiredPoll;

  assert.equal(maxActiveRequests, 1, 'Command 与 Query 不得并发');
  assert.equal(syncCalls, 1, '指令期间到期的 poll 必须废弃');
  await timers.run();
  assert.equal(syncCalls, 2, '下一次 poll 从 Command 结束后开始计时');
  client.close();
});

test('所有 roomQuery 查询与 Command 共用一条串行请求通道', async () => {
  const commandGate = deferred();
  let historyStarted = false;
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const view = makeStableView('12345678');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      roomId: '12345678', seq: 1, stateVersion: 1, view, ephemeral: {} }),
    sync: async () => null,
    dispatch: async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      try {
        await commandGate.promise;
        return { ok: false, errCode: 'INVALID_TRANSITION', retryable: false };
      } finally {
        activeRequests -= 1;
      }
    },
    history: async () => {
      historyStarted = true;
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      activeRequests -= 1;
      return { ok: true, sessions: [] };
    }
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  const command = client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: 'x' } });
  await Promise.resolve();
  const history = client.history({}, '12345678');
  await Promise.resolve();

  assert.equal(historyStarted, false, '指令未结束时不应发起 roomQuery');
  commandGate.resolve();
  await command;
  await history;
  assert.equal(historyStarted, true);
  assert.equal(maxActiveRequests, 1);
  client.close();
});

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

test('RoomClient 在任意协议中复用设备身份并按间隔请求 Presence 续租', async () => {
  const client = createRoomClient({
    gateway: {
      currentRoom: async () => ({ ok: true, roomId: null }),
      snapshot: async () => null,
      sync: async () => null,
      dispatch: async () => null
    },
    ...inertTimers(),
    deviceSessionId: 'device-test'
  });
  const first = client.getRequestContext();
  const second = client.getRequestContext();
  assert.equal(PRESENCE_TOUCH_INTERVAL_MS, 5000);
  assert.deepEqual(first, { deviceSessionId: 'device-test', touchPresence: true });
  assert.deepEqual(second, { deviceSessionId: 'device-test', touchPresence: false });
  client.close();
});

test('RoomClient 保持 2 秒业务 Sync，Presence 独立降频到 5 秒', async () => {
  let now = 10000;
  const syncContexts = [];
  const syncLimits = [];
  const timers = manualTimers();
  const view = makeStableView('12345678');
  const client = createRoomClient({
    gateway: {
      currentRoom: async () => ({ ok: true, roomId: '12345678' }),
      snapshot: async (roomId, context) => ({ ok: true, protocolVersion: 3,
        viewSchemaVersion: VIEW_SCHEMA_VERSION, roomId, seq: 1, stateVersion: 1,
        view, ephemeral: { presenceByMemberId: {}, signals: {},
          stale: { presence: false, signals: false } }, serverTime: now, context }),
      sync: async (roomId, afterSeq, limit, context) => {
        syncContexts.push(context);
        syncLimits.push(limit);
        const callNo = syncContexts.length;
        const catchingUp = callNo === 3 || callNo === 4;
        const nextSeq = catchingUp ? afterSeq + 1 : afterSeq;
        return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
          eventSchemaVersion: EVENT_SCHEMA_VERSION, afterSeq, throughSeq: nextSeq,
          roomCurrentSeq: catchingUp ? 3 : afterSeq, hasMore: callNo === 3,
          delivery: 'EVENTS',
          events: catchingUp ? [{
            roomId, seq: nextSeq, stateVersion: nextSeq,
            eventSchemaVersion: EVENT_SCHEMA_VERSION,
            viewSchemaVersion: VIEW_SCHEMA_VERSION,
            commandId: `catch-up-${nextSeq}`,
            publicEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
            publicPatch: { set: [{ path: 'room.workshopName', value: `版本${nextSeq}` }],
              remove: [], splice: [] },
            actorPatch: null
          }] : [],
          ephemeral: context.readPresence && callNo !== 3
            ? { presenceByMemberId: {}, signals: {}, stale: { presence: false, signals: false } }
            : { signals: {}, stale: { presence: true, signals: false } },
          serverTime: now };
      },
      dispatch: async () => null
    },
    ...timers,
    nowFn: () => now
  });

  await client.open();
  now += ROOM_POLL_INTERVAL_MS;
  await timers.run();
  now += ROOM_POLL_INTERVAL_MS;
  await timers.run();
  now += ROOM_POLL_INTERVAL_MS;
  await timers.run();
  now += ROOM_POLL_INTERVAL_MS;
  await timers.run();

  assert.equal(PRESENCE_READ_INTERVAL_MS, 5000);
  assert.deepEqual(syncContexts.map((context) => context.readPresence), [false, false, true, true, false],
    '追赶中的非最终批次不能提前消耗 Presence 读取额度');
  assert.deepEqual(syncLimits, Array(5).fill(MAX_INCREMENTAL_SYNC_EVENTS));
  client.close();
});

test('CloudBase 注入 tcbContext 时仍只校验 command 内的协议字段', async () => {
  const h = createHarness();
  const gateway = createCloudRoomGateway({
    callFunction: async ({ data }) => {
      // 模拟云平台在事件根节点注入运行时上下文。
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
    assert.equal(batch.delivery, 'EVENTS');
    batch.events.forEach((event) => { reduced = applyProjectedEvent(reduced, event); });
    afterSeq = batch.throughSeq;
    if (!batch.hasMore) {
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

test('Snapshot@N + 公共/Actor 投影事件等于 Snapshot@M', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const before = await h.snapshot('u2');
  await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: '等价性' } });
  await h.command('u2', 'UPDATE_MEMBER_PROFILE', { payload: { nickName: '成员二' }, knownSeq: before.seq });
  const batch = await h.app.sync('12345678', before.seq, { userId: 'u2' });
  let reduced = before.view;
  batch.events.forEach((event) => { reduced = applyProjectedEvent(reduced, event); });
  const latest = await h.snapshot('u2');
  assert.deepEqual(reduced, latest.view);
});

test('游戏中成员改名会通过公共 Event 广播到其他成员的页面模型', async () => {
  const h = createHarness();
  await h.seedMembers(2);
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

  const hostBeforeRename = await h.snapshot('host');
  await h.command('u2', 'UPDATE_MEMBER_PROFILE', { payload: { nickName: '游戏中新昵称' } });
  const batch = await h.app.sync('12345678', hostBeforeRename.seq, { userId: 'host' });
  let hostView = hostBeforeRename.view;
  batch.events.forEach((event) => { hostView = applyProjectedEvent(hostView, event); });
  const hostPage = projectPageSnapshot(hostView, {
    seq: batch.throughSeq,
    stateVersion: batch.events.at(-1).stateVersion,
    ephemeral: {}
  });

  assert.equal(batch.delivery, 'EVENTS');
  assert.equal(batch.events.some((event) => (event.publicEvents || [])
    .some((item) => item.type === 'MEMBER_PROFILE_UPDATED')), true);
  assert.equal(hostPage.members.find((member) => member.memberId !== hostPage.view.actor.memberId).nickName,
    '游戏中新昵称');
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
  await h.command('host', 'START_PARTNER_STATEMENT', {
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

test('Spy 分牌后的公共 Event + 本人 ActorPatch 可完整恢复每个人的私密视图', async () => {
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
  const view = makeStableView('12345678', '恢复后');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, roomId: '12345678',
      seq: snapshotCalls++, stateVersion: snapshotCalls, view, ephemeral: {}, minAvailableSeq: 1 }),
    dispatch: async () => ({ ok: true, outcome: { kind: 'ACCEPTED', roomId: '12345678' }, sync: {
      ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 2, roomCurrentSeq: 2, hasMore: false, delivery: 'EVENTS',
      events: [{ eventSchemaVersion: EVENT_SCHEMA_VERSION, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 2, stateVersion: 2,
        commandId: 'x', publicEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
        publicPatch: { set: [], remove: [], splice: [] }, actorPatch: null }]
    } }),
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 0, hasMore: false,
      delivery: 'EVENTS', events: [] })
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  await client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: 'x' } });
  assert.equal(snapshotCalls, 2);
  assert.equal(client.getView().room.workshopName, '恢复后');
});

test('旧 View Schema 的 Event/Sync 强制重新读取当前 Snapshot', async () => {
  let snapshotCalls = 0;
  const view = makeStableView('12345678', '当前版本快照');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 0, stateVersion: 0, view, ephemeral: {} };
    },
    sync: async () => ({ ok: true, protocolVersion: 3,
      viewSchemaVersion: VIEW_SCHEMA_VERSION - 1, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false, delivery: 'EVENTS',
      events: [{ eventSchemaVersion: EVENT_SCHEMA_VERSION,
        viewSchemaVersion: VIEW_SCHEMA_VERSION - 1,
        roomId: '12345678', seq: 1, stateVersion: 1,
        commandId: 'old-view-schema', publicEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
        publicPatch: { set: [], remove: [], splice: [] }, actorPatch: null }], ephemeral: {} }),
    dispatch: async () => null
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });

  await client.open();
  await timers.run();

  assert.equal(snapshotCalls, 2);
  assert.equal(client.getView().room.workshopName, '当前版本快照');
  assert.equal(client.getState().status, 'READY');
  client.close();
});

test('旧 Event Schema 的 Event/Sync 强制重新读取当前 Snapshot', async () => {
  let snapshotCalls = 0;
  const view = makeStableView('12345678', '当前事件版本快照');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 0, stateVersion: 0, view, ephemeral: {} };
    },
    sync: async () => ({ ok: true, protocolVersion: 3,
      viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION - 1,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false, delivery: 'EVENTS',
      events: [{ eventSchemaVersion: EVENT_SCHEMA_VERSION - 1,
        viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 1, stateVersion: 1,
        commandId: 'old-event-schema', publicEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
        publicPatch: { set: [], remove: [], splice: [] }, actorPatch: null }], ephemeral: {} }),
    dispatch: async () => null
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });

  await client.open();
  await timers.run();

  assert.equal(snapshotCalls, 2);
  assert.equal(client.getView().room.workshopName, '当前事件版本快照');
  assert.equal(client.getState().status, 'READY');
  client.close();
});

test('旧 View Schema 的 Snapshot 不得安装为稳定 View', async () => {
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3,
      viewSchemaVersion: VIEW_SCHEMA_VERSION - 1,
      roomId: '12345678', seq: 0, stateVersion: 0,
      view: makeStableView('12345678', '旧版本快照'), ephemeral: {} }),
    sync: async () => null,
    dispatch: async () => null
  };
  const client = createRoomClient({ gateway, ...inertTimers() });

  await client.open();

  assert.equal(client.getView(), null);
  assert.equal(client.getState().status, 'DEGRADED');
  client.close();
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
  const view = makeStableView('12345678', '完整状态');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      roomId: '12345678', seq: snapshotCalls++, stateVersion: snapshotCalls, view, ephemeral: {} }),
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 2, hasMore: false,
      delivery: 'EVENTS', events: [] }),
    dispatch: async () => ({ ok: true, outcome: { kind: 'ACCEPTED' }, sync: {
      ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 2, hasMore: false,
      delivery: 'EVENTS', events: []
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
  const view = makeStableView('12345678');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 0, stateVersion: snapshotCalls, view, ephemeral: {} };
    },
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 1, hasMore: true,
      delivery: 'EVENTS', events: [] }),
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
  const view = makeStableView('12345678', '快照权威');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      roomId: '12345678', seq: snapshotCalls++, stateVersion: snapshotCalls, view, ephemeral: {} }),
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 0, hasMore: false,
      delivery: 'EVENTS', events: [] }),
    dispatch: async () => ({ ok: true, outcome: { kind: 'ACCEPTED' }, sync: {
      ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false,
      delivery: 'EVENTS',
      events: [{ eventSchemaVersion: EVENT_SCHEMA_VERSION, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 1, stateVersion: 1,
        commandId: 'x', publicEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
        actorPatch: null }]
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
  const view = makeStableView('12345678', '权威快照');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 0, stateVersion: 4, view, ephemeral: {} };
    },
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false,
      delivery: 'EVENTS',
      events: [{ eventSchemaVersion: EVENT_SCHEMA_VERSION, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 1, stateVersion: 7,
        commandId: 'broken-version', publicEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
        publicPatch: { set: [], remove: [], splice: [] }, actorPatch: null }]
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
  const makeView = () => makeStableView('12345678', `快照${snapshotCalls}`);
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
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

test('Command 网络异常后恢复预约轮询', async () => {
  let syncCalls = 0;
  const view = makeStableView('12345678', '房间');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({
      ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      roomId: '12345678', seq: 1, stateVersion: 1, view, ephemeral: {}
    }),
    sync: async () => {
      syncCalls += 1;
      return {
        ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        eventSchemaVersion: EVENT_SCHEMA_VERSION,
        afterSeq: 1, throughSeq: 1, roomCurrentSeq: 1, hasMore: false,
        delivery: 'EVENTS', events: [], ephemeral: {}
      };
    },
    dispatch: async () => { throw new Error('network down'); }
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });
  await client.open();
  await assert.rejects(
    client.dispatch({ type: 'UPDATE_ROOM_PROFILE', payload: { workshopName: 'x' } }),
    /network down/
  );
  await timers.run();
  assert.equal(syncCalls, 1);
  assert.equal(client.getState().status, 'READY');
  client.close();
});

test('Sync 内联 Snapshot 可直接替换 View，不再追加一次 Snapshot 请求', async () => {
  let snapshotCalls = 0;
  const initialView = makeStableView('12345678', '初始状态');
  const latestView = makeStableView('12345678', '最新状态');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 1, stateVersion: 1, view: initialView, ephemeral: {} };
    },
    sync: async () => ({
      ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      delivery: 'SNAPSHOT',
      snapshot: {
        ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 30, stateVersion: 30, view: latestView, ephemeral: {}
      }
    }),
    dispatch: async () => null
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });

  await client.open();
  await timers.run();

  assert.equal(snapshotCalls, 1);
  assert.equal(client.getState().seq, 30);
  assert.equal(client.getView().room.workshopName, '最新状态');
  client.close();
});

test('本地没有有效 View 时定时恢复只重试 Snapshot，不发送 sync(0)', async () => {
  let snapshotCalls = 0;
  let syncCalls = 0;
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 81, stateVersion: 81,
        view: { room: { roomId: '12345678' } }, ephemeral: {} };
    },
    sync: async () => { syncCalls += 1; return null; },
    dispatch: async () => null
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });

  await client.open();
  await timers.run();

  assert.equal(snapshotCalls, 2);
  assert.equal(syncCalls, 0);
  assert.equal(client.getState().status, 'DEGRADED');
  client.close();
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
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
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
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      roomId: '12345678', seq: 1, stateVersion: 1, view, ephemeral: {} }),
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false,
      delivery: 'EVENTS', events: [] }),
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
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
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

test('连续丢失指令响应后，用户重试仍复用未确认的 commandId', async () => {
  const sent = [];
  let ids = 0;
  let failures = 2;
  const view = { room: { roomId: '12345678', lifecycle: 'OPEN', members: [] }, session: null,
    actor: { memberId: 'm1', role: 'HOST', capabilities: {} }, route: { name: 'addPlayer', params: {} } };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      roomId: '12345678', seq: 1, stateVersion: 1, view, ephemeral: {} }),
    sync: async () => null,
    dispatch: async (envelope) => {
      sent.push(envelope.commandId);
      if (failures > 0) {
        failures -= 1;
        throw new Error('response lost');
      }
      return { ok: false, errCode: 'INVALID_TRANSITION', retryable: false };
    }
  };
  const client = createRoomClient({ gateway, ...inertTimers(), commandIdFactory: () => `cmd-${++ids}` });
  await client.open();
  const command = { type: 'POST_PARTNER_MESSAGE', payload: { text: '只发一次' },
    context: { sessionId: 's1', turnId: 't1', workflowStep: 'PARTNER_TURN' } };

  await assert.rejects(() => client.dispatch(command), /response lost/);
  await client.dispatch(command);

  assert.deepEqual(sent, ['cmd-1', 'cmd-1', 'cmd-1']);
  client.close();
});

test('空响应也保留未确认 commandId，避免重复提交同一业务意图', async () => {
  const sent = [];
  let calls = 0;
  const client = createRoomClient({
    gateway: {
      currentRoom: async () => ({ ok: true, roomId: null }),
      snapshot: async () => null,
      sync: async () => null,
      dispatch: async (command) => {
        sent.push(command.commandId);
        calls += 1;
        return calls === 1 ? null : { ok: false, errCode: 'INVALID_TRANSITION', retryable: false };
      }
    },
    ...inertTimers(),
    commandIdFactory: (() => { let id = 0; return () => `empty-${++id}`; })()
  });

  const first = await client.dispatch({ type: 'CREATE_ROOM', payload: { nickName: '房主' } });
  const second = await client.dispatch({ type: 'CREATE_ROOM', payload: { nickName: '房主' } });

  assert.equal(first.retryable, true);
  assert.equal(second.errCode, 'INVALID_TRANSITION');
  assert.deepEqual(sent, ['empty-1', 'empty-1']);
  client.close();
});

test('结构化 retryable 响应后，用户重试仍复用未确认的 commandId', async () => {
  const sent = [];
  let calls = 0;
  let ids = 0;
  const client = createRoomClient({
    gateway: {
      currentRoom: async () => ({ ok: true, roomId: null }),
      snapshot: async () => null,
      sync: async () => null,
      dispatch: async (command) => {
        sent.push(command.commandId);
        calls += 1;
        if (calls <= 2) {
          return { ok: false, errCode: 'DEPENDENCY_UNAVAILABLE', errMsg: '暂时不可用', retryable: true };
        }
        return { ok: false, errCode: 'INVALID_TRANSITION', retryable: false };
      }
    },
    ...inertTimers(),
    commandIdFactory: () => `retryable-${++ids}`
  });

  const command = { type: 'CREATE_ROOM', payload: { nickName: '房主' } };
  const first = await client.dispatch(command);
  const second = await client.dispatch(command);

  assert.equal(first.retryable, true);
  assert.equal(second.retryable, false);
  assert.deepEqual(sent, ['retryable-1', 'retryable-1', 'retryable-1']);
  client.close();
});

test('创建直接安装附带 Snapshot，后续按其 seq 拉取事件', async () => {
  const h = createHarness();
  const timers = manualTimers();
  let snapshotCalls = 0;
  const afterSeqs = [];
  const client = createRoomClient({ ...timers, gateway: {
    dispatch: (command) => h.app.executeCommand(command, { userId: 'host' }),
    snapshot: (roomId) => { snapshotCalls += 1; return h.snapshot('host', roomId); },
    sync: (roomId, afterSeq) => { afterSeqs.push(afterSeq); return h.app.sync(roomId, afterSeq, { userId: 'host' }); }
  } });
  const response = await client.dispatch({ type: 'CREATE_ROOM', payload: { nickName: '房主' } });
  assert.equal(response.ok, true);
  assert.equal(snapshotCalls, 0);
  assert.deepEqual(client.getView(), response.snapshot.view);
  await timers.run();
  assert.deepEqual(afterSeqs, [response.snapshot.seq]);
  client.close();
});

test('附带 Snapshot 低于提交水位时重新读取，不能安装旧 View', async () => {
  const h = createHarness();
  await h.seedMembers(1);
  const old = await h.snapshot('host');
  await h.command('host', 'UPDATE_ROOM_PROFILE', { payload: { workshopName: '最新名称' } });
  const current = await h.snapshot('host');
  let reads = 0;
  const client = createRoomClient({ ...inertTimers(), gateway: {
    dispatch: async () => ({ ok: true, outcome: { kind: 'ROOM_JOINED', roomId: old.roomId,
      committedThroughSeq: current.seq }, snapshot: old }),
    snapshot: async () => { reads += 1; return current; }
  } });
  await client.dispatch({ type: 'JOIN_ROOM', roomId: old.roomId });
  assert.equal(reads, 1);
  assert.deepEqual(client.getView(), current.view);
  client.close();
});

test('创建已成功但首次 Snapshot 失败时仍返回成功并进入恢复态', async () => {
  const client = createRoomClient({
    gateway: {
      currentRoom: async () => ({ ok: true, roomId: null }),
      snapshot: async () => { throw new Error('snapshot unavailable'); },
      sync: async () => null,
      dispatch: async () => ({ ok: true, commandId: 'create-ok',
        outcome: { kind: 'ROOM_CREATED', roomId: '12345678' } })
    },
    ...inertTimers(),
    commandIdFactory: () => 'create-ok'
  });

  const result = await client.dispatch({ type: 'CREATE_ROOM', payload: { nickName: '房主' } });

  assert.equal(result.ok, true);
  assert.equal(client.getState().roomId, '12345678');
  assert.equal(client.getState().status, 'DEGRADED');
  client.close();
});

test('切换房间成功但新房 Snapshot 失败时清空旧房间的 View 与瞬时态', async () => {
  const oldView = makeStableView('12345678', '旧房间');
  let snapshotCalls = 0;
  const client = createRoomClient({
    gateway: {
      currentRoom: async () => ({ ok: true, roomId: '12345678' }),
      snapshot: async (roomId) => {
        snapshotCalls += 1;
        if (roomId === '87654321') throw new Error('new room snapshot unavailable');
        return {
          ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, roomId,
          seq: 7, stateVersion: 7, view: oldView,
          ephemeral: { presenceByMemberId: { 'member-1': { online: true } }, signals: {} }
        };
      },
      sync: async () => null,
      dispatch: async () => ({
        ok: true,
        outcome: { kind: 'ROOM_JOINED', roomId: '87654321' }
      })
    },
    ...inertTimers()
  });

  await client.open();
  assert.equal(client.getView().room.workshopName, '旧房间');
  await client.dispatch({ type: 'JOIN_ROOM', roomId: '87654321', payload: { nickName: '玩家' } });

  const state = client.getState();
  assert.equal(snapshotCalls, 2);
  assert.equal(state.roomId, '87654321');
  assert.equal(state.view, null);
  assert.equal(state.seq, 0);
  assert.equal(state.stateVersion, 0);
  assert.deepEqual(state.ephemeral, {});
  assert.equal(state.status, 'DEGRADED');
  client.close();
});

test('结构不完整的 Snapshot 不得成为稳定 View', async () => {
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      roomId: '12345678', seq: 1, stateVersion: 1,
      view: { room: { roomId: '12345678' }, actor: { memberId: 'm1' }, route: { name: 'addPlayer' } },
      ephemeral: {} }),
    sync: async () => null,
    dispatch: async () => null
  };
  const client = createRoomClient({ gateway, ...inertTimers() });

  await client.open();

  assert.equal(client.getView(), null);
  assert.equal(client.getState().status, 'DEGRADED');
  client.close();
});

test('Actor Patch 不得越权改写公共 View', async () => {
  let snapshotCalls = 0;
  const snapshotView = () => makeStableView('12345678', `snapshot-${snapshotCalls}`);
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 0, stateVersion: 0, view: snapshotView(), ephemeral: {} };
    },
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false, delivery: 'EVENTS',
      events: [{ eventSchemaVersion: EVENT_SCHEMA_VERSION, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 1, stateVersion: 1,
        commandId: 'bad-actor-patch', publicEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
        publicPatch: { set: [], remove: [], splice: [] },
        actorPatch: { set: [{ path: 'room', value: {
          roomId: '12345678', lifecycle: 'OPEN', workshopName: '越权改写', members: []
        } }], remove: [], splice: [] } }],
      ephemeral: {} }),
    dispatch: async () => null
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });
  await client.open();

  await timers.run();

  assert.equal(snapshotCalls, 2);
  assert.notEqual(client.getView().room.workshopName, '越权改写');
  client.close();
});

test('Event Patch 破坏 MemberView 骨架时回退 Snapshot', async () => {
  let snapshotCalls = 0;
  const stableView = makeStableView('12345678');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return { ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: snapshotCalls - 1, stateVersion: snapshotCalls - 1,
        view: stableView, ephemeral: {} };
    },
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 1, roomCurrentSeq: 1, hasMore: false, delivery: 'EVENTS',
      events: [{ eventSchemaVersion: EVENT_SCHEMA_VERSION, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        roomId: '12345678', seq: 1, stateVersion: 1,
        commandId: 'remove-session', publicEvents: [{ type: 'WORKSHOP_SESSION_CANCELLED' }],
        publicPatch: { set: [], remove: ['session'], splice: [] }, actorPatch: null }], ephemeral: {} }),
    dispatch: async () => null
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });
  await client.open();

  await timers.run();

  assert.equal(snapshotCalls, 2);
  assert.equal(client.getView().session, null);
  assert.equal(client.getState().seq, 1);
  client.close();
});

test('Presence/Signal 查询失败时保留上次瞬时值并标记 stale', async () => {
  const view = makeStableView('12345678');
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      roomId: '12345678', seq: 0, stateVersion: 0, view,
      ephemeral: { presenceByMemberId: { m2: { online: true, lastSeenAt: 10 } },
        signals: { PARTNER_SILENT_SOUND: { value: 0.6 } }, stale: { presence: false, signals: false } } }),
    sync: async () => ({ ok: true, protocolVersion: 3, viewSchemaVersion: VIEW_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: 0, throughSeq: 0, roomCurrentSeq: 0, hasMore: false, delivery: 'EVENTS', events: [],
      ephemeral: { presenceByMemberId: {}, signals: {}, stale: { presence: true, signals: true } } }),
    dispatch: async () => null
  };
  const timers = manualTimers();
  const client = createRoomClient({ gateway, ...timers });
  await client.open();

  await timers.run();

  assert.equal(client.getState().ephemeral.presenceByMemberId.m2.online, true);
  assert.equal(client.getState().ephemeral.signals.PARTNER_SILENT_SOUND.value, 0.6);
  assert.deepEqual(client.getState().ephemeral.stale, { presence: true, signals: true });
  client.close();
});
