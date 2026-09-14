'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublicPatch, applyPublicPatch } = require('@cardboard/room-projection');
const { createHarness } = require('../helpers/room-v3');

function collectUnsafeStorageFields(value, parentPath, result) {
  const path = parentPath || '';
  const unsafe = result || [];
  if (!value || typeof value !== 'object') return unsafe;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnsafeStorageFields(item, `${path}[${index}]`, unsafe));
    return unsafe;
  }
  Object.entries(value).forEach(([key, child]) => {
    const fieldPath = path ? `${path}.${key}` : key;
    if (key.startsWith('$') || key.includes('.')) unsafe.push(fieldPath);
    collectUnsafeStorageFields(child, fieldPath, unsafe);
  });
  return unsafe;
}

test('公开补丁使用可被 CloudBase 存储的字段结构且仍可正确应用', () => {
  const before = { room: { roomId: '12345678', members: [] }, session: null };
  const after = { room: { roomId: '12345678', members: [{ memberId: 'm1' }] }, session: null };
  const rootPatch = createPublicPatch(null, before);
  const nestedPatch = createPublicPatch(before, after);

  assert.deepEqual(collectUnsafeStorageFields(rootPatch), []);
  assert.deepEqual(collectUnsafeStorageFields(nestedPatch), []);
  assert.deepEqual(applyPublicPatch(null, rootPatch), before);
  assert.deepEqual(applyPublicPatch(before, nestedPatch), after);
});

test('创建和加入房间生成的完整事件不含 CloudBase 非法字段名', async () => {
  const harness = createHarness();
  await harness.command('host', 'CREATE_ROOM', { payload: { nickName: '房主' } });
  await harness.command('member', 'JOIN_ROOM', { payload: { nickName: '成员' } });

  const events = harness.repo.events.get('12345678');
  assert.equal(events.length, 2);
  assert.deepEqual(collectUnsafeStorageFields(events), []);
});
