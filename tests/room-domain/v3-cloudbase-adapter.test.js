'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLLECTIONS,
  safeGet,
  docId,
  createCloudBaseRoomRepository
} = require('@cardboard/room-cloudbase-adapter');

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
                return guardedResult({ _id: id, roomId: id, lifecycle: 'OPEN',
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
      roomId: '12345678', lifecycle: 'OPEN',
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

test('CloudBase 高频 Sync 只读取轻量 Room 与统一事件流', async () => {
  const accessedCollections = [];
  const room = { roomId: '12345678', lifecycle: 'OPEN', eventSeq: 3,
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
      runTransaction: (callback) => callback(transaction)
    }
  });

  const result = await repo.readSyncState('12345678', 2, 100);
  assert.equal(result.room.currentSessionId, 'session-1');
  assert.deepEqual(result.events.map((event) => event.seq), [3]);
  assert.deepEqual(accessedCollections, [COLLECTIONS.rooms, COLLECTIONS.events]);
});

test('CloudBase 命令把当前 Session 与 Facts 原子写入同一文档', async () => {
  const missing = () => Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
  const documents = new Map([
    [`${COLLECTIONS.rooms}:12345678`, {
      roomId: '12345678', lifecycle: 'OPEN', currentSessionId: 'session-1', eventSeq: 1,
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
