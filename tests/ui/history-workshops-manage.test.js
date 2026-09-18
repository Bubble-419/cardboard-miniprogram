'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOME_WXML = path.resolve(__dirname, '../../pages/main-pages/aaa/index.wxml');
const HOME_JS = path.resolve(__dirname, '../../pages/main-pages/aaa/index.js');
const HISTORY_UTIL = require.resolve('../../utils/historyWorkshops');
const ROOM_SESSION = require.resolve('../../modules/room-session/index');
const HOME_PAGE = require.resolve('../../pages/main-pages/aaa/index');

function withWx(storage, extraWx, run) {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalPage = global.Page;
  const originalGetCurrentPages = global.getCurrentPages;
  global.getApp = () => ({ globalData: {} });
  global.getCurrentPages = () => [{ route: 'pages/main-pages/aaa/index' }];
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    showToast() {},
    showModal() {},
    ...extraWx
  };
  try {
    return run();
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
    global.Page = originalPage;
    global.getCurrentPages = originalGetCurrentPages;
  }
}

function loadHistoryUtil(storage) {
  delete require.cache[HISTORY_UTIL];
  return require('../../utils/historyWorkshops');
}

function loadHomePage() {
  const previousRoomSession = require.cache[ROOM_SESSION];
  require.cache[ROOM_SESSION] = {
    id: ROOM_SESSION,
    filename: ROOM_SESSION,
    loaded: true,
    exports: {
      async getCurrentRoomPageSnapshot() { return { ok: true, roomId: '' }; },
      async getRoomPageSnapshot() { return { ok: true, roomId: '' }; },
      async dispatchRoomCommand() { return { ok: true }; }
    }
  };
  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  delete require.cache[HOME_PAGE];
  delete require.cache[HISTORY_UTIL];
  require('../../pages/main-pages/aaa/index');
  if (previousRoomSession) require.cache[ROOM_SESSION] = previousRoomSession;
  else delete require.cache[ROOM_SESSION];

  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') {
      page[key] = definition[key].bind(page);
    }
  });
  return page;
}

test('首页历史工作坊提供管理、全选和删除入口', () => {
  const wxml = fs.readFileSync(HOME_WXML, 'utf8');
  const js = fs.readFileSync(HOME_JS, 'utf8');
  assert.match(wxml, /bindtap="onTapHistoryManage"/);
  assert.match(wxml, /bindtap="onTapHistoryCancelManage"/);
  assert.match(wxml, /bindtap="onTapHistorySelectAll"/);
  assert.match(wxml, /bindtap="onTapHistoryDelete"/);
  assert.match(wxml, /history-select-dot/);
  assert.match(js, /removeHistoryWorkshops/);
  assert.match(js, /historyManageMode/);
});

test('removeHistoryWorkshops 按 roomId 删除本地历史', () => {
  const storage = new Map();
  storage.set('historyWorkshops', [
    { id: '11111111', roomId: '11111111', name: 'A' },
    { id: '22222222', roomId: '22222222', name: 'B' },
    { id: '33333333', roomId: '33333333', name: 'C' }
  ]);
  withWx(storage, {}, () => {
    const util = loadHistoryUtil(storage);
    const next = util.removeHistoryWorkshops(['11111111', '33333333']);
    assert.deepEqual(next.map((it) => it.roomId), ['22222222']);
    assert.deepEqual(storage.get('historyWorkshops').map((it) => it.roomId), ['22222222']);
  });
});

test('管理态点卡片只切换选中，不打开回顾页', () => {
  const storage = new Map();
  storage.set('historyWorkshops', [
    { id: '11111111', roomId: '11111111', name: '场次一', sessionId: 's1' },
    { id: '22222222', roomId: '22222222', name: '场次二', sessionId: 's2' }
  ]);
  withWx(storage, {}, () => {
    const page = loadHomePage();
    page._loadHistoryWorkshops();
    page.onTapHistoryManage();
    assert.equal(page.data.historyManageMode, true);
    page.onTapHistoryCard({
      currentTarget: { dataset: { roomId: '11111111', sessionId: 's1' } }
    });
    assert.equal(page.data.selectedHistoryCount, 1);
    assert.equal(page.data.historyWorkshops[0].selected, true);
    assert.equal(page.data.historyAllSelected, false);

    page.onTapHistorySelectAll();
    assert.equal(page.data.historyAllSelected, true);
    assert.equal(page.data.selectedHistoryCount, 2);

    page.onTapHistorySelectAll();
    assert.equal(page.data.selectedHistoryCount, 0);
  });
});

test('确认删除后从首页历史列表移除选中记录', () => {
  const storage = new Map();
  storage.set('historyWorkshops', [
    { id: '11111111', roomId: '11111111', name: '场次一' },
    { id: '22222222', roomId: '22222222', name: '场次二' }
  ]);
  const toasts = [];
  withWx(storage, {
    showToast(opts) { toasts.push(opts); },
    showModal(opts) { opts.success({ confirm: true }); }
  }, () => {
    const page = loadHomePage();
    page._loadHistoryWorkshops();
    page.onTapHistoryManage();
    page.onTapHistoryCard({
      currentTarget: { dataset: { roomId: '11111111', sessionId: '' } }
    });
    page.onTapHistoryDelete();
    assert.deepEqual(
      (storage.get('historyWorkshops') || []).map((it) => it.roomId),
      ['22222222']
    );
    assert.equal(page.data.historyManageMode, false);
    assert.equal(page.data.historyWorkshops.length, 1);
    assert.equal(page.data.historyWorkshops[0].roomId, '22222222');
    assert.equal(toasts.some((item) => item && item.title === '已删除'), true);
  });
});

test('本地存储写入失败时保留选中项并提示失败', () => {
  const storage = new Map();
  storage.set('historyWorkshops', [
    { id: '11111111', roomId: '11111111', name: '场次一' },
    { id: '22222222', roomId: '22222222', name: '场次二' }
  ]);
  const toasts = [];
  withWx(storage, {
    setStorageSync() { throw new Error('storage full'); },
    showToast(opts) { toasts.push(opts); },
    showModal(opts) { opts.success({ confirm: true }); }
  }, () => {
    const page = loadHomePage();
    page._loadHistoryWorkshops();
    page.onTapHistoryManage();
    page.onTapHistoryCard({
      currentTarget: { dataset: { roomId: '11111111', sessionId: '' } }
    });
    page.onTapHistoryDelete();

    assert.equal(page.data.historyManageMode, true);
    assert.equal(page.data.selectedHistoryCount, 1);
    assert.equal(page.data.historyWorkshops.length, 2);
    assert.equal(toasts.at(-1).title, '删除失败，请重试');
  });
});
