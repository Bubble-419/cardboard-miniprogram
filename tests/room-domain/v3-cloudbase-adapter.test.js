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

test('CloudBase Adapter 只把“文档不存在”解释为空值', async () => {
  const missing = Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
  assert.equal(await safeGet(storeRejecting(missing), 'rooms', 'x'), null);

  const network = Object.assign(new Error('network timeout'), { code: 'NETWORK_ERROR' });
  await assert.rejects(() => safeGet(storeRejecting(network), 'rooms', 'x'), /network timeout/);
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
