'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLLECTIONS,
  safeGet,
  docId,
  createCloudBaseRoomRepository
} = require('@cardboard/room-cloudbase-adapter');
const { PROTOCOL_VERSION, SCHEMA_VERSION } = require('@cardboard/room-contracts');

const CURRENT_ROOM_VERSION = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  schemaVersion: SCHEMA_VERSION
});

function storeRejecting(error) {
  return {
    collection() {
      return { doc() { return { get: async () => { throw error; } }; } };
    }
  };
}

function createTransactionDbThatRejectsConcurrentQueries() {
  let activeQueries = 0;
  async function guardedResult(data) {
    if (activeQueries > 0) {
      throw Object.assign(new Error('collection.get:fail -501001 resource system error. '
        + '[ResourceUnavailable.TransactionBusy] Transaction is busy'), { errCode: -501001 });
    }
    activeQueries += 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { data };
    } finally {
      activeQueries -= 1;
    }
  }

  const transaction = {
    collection(name) {
      const query = {
        doc(id) {
          return {
            get() {
              if (name === 'roomV3Rooms') {
                return guardedResult({ _id: id, roomId: id, ...CURRENT_ROOM_VERSION, lifecycle: 'OPEN',
                  currentSessionId: 'session-1', eventSeq: 0, members: [] });
              }
              if (name === 'roomV3Sessions') {
                return guardedResult({ _id: id, roomId: '12345678', sessionId: id });
              }
              return guardedResult(null);
            }
          };
        },
        where() { return query; },
        orderBy() { return query; },
        skip() { return query; },
        limit() { return query; },
        get() { return guardedResult([]); }
      };
      return query;
    }
  };

  return { runTransaction: (handler) => handler(transaction) };
}

test('CloudBase Adapter 只把“文档不存在”解释为空值', async () => {
  const missing = Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
  assert.equal(await safeGet(storeRejecting(missing), 'rooms', 'x'), null);

  const network = Object.assign(new Error('network timeout'), { code: 'NETWORK_ERROR' });
  await assert.rejects(() => safeGet(storeRejecting(network), 'rooms', 'x'), /network timeout/);
});

test('CloudBase 事务中的 Aggregate 查询严格串行，避免 TransactionBusy', async () => {
  const currentRepo = createCloudBaseRoomRepository({
    db: createTransactionDbThatRejectsConcurrentQueries()
  });
  await assert.doesNotReject(() => currentRepo.readAggregate('12345678'));

  const historyRepo = createCloudBaseRoomRepository({
    db: createTransactionDbThatRejectsConcurrentQueries()
  });
  await assert.doesNotReject(() => historyRepo.readSessionAggregate('12345678', 'session-1'));
});

test('CloudBase 消息分页使用 commitSeq 游标且查询失败原样上抛', async () => {
  const queries = [];
  let failure = null;
  const db = {
    command: { lt: (value) => ({ $lt: value }) },
    runTransaction: async () => { throw new Error('本测试不进入事务'); },
    collection(name) {
      const query = { name, condition: null, order: null, size: null };
      return {
        where(condition) {
          query.condition = condition;
          return this;
        },
        orderBy(field, direction) {
          query.order = [field, direction];
          return this;
        },
        limit(size) {
          query.size = size;
          return this;
        },
        async get() {
          queries.push(query);
          if (failure) throw failure;
          return { data: [{ messageId: 'm2', commitSeq: 20 }, { messageId: 'm1', commitSeq: 19 }] };
        }
      };
    }
  };
  const repo = createCloudBaseRoomRepository({ db });
  const rows = await repo.listMessages('12345678', 's1', { limit: 1, beforeSeq: 21 });
  assert.deepEqual(rows.map((row) => row.messageId), ['m2', 'm1']);
  assert.deepEqual(queries[0], {
    name: 'roomV3Messages',
    condition: { roomId: '12345678', sessionId: 's1', commitSeq: { $lt: 21 } },
    order: ['commitSeq', 'desc'],
    size: 2
  });

  failure = Object.assign(new Error('database unavailable'), { code: 'NETWORK_ERROR' });
  await assert.rejects(() => repo.listMessages('12345678', 's1', { limit: 20 }), /database unavailable/);
});

