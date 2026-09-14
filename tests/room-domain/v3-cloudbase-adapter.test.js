'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeGet, createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');

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
