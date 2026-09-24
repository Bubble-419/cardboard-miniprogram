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
  delete require.cache[pagePath];
  require(pagePath);
  if (previousRoomSession) require.cache[roomSessionPath] = previousRoomSession;
  else delete require.cache[roomSessionPath];
  return {
    ...definition,
    data: { ...definition.data, loading: false },
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

test('创建命令返回 ALREADY_IN_ROOM 时恢复服务端当前房间，而不是让账号卡死', async () => {
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

  const page = loadHomePage({
    dispatchRoomCommand: async () => ({
      ok: false,
      errCode: 'ALREADY_IN_ROOM',
      errMsg: '已经加入其他房间'
    }),
    getCurrentRoomPageSnapshot: async () => roomSnapshot('87654321'),
    getRoomPageSnapshot: async () => ({
      ok: true,
      roomId: '87654321',
      members: [{ memberId: 'member-1', isMe: true }],
      isHost: true
    })
  });

  await page._handleCreateRoom();

  assert.equal(redirectedUrl, '/pages/main-pages/addPlayer/index?roomId=87654321');
  assert.equal(storage.get('joinedRoomId'), '87654321');
  assert.equal(app.globalData.roomId, '87654321');
  assert.equal(toasts.includes('已经加入其他房间'), false);
});

test('创建房间遇到 -504002 时先恢复服务端当前房间', async () => {
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

  const page = loadHomePage({
    dispatchRoomCommand: async () => {
      const error = new Error('cloud.callFunction:fail Error: errCode: -504002');
      error.errCode = -504002;
      error.errMsg = 'cloud.callFunction:fail Error: errCode: -504002';
      throw error;
    },
    getCurrentRoomPageSnapshot: async () => roomSnapshot('87654321'),
    getRoomPageSnapshot: async () => roomSnapshot('87654321')
  });

  await page._handleCreateRoom();

  assert.equal(redirectedUrl, '/pages/main-pages/addPlayer/index?roomId=87654321');
  assert.equal(toasts.length, 0);
});

test('创建房间遇到 -504002 且没有当前房间时提示重新部署，不展示原始 errMsg', async () => {
  const toasts = [];
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    showToast: (options) => toasts.push(options.title),
    redirectTo() {},
    reLaunch() {}
  };

  const page = loadHomePage({
    dispatchRoomCommand: async () => {
      const error = new Error('cloud.callFunction:fail Error: errCode: -504002');
      error.errCode = -504002;
      error.errMsg = 'cloud.callFunction:fail Error: errCode: -504002';
      throw error;
    },
    getCurrentRoomPageSnapshot: async () => ({ ok: true, roomId: null }),
    getRoomPageSnapshot: async () => ({ ok: true, roomId: null })
  });

  await page._handleCreateRoom();

  assert.deepEqual(toasts, ['云函数执行失败，请重新部署']);
});

test('首页 onLoad/onShow 的并发房间发现复用同一请求', async () => {
  let resolveCurrent;
  let currentCalls = 0;
  const current = new Promise((resolve) => { resolveCurrent = resolve; });
  const page = loadHomePage({
    async getCurrentRoomPageSnapshot() {
      currentCalls += 1;
      return current;
    },
    async dispatchRoomCommand() { return { ok: true }; }
  });

  const first = page.loadJoinedRoomState();
  const second = page.loadJoinedRoomState();
  assert.equal(first, second);
  assert.equal(currentCalls, 1);

  resolveCurrent({ ok: true, roomId: null });
  await first;
  assert.equal(page._joinedStatePromise, null);
});

test('创建成功后导航丢失全部回调时会超时释放，不会一直加载', async () => {
  let redirectCalls = 0;
  let relaunchCalls = 0;
  const toasts = [];
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    showToast: (options) => toasts.push(options.title),
    redirectTo() { redirectCalls += 1; },
    reLaunch() { relaunchCalls += 1; }
  };

  const page = loadHomePage({
    dispatchRoomCommand: async () => ({
      ok: true,
      outcome: { kind: 'ROOM_CREATED', roomId: '87654321' }
    }),
    getCurrentRoomPageSnapshot: async () => ({ ok: true, roomId: null }),
    getRoomPageSnapshot: async () => ({ ok: true, roomId: null })
  });
  const goToRoomPage = page._goToRoomPage.bind(page);
  page._goToRoomPage = (roomId) => goToRoomPage(roomId, { navigationTimeoutMs: 5 });

  await page.handleCreateRoom();

  assert.equal(redirectCalls, 1);
  assert.equal(relaunchCalls, 1);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.interactionLocked, false);
  assert.equal(page.data.interactionLoading, false);
  assert.deepEqual(toasts, ['进入房间失败，请重试']);
});
