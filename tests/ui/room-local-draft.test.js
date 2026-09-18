'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  storageKey, readRoomLocalDraft, writeRoomLocalDraft, clearRoomLocalDraft
} = require('../../utils/roomLocalDraft');

test('房间本地草稿按 room/session/turn 隔离，并可在页面重建后恢复', () => {
  const originalWx = global.wx;
  const originalNow = Date.now;
  const storage = new Map();
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key)
  };
  Date.now = () => 1000;
  const scope = { roomId: '12345678', sessionId: 'session-1', turnId: 'turn-1' };
  try {
    assert.match(storageKey('PARTNER_CLOSING_REVIEW', scope), /12345678/);
    assert.equal(writeRoomLocalDraft('PARTNER_CLOSING_REVIEW', scope, {
      text: '未发送的复盘草稿', editingKey: 'artifact-1'
    }), true);
    assert.deepEqual(readRoomLocalDraft('PARTNER_CLOSING_REVIEW', scope), {
      text: '未发送的复盘草稿', editingKey: 'artifact-1', updatedAt: 1000
    });
    assert.equal(readRoomLocalDraft('PARTNER_CLOSING_REVIEW', {
      ...scope, turnId: 'turn-2'
    }), null);
    assert.equal(clearRoomLocalDraft('PARTNER_CLOSING_REVIEW', scope), true);
    assert.equal(readRoomLocalDraft('PARTNER_CLOSING_REVIEW', scope), null);
  } finally {
    global.wx = originalWx;
    Date.now = originalNow;
  }
});

test('过期草稿会被清理，不能串入很久后的房间流程', () => {
  const originalWx = global.wx;
  const originalNow = Date.now;
  const storage = new Map();
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key)
  };
  const scope = { roomId: '12345678', sessionId: 'session-1', turnId: 'turn-1' };
  try {
    Date.now = () => 1000;
    writeRoomLocalDraft('PARTNER_CLOSING_REVIEW', scope, { text: '旧草稿' });
    Date.now = () => 8 * 24 * 60 * 60 * 1000;
    assert.equal(readRoomLocalDraft('PARTNER_CLOSING_REVIEW', scope), null);
    assert.equal(storage.size, 0);
  } finally {
    global.wx = originalWx;
    Date.now = originalNow;
  }
});
