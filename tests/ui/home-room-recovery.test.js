'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const app = { globalData: { roomId: null } };

function loadHomePage(roomSessionExports) {
  const roomSessionPath = require.resolve('../../modules/room-session/index');
  const pagePath = require.resolve('../../pages/main-pages/aaa/index');
  const previousRoomSession = require.cache[roomSessionPath];
  require.cache[roomSessionPath] = {
    id: roomSessionPath,
    filename: roomSessionPath,
    loaded: true,
    exports: roomSessionExports
  };

  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  global.getApp = () => app;
  delete require.cache[pagePath];
  require(pagePath);

  if (previousRoomSession) require.cache[roomSessionPath] = previousRoomSession;
  else delete require.cache[roomSessionPath];
  return definition;
}

function makePage(definition) {
  return {
    ...definition,
    data: { ...definition.data, loading: false },
    setData(patch) { Object.assign(this.data, patch); }
  };
}

test('创建命令返回 ALREADY_IN_ROOM 时恢复服务端当前房间，而不是让账号卡死', async () => {
  const storage = new Map();
  const toasts = [];
  let redirectedUrl = '';
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    showToast: (options) => toasts.push(options.title),
    redirectTo(options) {
      redirectedUrl = options.url;
      if (options.success) options.success({});
    },
    reLaunch(options) {
      redirectedUrl = options.url;
      if (options.success) options.success({});
    }
  };

  const definition = loadHomePage({
    dispatchRoomCommand: async () => ({
      ok: false,
      errCode: 'ALREADY_IN_ROOM',
      errMsg: '已经加入其他房间'
    }),
    getRoomPageSnapshot: async () => ({
      ok: true,
      roomId: '87654321',
      members: [{ memberId: 'member-1', isMe: true }],
      isHost: true
    })
  });
  const page = makePage(definition);

  await page._handleCreateRoom();

  assert.equal(redirectedUrl, '/pages/main-pages/addPlayer/index?roomId=87654321');
  assert.equal(storage.get('joinedRoomId'), '87654321');
  assert.equal(app.globalData.roomId, '87654321');
  assert.equal(toasts.includes('已经加入其他房间'), false);
});

test('首页本地没有 roomId 时仍从服务端恢复已加入的房间', async () => {
  const storage = new Map();
  app.globalData.roomId = null;
  let snapshotRoomIdArgument = null;
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    showToast() {}
  };

  const definition = loadHomePage({
    dispatchRoomCommand: async () => ({ ok: true }),
    getRoomPageSnapshot: async (roomId) => {
      snapshotRoomIdArgument = roomId;
      return {
        ok: true,
        roomId: '87654321',
        members: [{ memberId: 'member-1', isMe: true, nickName: '房主' }],
        isHost: true,
        workshopName: '恢复的房间',
        createdAt: 1
      };
    }
  });
  const page = makePage(definition);

  await page.loadJoinedRoomState();

  assert.equal(snapshotRoomIdArgument, '', '空本地状态应触发 current-room 发现');
  assert.equal(page.data.isJoinedRoom, true);
  assert.equal(page.data.roomId, '87654321');
  assert.equal(storage.get('joinedRoomId'), '87654321');
  assert.equal(app.globalData.roomId, '87654321');
});

test('首页本地 roomId 已过期时改用服务端当前房间', async () => {
  const storage = new Map([['joinedRoomId', '11111111']]);
  app.globalData.roomId = '11111111';
  const snapshotArguments = [];
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    showToast() {}
  };

  const definition = loadHomePage({
    dispatchRoomCommand: async () => ({ ok: true }),
    getRoomPageSnapshot: async (roomId) => {
      snapshotArguments.push(roomId);
      if (roomId) {
        return { ok: false, roomId, errCode: 'ALREADY_IN_ROOM', errMsg: '当前账号属于其他房间' };
      }
      return {
        ok: true,
        roomId: '87654321',
        members: [{ memberId: 'member-1', isMe: true }],
        isHost: false
      };
    }
  });
  const page = makePage(definition);

  await page.loadJoinedRoomState();

  assert.deepEqual(snapshotArguments, ['11111111', '']);
  assert.equal(page.data.roomId, '87654321');
  assert.equal(storage.get('joinedRoomId'), '87654321');
  assert.equal(app.globalData.roomId, '87654321');
});