test('CloudBase 命令事务清理指向不存在房间的当前房间索引', async () => {
  const documents = new Map();
  const activeKey = `${COLLECTIONS.active}:${docId('host')}`;
  documents.set(activeKey, { roomId: '87654321', userId: 'host' });
  const missing = () => Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
  const transaction = {
    collection(name) {
      return {
        doc(id) {
          const key = `${name}:${id}`;
          return {
            async get() {
              if (!documents.has(key)) throw missing();
              return { data: documents.get(key) };
            },
            async set({ data }) { documents.set(key, data); },
            async remove() { documents.delete(key); }
          };
        }
      };
    }
  };
  const db = {
    runTransaction: (callback) => callback(transaction)
  };
  const repo = createCloudBaseRoomRepository({ db });
  let activeRoomId = 'not-called';

  await repo.transactCommand({
    scopeKey: 'actor:host',
    commandId: 'create-after-dangling-active-room',
    actorUserId: 'host',
    roomId: '12345678',
    roomIdCandidates: ['12345678'],
    type: 'CREATE_ROOM',
    requestHash: 'hash',
    createdAt: 1000
  }, (context) => {
    activeRoomId = context.activeRoomId;
    return { accepted: false, error: { ok: false, errCode: 'TEST_REJECTION' } };
  });

  assert.equal(activeRoomId, null);
  assert.equal(documents.has(activeKey), false);
});

test('CloudBase 当前房间查询只读取 active 与 room 文档', async () => {
  const accessedCollections = [];
  const documents = new Map([
    [`${COLLECTIONS.active}:${docId('host')}`, {
      roomId: '12345678', userId: 'host', memberId: 'member-host'
    }],
    [`${COLLECTIONS.rooms}:12345678`, {
      roomId: '12345678', ...CURRENT_ROOM_VERSION, lifecycle: 'OPEN',
      members: [{ userId: 'host', memberId: 'member-host' }]
    }]
  ]);
  const transaction = {
    collection(name) {
      accessedCollections.push(name);
      return {
        doc(id) {
          return {
            async get() {
              const data = documents.get(`${name}:${id}`);
              if (!data) throw Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
              return { data };
            }
          };
        }
      };
    }
  };
  const repo = createCloudBaseRoomRepository({
    db: { runTransaction: (callback) => callback(transaction) }
  });

  assert.deepEqual(await repo.findActiveRoom('host'), {
    roomId: '12345678', memberId: 'member-host'
  });
  assert.deepEqual(accessedCollections, [COLLECTIONS.active, COLLECTIONS.rooms]);
});

test('CloudBase 把旧持久化 Schema 的活跃房间视为悬挂索引', async () => {
  const documents = new Map([
    [`${COLLECTIONS.active}:${docId('host')}`, {
      roomId: '12345678', userId: 'host', memberId: 'member-host'
    }],
    [`${COLLECTIONS.rooms}:12345678`, {
      roomId: '12345678', protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION - 1,
      lifecycle: 'OPEN', members: [{ userId: 'host', memberId: 'member-host' }]
    }]
  ]);
  const transaction = {
    collection(name) {
      return { doc(id) { return { async get() { return { data: documents.get(`${name}:${id}`) }; } }; } };
    }
  };
  const repo = createCloudBaseRoomRepository({
    db: { runTransaction: (callback) => callback(transaction) }
  });

  assert.deepEqual(await repo.findActiveRoom('host'), {
    dangling: true,
    roomId: '12345678'
  });
});

