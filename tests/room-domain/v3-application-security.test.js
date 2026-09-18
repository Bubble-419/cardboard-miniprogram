'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROTOCOL_VERSION } = require('@cardboard/room-contracts');
const {
  createRoomApplication,
  deriveCommandSeed,
  deterministicRandom
} = require('@cardboard/room-application');
const { createInMemoryRoomRepository } = require('../../packages/room-application/testing');
const { createHarness } = require('../helpers/room-v3');

test('领域随机种子由服务端密钥 HMAC 派生且重试可复现', () => {
  const a1 = deriveCommandSeed('secret-a', '12345678', 'command-1', 'domain');
  const a2 = deriveCommandSeed('secret-a', '12345678', 'command-1', 'domain');
  const b = deriveCommandSeed('secret-b', '12345678', 'command-1', 'domain');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  const random1 = deterministicRandom(a1);
  const random2 = deterministicRandom(a2);
  assert.deepEqual([random1(), random1(), random1()], [random2(), random2(), random2()]);
});

test('缺少 ROOM_PROTOCOL_SERVER_SECRET 时拒绝执行写指令', async () => {
  const app = createRoomApplication(createInMemoryRoomRepository({
    generateRoomId: () => '12345678'
  }), { now: () => 1000 });
  const result = await app.executeCommand({
    protocolVersion: PROTOCOL_VERSION,
    commandId: 'create-without-secret',
    roomId: '',
    knownSeq: 0,
    type: 'CREATE_ROOM',
    context: {},
    payload: { nickName: '房主' }
  }, { userId: 'host' });
  assert.equal(result.errCode, 'INTERNAL_ERROR');
  assert.match(result.errMsg, /ROOM_PROTOCOL_SERVER_SECRET/);
});

test('Session/Facts 超过安全预算时在事务提交前拒绝继续膨胀', async () => {
  const h = createHarness({ maxSessionDocumentBytes: 16 * 1024 });
  await h.seedMembers(2);
  const started = await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  assert.equal(started.ok, true);
  const aggregate = h.repo.rooms.get('12345678');
  aggregate.facts.messages.push({ messageId: 'oversized', text: 'x'.repeat(20 * 1024) });
  const beforeSeq = aggregate.room.eventSeq;

  const result = await h.command('host', 'UPDATE_ROOM_PROFILE', {
    payload: { workshopName: '不应提交' }
  });

  assert.equal(result.errCode, 'LIMIT_EXCEEDED');
  assert.equal(h.repo.rooms.get('12345678').room.eventSeq, beforeSeq);
  assert.notEqual(h.repo.rooms.get('12345678').room.workshopName, '不应提交');
});

test('Command 已提交后附带 Sync 失败仍返回成功且不伪造同步结果', async () => {
  const base = createInMemoryRoomRepository({ generateRoomId: () => '12345678' });
  let failSync = false;
  const repo = {
    ...base,
    async readSyncState(...args) {
      if (failSync) throw new Error('sync dependency unavailable');
      return base.readSyncState(...args);
    }
  };
  const app = createRoomApplication(repo, { now: () => 1000, serverSecret: 'test-secret' });
  const create = await app.executeCommand({
    protocolVersion: PROTOCOL_VERSION, commandId: 'create-before-sync-failure', roomId: '', knownSeq: 0,
    type: 'CREATE_ROOM', context: {}, payload: { nickName: '房主' }
  }, { userId: 'host' });
  assert.equal(create.ok, true);
  failSync = true;

  const updated = await app.executeCommand({
    protocolVersion: PROTOCOL_VERSION, commandId: 'accepted-with-sync-failure', roomId: '12345678', knownSeq: 0,
    type: 'UPDATE_ROOM_PROFILE', context: {}, payload: { workshopName: '已提交' }
  }, { userId: 'host' });

  assert.equal(updated.ok, true);
  assert.equal(updated.commandId, 'accepted-with-sync-failure');
  assert.equal(updated.sync, undefined);
  assert.equal(base.rooms.get('12345678').room.workshopName, '已提交');
});

test('水位已跟上时 Command 用事务内 Event 内联 Sync，不再二次读库', async () => {
  const h = createHarness();
  await h.seedMembers(1);
  let syncReads = 0;
  const original = h.repo.readSyncState.bind(h.repo);
  h.repo.readSyncState = async (...args) => {
    syncReads += 1;
    return original(...args);
  };
  const renamed = await h.command('host', 'UPDATE_ROOM_PROFILE', {
    payload: { workshopName: '内联同步' }
  });
  assert.equal(renamed.ok, true);
  assert.equal(syncReads, 0);
  assert.equal(renamed.sync.delivery, 'EVENTS');
  assert.equal(renamed.sync.hasMore, false);
  assert.equal(renamed.sync.events.length, 1);
  assert.equal(renamed.sync.ephemeral.stale.presence, true);
  assert.equal(renamed.sync.ephemeral.stale.signals, true);
  assert.equal((await h.snapshot('host')).view.room.workshopName, '内联同步');
});

test('客户端水位落后时 Command 仍走完整 Sync', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  let syncReads = 0;
  const original = h.repo.readSyncState.bind(h.repo);
  h.repo.readSyncState = async (...args) => {
    syncReads += 1;
    return original(...args);
  };
  const renamed = await h.command('host', 'UPDATE_ROOM_PROFILE', {
    knownSeq: 0,
    payload: { workshopName: '补齐同步' }
  });
  assert.equal(renamed.ok, true);
  assert.ok(syncReads >= 1);
  assert.equal(renamed.sync.delivery, 'EVENTS');
});
