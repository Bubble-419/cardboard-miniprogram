'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const app = { globalData: { roomId: null } };
const storage = new Map();

global.getApp = () => app;
global.getCurrentPages = () => [{ route: 'pages/main-pages/aaa/index' }];
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
  showToast() {}
};

function roomSnapshot(roomId) {
  return {
    ok: true,
    roomId,
    isHost: true,
    workshopName: '已恢复的房间',
    createdAt: 1000,
    members: [{ isMe: true, nickName: '房主', avatarUrl: '' }]
  };
}

function loadHomePage(roomSession) {
  const pagePath = require.resolve('../../pages/main-pages/aaa/index');
  const roomSessionPath = require.resolve('../../modules/room-session/index');
  const previousRoomSession = require.cache[roomSessionPath];
  require.cache[roomSessionPath] = {
    id: roomSessionPath,
    filename: roomSessionPath,
    loaded: true,
    exports: roomSession
  };
  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  delete require.cache[pagePath];
  require(pagePath);
  if (previousRoomSession) require.cache[roomSessionPath] = previousRoomSession;
  else delete require.cache[roomSessionPath];
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); }
  };
}

test.beforeEach(() => {
  storage.clear();
  app.globalData.roomId = null;
});

test('首页本地房间号丢失时从服务端 current 恢复房间', async () => {
  let currentCalls = 0;
  const page = loadHomePage({
    async getCurrentRoomPageSnapshot() {
      currentCalls += 1;
      return roomSnapshot('12345678');
    },
    async getRoomPageSnapshot() {
      throw new Error('恢复结果已包含 Snapshot，不应重复请求');
    },
    async dispatchRoomCommand() { return { ok: true }; }
  });

  await page.loadJoinedRoomState();

  assert.equal(currentCalls, 1);
  assert.equal(page.data.isJoinedRoom, true);
  assert.equal(page.data.roomId, '12345678');
  assert.equal(storage.get('joinedRoomId'), '12345678');
  assert.equal(app.globalData.roomId, '12345678');
});

test('首页快照遇到临时错误时保留本地房间状态', async () => {
  storage.set('joinedRoomId', '12345678');
  const page = loadHomePage({
    async getCurrentRoomPageSnapshot() {
      return { ok: false, errCode: -501001,
        errMsg: '[ResourceUnavailable.TransactionBusy] Transaction is busy' };
    },
    async dispatchRoomCommand() { return { ok: true }; }
  });

  await page.loadJoinedRoomState();

  assert.equal(storage.get('joinedRoomId'), '12345678');
  assert.equal(app.globalData.roomId, '12345678');
  assert.equal(page.data.isJoinedRoom, true);
  assert.equal(page.data.roomId, '12345678');
});

test('首页只在服务端明确返回已离房时清除本地房间', async () => {
  storage.set('joinedRoomId', '12345678');
  const page = loadHomePage({
    async getCurrentRoomPageSnapshot() {
      return { ok: true, roomId: null };
    },
    async dispatchRoomCommand() { return { ok: true }; }
  });

  await page.loadJoinedRoomState();

  assert.equal(storage.has('joinedRoomId'), false);
  assert.equal(page.data.isJoinedRoom, false);
});

test('首页以 current-room 为准，忽略过期的本地房间号', async () => {
  storage.set('joinedRoomId', '11111111');
  app.globalData.roomId = '11111111';
  const page = loadHomePage({
    async getCurrentRoomPageSnapshot() {
      return roomSnapshot('22222222');
    },
    async dispatchRoomCommand() { return { ok: true }; }
  });

  await page.loadJoinedRoomState();

  assert.equal(page.data.roomId, '22222222');
  assert.equal(storage.get('joinedRoomId'), '22222222');
  assert.equal(app.globalData.roomId, '22222222');
});