test('CloudBase 高频 Sync 只读取轻量 Room 与统一事件流', async () => {
  const accessedCollections = [];
  const room = { roomId: '12345678', ...CURRENT_ROOM_VERSION, lifecycle: 'OPEN', eventSeq: 3,
    currentSessionId: 'session-1', members: [{ userId: 'host', memberId: 'member-host' }] };
  const transaction = {
    collection(name) {
      accessedCollections.push(name);
      if (name === COLLECTIONS.sessions) throw new Error('Sync 不应读取 RoomSession');
      const query = {
        doc() { return { async get() { return { data: room }; } }; },
        where() { return query; },
        orderBy() { return query; },
        limit() { return query; },
        async get() { return { data: [{ roomId: '12345678', seq: 3 }] }; }
      };
      return query;
    }
  };
  const range = { and: () => ({}) };
  const repo = createCloudBaseRoomRepository({
    db: {
      command: { gt: () => range, lte: () => ({}) },
      runTransaction: async () => { throw new Error('Sync 不应启动读事务'); },
      collection: (name) => transaction.collection(name)
    }
  });

  const result = await repo.readSyncState('12345678', 2, 100);
  assert.equal(result.room.currentSessionId, 'session-1');
  assert.deepEqual(result.events.map((event) => event.seq), [3]);
  assert.deepEqual(accessedCollections, [COLLECTIONS.rooms, COLLECTIONS.events]);
});

test('CloudBase 高频 Sync 不开启读事务，且小积压 Event 查询只读客户请求的批量', async () => {
  const limits = [];
  const room = { roomId: '12345678', ...CURRENT_ROOM_VERSION, lifecycle: 'OPEN', eventSeq: 120,
    currentSessionId: 'session-1', members: [{ userId: 'host', memberId: 'member-host' }] };
  const db = {
    command: { gt: () => ({ and: () => ({}) }), lte: () => ({}) },
    async runTransaction() { throw new Error('sync 不应启动读事务'); },
    collection(name) {
      if (name === COLLECTIONS.rooms) {
        return { doc: () => ({ get: async () => ({ data: room }) }) };
      }
      const query = {
        where() { return query; },
        orderBy() { return query; },
        limit(size) { limits.push(size); return query; },
        async get() { return { data: [] }; }
      };
      return query;
    }
  };
  const repo = createCloudBaseRoomRepository({ db });

  await repo.readSyncState('12345678', 100, 25);

  assert.deepEqual(limits, [25]);
});

test('CloudBase 稳态 Sync 已追平时不再发起空 Event 查询', async () => {
  const accessed = [];
  const room = { roomId: '12345678', ...CURRENT_ROOM_VERSION, lifecycle: 'OPEN', eventSeq: 20,
    members: [{ userId: 'host', memberId: 'member-host' }] };
  const db = {
    command: { gt: () => ({ and: () => ({}) }), lte: () => ({}) },
    runTransaction: async () => { throw new Error('sync 不应启动读事务'); },
    collection(name) {
      accessed.push(name);
      if (name !== COLLECTIONS.rooms) throw new Error('已追平时不应查询 Event');
      return { doc: () => ({ get: async () => ({ data: room }) }) };
    }
  };
  const repo = createCloudBaseRoomRepository({ db });

  const result = await repo.readSyncState('12345678', 20, 100);

  assert.deepEqual(result.events, []);
  assert.deepEqual(accessed, [COLLECTIONS.rooms]);
});

test('CloudBase Presence 与 Signal 拒绝较旧请求覆盖较新时间戳', async () => {
  const presenceId = docId('12345678:member-host:device-1');
  const signalId = docId('12345678:PARTNER_SILENT_SOUND');
  const documents = new Map([
    [`${COLLECTIONS.rooms}:12345678`, {
      roomId: '12345678', ...CURRENT_ROOM_VERSION, lifecycle: 'OPEN',
      members: [{ userId: 'host', memberId: 'member-host' }],
      signalScope: {
        sessionId: 'session-1', turnId: 'turn-1', memberId: 'member-host', deadlineAt: 10000
      }
    }],
    [`${COLLECTIONS.presence}:${presenceId}`, {
      roomId: '12345678', memberId: 'member-host', deviceSessionId: 'device-1',
      lastSeenAt: 2000, online: true
    }],
    [`${COLLECTIONS.signals}:${signalId}`, {
      roomId: '12345678', signalType: 'PARTNER_SILENT_SOUND', value: 0.9,
      memberId: 'member-host', sessionId: 'session-1', turnId: 'turn-1',
      updatedAt: 2000, expiresAt: 5000
    }]
  ]);
  const transaction = {
    collection(name) {
      return {
        doc(id) {
          const key = `${name}:${id}`;
          return {
            async get() {
              if (!documents.has(key)) {
                throw Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
              }
              return { data: documents.get(key) };
            },
            async set({ data }) { documents.set(key, data); }
          };
        }
      };
    }
  };
  const db = {
    runTransaction: (callback) => callback(transaction),
    collection: (name) => transaction.collection(name)
  };
  const repo = createCloudBaseRoomRepository({ db });

  const presence = await repo.upsertPresence({
    roomId: '12345678', memberId: 'member-host', deviceSessionId: 'device-1', lastSeenAt: 1000
  });
  const signal = await repo.upsertSignal({
    roomId: '12345678', actorUserId: 'host', sessionId: 'session-1', turnId: 'turn-1',
    signalType: 'PARTNER_SILENT_SOUND', value: 0.1, now: 1000
  });

  assert.equal(presence.lastSeenAt, 2000);
  assert.equal(documents.get(`${COLLECTIONS.presence}:${presenceId}`).lastSeenAt, 2000);
  assert.equal(signal.ok, true);
  assert.equal(signal.signal.updatedAt, 2000);
  assert.equal(signal.signal.value, 0.9);
  assert.equal(documents.get(`${COLLECTIONS.signals}:${signalId}`).value, 0.9);
});

