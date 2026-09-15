'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROTOCOL_VERSION } = require('@cardboard/room-contracts');
const {
  createRoomApplication,
  createInMemoryRoomRepository,
  deriveCommandSeed,
  deterministicRandom
} = require('@cardboard/room-application');

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
