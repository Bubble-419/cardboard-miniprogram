'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commandContext, dispatchRoomCommand } = require('../../modules/room-session/index');
const { validateCommandEnvelope } = require('../../packages/room-contracts/index');

const VIEW = {
  session: {
    sessionId: 'sess-ready',
    activeTurn: { turnId: 'turn-ready' },
    workflow: { step: 'PARTNER_TURN', revision: 1 }
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

test('非房间按钮携带脏 roomId 时回退到当前有效房间，不把协议错误传给用户', async () => {
  const previous = global.getApp;
  let dispatched = null;
  global.getApp = () => ({
    globalData: {
      roomId: 'undefined',
      roomSession: {
        roomId: '12345678',
        getView: () => null,
        dispatch: async (input) => {
          dispatched = input;
          return { ok: true };
        }
      }
    }
  });
  try {
    const result = await dispatchRoomCommand(
      'UPDATE_MEMBER_PROFILE',
      { nickName: '测试用户' },
      {},
      { roomId: 'undefined' }
    );
    assert.equal(result.ok, true);
    assert.equal(dispatched.roomId, '12345678');
  } finally {
    global.getApp = previous;
  }
});

test('没有有效房间上下文时在客户端拦截业务指令，不请求云端 roomId 校验', async () => {
  const previous = global.getApp;
  let dispatchCount = 0;
  global.getApp = () => ({
    globalData: {
      roomId: '',
      roomSession: {
        roomId: null,
        getView: () => null,
        dispatch: async () => {
          dispatchCount += 1;
          return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'roomId 必须是 8 位数字' };
        }
      }
    }
  });
  try {
    const result = await dispatchRoomCommand('UPDATE_MEMBER_PROFILE', { nickName: '测试用户' });
    assert.equal(dispatchCount, 0);
    assert.equal(result.errCode, 'DEPENDENCY_UNAVAILABLE');
    assert.doesNotMatch(result.errMsg, /8 位数字/);
  } finally {
    global.getApp = previous;
  }
});