test('CloudBase Signal 按类型点读公开文档，已提交者可写入设计问题催促', async () => {
  const { SIGNAL_TYPES } = require('@cardboard/room-contracts');
  const soundId = docId('12345678:PARTNER_SILENT_SOUND');
  const nudgeId = docId('12345678:DESIGN_PROBLEM_NUDGE');
  const documents = new Map([
    [`${COLLECTIONS.rooms}:12345678`, {
      roomId: '12345678', ...CURRENT_ROOM_VERSION, lifecycle: 'OPEN',
      currentSessionId: 'session-1',
      members: [
        { userId: 'host', memberId: 'member-host' },
        { userId: 'u2', memberId: 'member-2' },
        { userId: 'u3', memberId: 'member-3' }
      ]
    }],
    [`${COLLECTIONS.sessions}:session-1`, {
      roomId: '12345678',
      sessionId: 'session-1',
      workflow: { step: 'COLLECT_DESIGN_PROBLEMS' },
      participants: [
        { memberId: 'member-host', status: 'ACTIVE' },
        { memberId: 'member-2', status: 'ACTIVE' },
        { memberId: 'member-3', status: 'ACTIVE' }
      ],
      progress: {
        contributionProgress: {
          requiredMemberIds: ['member-host', 'member-2', 'member-3'],
          submittedMemberIds: ['member-host', 'member-2']
        }
      }
    }],
    [`${COLLECTIONS.signals}:${soundId}`, {
      roomId: '12345678', signalType: SIGNAL_TYPES.PARTNER_SILENT_SOUND, value: 0.4,
      memberId: 'member-host', sessionId: 'session-1', turnId: 'turn-1',
      updatedAt: 1000, expiresAt: 4000
    }]
  ]);
  const store = {
    collection(name) {
      return {
        doc(id) {
          const key = `${name}:${id}`;
          return {
            async get() {
              if (!documents.has(key)) {
                throw Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
              }
              return { data: documents.get(key) };
            },
            async set({ data }) { documents.set(key, data); }
          };
        }
      };
    }
  };
  const db = {
    runTransaction: (callback) => callback(store),
    collection: (name) => store.collection(name)
  };
  const repo = createCloudBaseRoomRepository({ db });

  const listed = await repo.listSignals('12345678');
  const written = await repo.upsertSignal({
    roomId: '12345678', actorUserId: 'host', sessionId: 'session-1',
    signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE, now: 5000
  });
  const other = await repo.upsertSignal({
    roomId: '12345678', actorUserId: 'u2', sessionId: 'session-1',
    signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE, now: 5001
  });
  const replayAfterOther = await repo.upsertSignal({
    roomId: '12345678', actorUserId: 'host', sessionId: 'session-1',
    signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE, now: 5002
  });
  const rejected = await repo.upsertSignal({
    roomId: '12345678', actorUserId: 'u3', sessionId: 'session-1',
    signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE, now: 5003
  });
  const listedAfter = await repo.listSignals('12345678');

  assert.equal(listed.length, 1);
  assert.equal(listed[0].signalType, SIGNAL_TYPES.PARTNER_SILENT_SOUND);
  assert.equal(written.ok, true);
  assert.equal(written.signal.signalType, SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE);
  assert.equal(other.ok, true);
  assert.equal(other.signal.memberId, 'member-2');
  assert.equal(replayAfterOther.ok, true);
  assert.equal(replayAfterOther.signal.memberId, 'member-host');
  assert.equal(replayAfterOther.signal.updatedAt, written.signal.updatedAt);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errCode, 'INVALID_TRANSITION');
  assert.equal(listedAfter.length, 2);
  assert.equal(documents.get(`${COLLECTIONS.signals}:${nudgeId}`).memberId, 'member-2');
});

