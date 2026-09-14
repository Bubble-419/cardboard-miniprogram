'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  commandEnvelopeFromEvent
} = require('../../cloudfunctions/roomCommand/src/transport');

test('roomCommand 只从 command 字段读取协议对象', () => {
  const command = { type: 'CREATE_ROOM', unexpected: '仍由协议校验拒绝' };
  const extracted = commandEnvelopeFromEvent({
    command,
    tcbContext: { env: 'shared-env' },
    runtimeMetadata: '不属于 Command'
  });

  assert.equal(extracted, command);
  assert.equal(extracted.unexpected, '仍由协议校验拒绝');
  assert.equal(extracted.tcbContext, undefined);
});

test('roomCommand 发布切换期间兼容平铺命令并仅剔除 tcbContext', () => {
  const extracted = commandEnvelopeFromEvent({
    protocolVersion: 3,
    type: 'CREATE_ROOM',
    unexpected: '不能被静默丢弃',
    tcbContext: { env: 'shared-env' }
  });

  assert.equal(extracted.type, 'CREATE_ROOM');
  assert.equal(extracted.tcbContext, undefined);
  assert.equal(extracted.unexpected, '不能被静默丢弃');
});
