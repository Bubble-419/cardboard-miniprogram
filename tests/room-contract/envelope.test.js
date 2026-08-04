'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PROTOCOL_VERSION,
  COMMAND_TYPES,
  ERR,
  validateCommandEnvelope
} = require('@cardboard/room-contracts');

describe('room-contracts envelope', () => {
  it('accepts CREATE_ROOM without roomId/revision', () => {
    const res = validateCommandEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      commandId: 'cmd-create-1',
      type: COMMAND_TYPES.CREATE_ROOM,
      payload: {}
    });
    assert.equal(res.ok, true);
    assert.equal(res.envelope.type, COMMAND_TYPES.CREATE_ROOM);
  });

  it('requires expectedRevision for LEAVE_ROOM', () => {
    const res = validateCommandEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      roomId: '12345678',
      commandId: 'cmd-leave-1',
      type: COMMAND_TYPES.LEAVE_ROOM,
      payload: {}
    });
    assert.equal(res.ok, false);
    assert.equal(res.errCode, ERR.INVALID_ARGUMENT);
  });

  it('rejects unknown type', () => {
    const res = validateCommandEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      roomId: '12345678',
      commandId: 'cmd-x',
      type: 'NOPE',
      expectedRevision: 1
    });
    assert.equal(res.ok, false);
  });
});