test('CloudBase 仅房主可在选题步骤写入设计问题编辑态', async () => {
  const { SIGNAL_TYPES } = require('@cardboard/room-contracts');
  const editingId = docId('12345678:DESIGN_PROBLEM_EDITING');
  const documents = new Map([
    [`${COLLECTIONS.rooms}:12345678`, {
      roomId: '12345678', ...CURRENT_ROOM_VERSION, lifecycle: 'OPEN',
      currentSessionId: 'session-1', hostMemberId: 'member-host',
      members: [
        { userId: 'host', memberId: 'member-host' },
        { userId: 'u2', memberId: 'member-2' }
      ]
    }],
    [`${COLLECTIONS.sessions}:session-1`, {
      roomId: '12345678',
      sessionId: 'session-1',
      workflow: { step: 'SELECT_DESIGN_PROBLEM', revision: 7 },
      participants: [
        { memberId: 'member-host', status: 'ACTIVE' },
        { memberId: 'member-2', status: 'ACTIVE' }
      ],
      facts: {
        contributions: {
          'session-1:DESIGN_PROBLEM:member-host': {
            contributionId: 'problem-1',
            sessionId: 'session-1',
            kind: 'DESIGN_PROBLEM',
            memberId: 'member-host',
            text: '如何让协作更顺畅？'
          }
        }
      }
    }]
  ]);
  const store = {
    collection(name) {
      return {
        doc(id) {
          const key = `${name}:${id}`;
          return {
            async get() {
              if (!documents.has(key)) {
                throw Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
              }
              return { data: documents.get(key) };
            },
            async set({ data }) { documents.set(key, data); }
          };
        }
      };
    }
  };
  const db = {
    runTransaction: (callback) => callback(store),
    collection: (name) => store.collection(name)
  };
  const repo = createCloudBaseRoomRepository({ db });

  const written = await repo.upsertSignal({
    roomId: '12345678', actorUserId: 'host', sessionId: 'session-1',
    workflowRevision: 7,
    signalType: SIGNAL_TYPES.DESIGN_PROBLEM_EDITING, value: 'problem-1', now: 5000
  });
  const rejected = await repo.upsertSignal({
    roomId: '12345678', actorUserId: 'u2', sessionId: 'session-1',
    workflowRevision: 7,
    signalType: SIGNAL_TYPES.DESIGN_PROBLEM_EDITING, value: 'problem-1', now: 5001
  });
  const cleared = await repo.upsertSignal({
    roomId: '12345678', actorUserId: 'host', sessionId: 'session-1',
    workflowRevision: 7,
    signalType: SIGNAL_TYPES.DESIGN_PROBLEM_EDITING, value: '', now: 5002
  });

  assert.equal(written.ok, true);
  assert.equal(written.signal.value, 'problem-1');
  assert.equal(written.signal.workflowRevision, 7);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errCode, 'HOST_REQUIRED');
  assert.equal(cleared.ok, true);
  assert.equal(cleared.signal.value, '');
  assert.equal(documents.get(`${COLLECTIONS.signals}:${editingId}`).expiresAt, 5002);
});

