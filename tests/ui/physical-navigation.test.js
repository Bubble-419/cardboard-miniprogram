'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planPhysicalNavigation } = require('../../modules/room-navigation/physicalNavigation');
const { createNavigationCoordinator } = require('../../modules/room-navigation');

test('普通房间入口/切页替换单层页；仅遗留多层栈做根栈修复', () => {
  const previous = global.getCurrentPages;
  try {
    global.getCurrentPages = () => [{ route: 'pages/main-pages/aaa/index' }];
    assert.equal(planPhysicalNavigation('navigateTo', { url: '/next' }).method, 'redirectTo');
    assert.deepEqual(planPhysicalNavigation('navigateBack', { fallbackUrl: '/explicit' }), {
      method: 'redirectTo', options: { fallbackUrl: '/explicit', url: '/explicit' }
    });
    assert.equal(planPhysicalNavigation('navigateBack').options.url, '/pages/main-pages/aaa/index');
    global.getCurrentPages = () => [{}, {}];
    assert.equal(planPhysicalNavigation('redirectTo', { url: '/next' }).method, 'reLaunch');
  } finally { global.getCurrentPages = previous; }
});

test('全局回顾保存明确 UI 返回地址，不保留历史页面栈', () => {
  const previous = global.getCurrentPages;
  global.getCurrentPages = () => [{ route: 'pages/leaderboard/index', options: { roomId: '12345678', sessionId: 's1' } }];
  try {
    const result = planPhysicalNavigation('navigateTo', { url: '/pages/main-pages/partnerMode/gamepage/index?mode=review' });
    assert.equal(result.method, 'redirectTo');
    assert.match(decodeURIComponent(result.options.url), /returnTo=\/pages\/leaderboard\/index\?roomId=12345678&sessionId=s1/);
  } finally { global.getCurrentPages = previous; }
});

test('相同权威路由发现旧页面栈，也必须修复；正常单层不重复导航', async () => {
  const previous = global.getCurrentPages;
  const current = { route: 'pages/main-pages/selectPlayer/index' };
  let pages = [{ route: 'old' }, current];
  global.getCurrentPages = () => pages;
  const calls = [];
  const coordinator = createNavigationCoordinator({ open: async (descriptor) => { calls.push(descriptor.mode); pages = [current]; } });
  try {
    await coordinator.reconcile({ name: 'selectPlayer' }, 1, { roomId: '12345678' });
    assert.deepEqual(calls, ['reLaunch']);
    await coordinator.reconcile({ name: 'selectPlayer' }, 2, { roomId: '12345678' });
    assert.equal(calls.length, 1);
  } finally { global.getCurrentPages = previous; }
});

test('同一路径收起局部屏幕也串行处理，不能被旧 revision 倒灌', async () => {
  const previous = global.getCurrentPages;
  let release;
  const calls = [];
  const current = { route: 'pages/main-pages/partnerMode/gamepage/index', _localScreens: {
    reconcileAuthority: async (route) => { calls.push(route.name); if (calls.length === 1) await new Promise((resolve) => { release = resolve; }); }
  } };
  global.getCurrentPages = () => [current];
  const coordinator = createNavigationCoordinator();
  try {
    const first = coordinator.reconcile({ name: 'closingStatement' }, 10, { roomId: '12345678' });
    const newest = coordinator.reconcile({ name: 'partnerGame' }, 12, { roomId: '12345678' });
    const old = await coordinator.reconcile({ name: 'closingStatement' }, 11, { roomId: '12345678' });
    assert.equal(old.reason, 'STALE_SEQ');
    release(); await first; await newest;
    assert.deepEqual(calls, ['closingStatement', 'partnerGame']);
    assert.equal(coordinator.getLastSeq(), 12);
  } finally { global.getCurrentPages = previous; }
});

test('所有已注册页面不依赖失效的 disableSwipeBack，也不使用隐藏返回拦截器', () => {
  const root = path.resolve(__dirname, '../..');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const routes = [...app.pages, ...app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`))];
  for (const route of routes) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, `${route}.json`), 'utf8'), /disableSwipeBack/, route);
    assert.doesNotMatch(fs.readFileSync(path.join(root, `${route}.wxml`), 'utf8'), /<page-container/, route);
  }
});

test('等待局部屏幕卸载时切换房间，旧任务不得导航旧房；同路径新房也须重新进入', async () => {
  const previous = global.getCurrentPages;
  let release;
  const current = { route: 'pages/main-pages/selectPlayer/index', data: { roomId: '11111111' },
    _localScreens: { reconcileAuthority: async (route, roomId) => {
      if (roomId === '11111111') await new Promise((resolve) => { release = resolve; });
    } } };
  global.getCurrentPages = () => [current];
  const calls = [];
  const coordinator = createNavigationCoordinator({ open: async (descriptor) => calls.push(descriptor.url) });
  try {
    const old = coordinator.reconcile({ name: 'selectPlayer' }, 8, { roomId: '11111111' });
    const newest = coordinator.reconcile({ name: 'selectPlayer' }, 1, { roomId: '22222222' });
    release();
    assert.equal((await old).reason, 'SUPERSEDED');
    await newest;
    assert.equal(calls.length, 1);
    assert.match(calls[0], /roomId=22222222/);
    assert.equal(coordinator.getLastRoomId(), '22222222');
    assert.equal(coordinator.getLastSeq(), 1);
  } finally { global.getCurrentPages = previous; }
});
