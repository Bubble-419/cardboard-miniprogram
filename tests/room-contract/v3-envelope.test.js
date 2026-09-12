'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROTOCOL_VERSION, COMMAND_TYPES, COMMAND_CONTEXT, validateCommandEnvelope } = require('@cardboard/room-contracts');

function envelope(type, fields) {
  return { protocolVersion: PROTOCOL_VERSION, commandId: 'cmd-1', roomId: '12345678', knownSeq: 0,
    type, context: {}, payload: {}, ...(fields || {}) };
}

test('V3 CREATE_ROOM 不需要 roomId，knownSeq 不参与并发裁决', () => {
  const create = validateCommandEnvelope(envelope(COMMAND_TYPES.CREATE_ROOM, { roomId: '' }));
  assert.equal(create.ok, true);
  const leave = validateCommandEnvelope(envelope(COMMAND_TYPES.LEAVE_ROOM, { knownSeq: 999 }));
  assert.equal(leave.ok, true);
  assert.equal(Object.hasOwn(leave.envelope, 'expectedRevision'), false);
});

test('按命令注册表验证精确上下文令牌', () => {
  const invalid = validateCommandEnvelope(envelope(COMMAND_TYPES.SUBMIT_PARTNER_SCORE,
    { payload: { scoreHalfSteps: 7 }, context: { sessionId: 's1' } }));
  assert.equal(invalid.ok, false);
  assert.match(invalid.errMsg, /turnId/);
  const valid = validateCommandEnvelope(envelope(COMMAND_TYPES.SUBMIT_PARTNER_SCORE,
    { payload: { scoreHalfSteps: 7 }, context: { sessionId: 's1', turnId: 't1' } }));
  assert.equal(valid.ok, true);
  assert.deepEqual(COMMAND_CONTEXT.SUBMIT_SPY_VOTE, ['sessionId', 'gameId', 'voteSessionId']);
});

test('拒绝未知协议、未知命令和非法半星值', () => {
  assert.equal(validateCommandEnvelope(envelope('PATCH_ROOM')).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM, { protocolVersion: 2 })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.SUBMIT_PARTNER_SCORE,
    { payload: { scoreHalfSteps: 7.5 }, context: { sessionId: 's', turnId: 't' } })).ok, false);
});