test('CloudBase 房间元数据命令不重复写 Session 和未变化的活跃索引', async () => {
  const missing = () => Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
  const documents = new Map([
    [`${COLLECTIONS.rooms}:12345678`, {
      roomId: '12345678', ...CURRENT_ROOM_VERSION,
      lifecycle: 'OPEN', currentSessionId: 'session-1', eventSeq: 1,
      members: [{ userId: 'host', memberId: 'member-host' }]
    }],
    [`${COLLECTIONS.sessions}:session-1`, {
      roomId: '12345678', sessionId: 'session-1', status: 'RUNNING', facts: {
        turns: {}, scores: {}, votes: {}, contributions: {}, artifacts: {}, messages: [], secrets: {}
      }
    }],
    [`${COLLECTIONS.active}:${docId('host')}`, {
      roomId: '12345678', userId: 'host', memberId: 'member-host'
    }]
  ]);
  const writes = [];
  const transaction = {
    collection(name) {
      return {
        doc(id) {
          const key = `${name}:${id}`;
          return {
            async get() {
              if (!documents.has(key)) throw missing();
              return { data: documents.get(key) };
            },
            async set({ data }) { writes.push([name, id]); documents.set(key, data); },
            async remove() { writes.push([name, id, 'remove']); documents.delete(key); }
          };
        }
      };
    }
  };
  const repo = createCloudBaseRoomRepository({ db: { runTransaction: (callback) => callback(transaction) } });

  await repo.transactCommand({
    scopeKey: '12345678', commandId: 'rename-only', actorUserId: 'host', roomId: '12345678',
    type: 'UPDATE_ROOM_PROFILE', requestHash: 'hash', createdAt: 2
  }, ({ aggregate }) => {
    aggregate.room.workshopName = '新名称';
    aggregate.room.eventSeq = 2;
    return { accepted: true, aggregate, dirtyFacts: [], events: [{ roomId: '12345678', seq: 2 }],
      outcome: { kind: 'ACCEPTED', committedThroughSeq: 2 } };
  });

  assert.equal(writes.some(([name]) => name === COLLECTIONS.sessions), false);
  assert.equal(writes.some(([name]) => name === COLLECTIONS.active), false);
  assert.equal(writes.some(([name]) => name === COLLECTIONS.rooms), true);
  assert.equal(writes.some(([name]) => name === COLLECTIONS.events), true);
});

test('CloudBase 命令把当前 Session 与 Facts 原子写入同一文档', async () => {
  const missing = () => Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
  const documents = new Map([
    [`${COLLECTIONS.rooms}:12345678`, {
      roomId: '12345678', ...CURRENT_ROOM_VERSION,
      lifecycle: 'OPEN', currentSessionId: 'session-1', eventSeq: 1,
      members: [{ userId: 'host', memberId: 'member-host' }]
    }],
    [`${COLLECTIONS.sessions}:session-1`, {
      roomId: '12345678', sessionId: 'session-1', status: 'RUNNING', facts: {
        turns: {}, scores: {}, votes: {}, contributions: {}, artifacts: {}, messages: [], secrets: {}
      }
    }]
  ]);
  const transaction = {
    collection(name) {
      return {
        doc(id) {
          const key = `${name}:${id}`;
          return {
            async get() {
              if (!documents.has(key)) throw missing();
              return { data: documents.get(key) };
            },
            async set({ data }) { documents.set(key, data); },
            async remove() { documents.delete(key); }
          };
        }
      };
    }
  };
  const repo = createCloudBaseRoomRepository({ db: { runTransaction: (callback) => callback(transaction) } });
  await repo.transactCommand({
    scopeKey: '12345678', commandId: 'command-2', actorUserId: 'host', roomId: '12345678',
    type: 'UPDATE_ROOM_PROFILE', requestHash: 'hash', createdAt: 2
  }, ({ aggregate }) => {
    aggregate.room.eventSeq = 2;
    aggregate.facts.scores.score1 = { scoreId: 'score1', scoreHalfSteps: 7 };
    return { accepted: true, aggregate, dirtyFacts: [], events: [{ roomId: '12345678', seq: 2 }],
      outcome: { kind: 'ACCEPTED', committedThroughSeq: 2 } };
  });

  const stored = documents.get(`${COLLECTIONS.sessions}:session-1`);
  assert.equal(stored.roomId, '12345678');
  assert.equal(stored.facts.scores.score1.scoreHalfSteps, 7);
  assert.equal(documents.has(`${COLLECTIONS.events}:12345678_000000000002`), true);
});
