'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeGet } = require('@cardboard/room-cloudbase-adapter');

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
