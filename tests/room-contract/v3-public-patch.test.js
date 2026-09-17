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

test('数组变化使用 splice 增量而不是重复发送完整数组', () => {
  const before = {
    room: {
      roomId: '12345678',
      members: Array.from({ length: 100 }, (_, index) => ({ memberId: `m${index}`, seatNo: index + 1 }))
    },
    session: null
  };
  const after = JSON.parse(JSON.stringify(before));
  after.room.members.push({ memberId: 'm100', seatNo: 101 });

  const patch = createPublicPatch(before, after);

  assert.deepEqual(patch.set, []);
  assert.deepEqual(patch.remove, []);
  assert.deepEqual(patch.splice, [{
    path: 'room.members', index: 100, deleteCount: 0,
    items: [{ memberId: 'm100', seatNo: 101 }]
  }]);
  assert.deepEqual(applyPublicPatch(before, patch), after);
  assert.ok(JSON.stringify(patch).length < JSON.stringify(after.room.members).length / 4);
});

test('数组中部删除通过单个 splice 精确还原且不产生稀疏数组', () => {
  const before = { room: { roomId: '12345678', members: ['a', 'b', 'c', 'd'] }, session: null };
  const after = { room: { roomId: '12345678', members: ['a', 'd'] }, session: null };
  const patch = createPublicPatch(before, after);

  assert.deepEqual(patch.splice, [{
    path: 'room.members', index: 1, deleteCount: 2, items: []
  }]);
  const reduced = applyPublicPatch(before, patch);
  assert.deepEqual(reduced, after);
  assert.equal(Object.keys(reduced.room.members).length, reduced.room.members.length);
});

test('创建和加入房间生成的完整事件不含 CloudBase 非法字段名', async () => {
  const harness = createHarness();
  await harness.command('host', 'CREATE_ROOM', { payload: { nickName: '房主' } });
  await harness.command('member', 'JOIN_ROOM', { payload: { nickName: '成员' } });

  const events = harness.repo.events.get('12345678');
  assert.equal(events.length, 2);
  assert.deepEqual(collectUnsafeStorageFields(events), []);
});
