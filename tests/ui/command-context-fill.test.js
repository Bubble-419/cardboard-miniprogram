'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commandContext } = require('../../modules/room-session/index');
const { validateCommandEnvelope } = require('../../packages/room-contracts/index');

const VIEW = {
  session: {
    sessionId: 'sess-ready',
    activeTurn: { turnId: 'turn-ready' },
    workflow: { step: 'PARTNER_TURN' }
  }
};

function withRoomView(view, fn) {
  const previous = global.getApp;
  global.getApp = () => ({ globalData: { roomSession: { getView: () => view } } });
  try {
    return fn();
  } finally {
    global.getApp = previous;
  }
}

test('USE_PARTNER_SPECIAL 空字符串 sessionId/turnId 从当前 View 补齐', () => {
  withRoomView(VIEW, () => {
    const filled = commandContext('USE_PARTNER_SPECIAL', { sessionId: '', turnId: '' });
    assert.equal(filled.sessionId, 'sess-ready');
    assert.equal(filled.turnId, 'turn-ready');

    const validated = validateCommandEnvelope({
      protocolVersion: 3,
      commandId: 'cmd-special-1',
      roomId: '12345678',
      type: 'USE_PARTNER_SPECIAL',
      context: filled,
      payload: { kind: 'MASTER' }
    });
    assert.equal(validated.ok, true, validated.errMsg);
  });
});
