'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

async function invokeList(event) {
  const originalLoad = Module._load;
  const entryPath = require.resolve('../../cloudfunctions/listInspirations/index');
  const calls = [];
  Module._load = function loadWithCloudMock(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      const query = {
        orderBy(field, direction) {
          calls.push(['orderBy', field, direction]);
          return this;
        },
        limit(value) {
          calls.push(['limit', value]);
          return this;
        },
        async get() { return { data: [] }; }
      };
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        getWXContext() { return { OPENID: 'user-1' }; },
        database() {
          return {
            collection(name) {
              calls.push(['collection', name]);
              return {
                where(condition) {
                  calls.push(['where', condition]);
                  return query;
                }
              };
            }
          };
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[entryPath];
  try {
    const result = await require(entryPath).main(event);
    return { result, calls };
  } finally {
    Module._load = originalLoad;
    delete require.cache[entryPath];
  }
}

test('灵感列表把用户、房间和场次过滤下推到数据库并按更新时间读取', async () => {
  const { result, calls } = await invokeList({ roomId: '12345678', sessionId: 'session-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['collection', 'inspirations'],
    ['where', { userId: 'user-1', roomId: '12345678', sessionId: 'session-1' }],
    ['orderBy', 'updateTime', 'desc'],
    ['limit', 100]
  ]);
});

test('工作坊灵感只按用户与房间查询，不在内存扫描其他场次', async () => {
  const { result, calls } = await invokeList({ roomId: '12345678', workshopOnly: true });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.find((call) => call[0] === 'where'), [
    'where', { userId: 'user-1', roomId: '12345678' }
  ]);
});
