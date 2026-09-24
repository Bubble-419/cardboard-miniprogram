'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getRoomPageSnapshot, getRoomSessionPageSnapshot
} = require('../../modules/room-session/index');

test('页面初始化不会在刚结束的 Command/Query 后重复请求 Snapshot', async () => {
  const originalGetApp = global.getApp;
  let refreshCalls = 0;
  const state = {
    status: 'READY', roomId: '12345678', lastRequestCompletedAt: Date.now()
  };
  global.getApp = () => ({
    globalData: {
      roomSession: {
        roomId: '12345678',
        getState: () => state,
        getSnapshot: () => ({ ok: true, roomId: '12345678', members: [{}] }),
        refresh: async () => { refreshCalls += 1; }
      }
    }
  });
  try {
    const recent = await getRoomPageSnapshot('12345678', { refresh: true });
    assert.equal(recent.ok, true);
    assert.equal(refreshCalls, 0);

    state.lastRequestCompletedAt = Date.now() - 2001;
    await getRoomPageSnapshot('12345678', { refresh: true });
    assert.equal(refreshCalls, 1);
  } finally {
    global.getApp = originalGetApp;
  }
});

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
