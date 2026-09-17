'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getRoomSessionPageSnapshot } = require('../../modules/room-session/index');

test('Partner 历史消息分页失败时不得返回缺消息的伪成功页面', async () => {
  const originalGetApp = global.getApp;
  const failure = { ok: false, errCode: 'DEPENDENCY_UNAVAILABLE', errMsg: '消息索引暂不可用' };
  global.getApp = () => ({
    globalData: {
      roomSession: {
        sessionSnapshot: async () => ({
          ok: true,
          roomId: '12345678',
          sessionId: 'session-1',
          view: { session: { mode: 'PARTNER', recentMessages: [] } }
        }),
        messages: async () => failure
      }
    }
  });
  try {
    const result = await getRoomSessionPageSnapshot('12345678', 'session-1');
    assert.deepEqual(result, failure);
  } finally {
    global.getApp = originalGetApp;
  }
});
