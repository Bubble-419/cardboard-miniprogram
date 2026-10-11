'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withLocalScreens } = require('../../modules/room-navigation/localScreens');
const { waitForPageNavigation } = require('../../utils/pageInteractionLock');
const { localScreenView } = require('../../modules/room-navigation/localScreenView');

function fixture() {
  const calls = [];
  const definition = withLocalScreens({
    data: { roomId: '12345678', draft: '未提交草稿' },
    onShow() { calls.push('root:show'); },
    onHide() { calls.push('root:hide'); },
    onUnload() { calls.push('root:unload'); }
  }, {
    '/detail': { name: 'detail', routes: ['partnerGame'], create: () => ({
      data: { text: '' },
      onLoad(options) { this.setData({ text: options.text || '' }); },
      onShow() { calls.push('detail:show'); },
      onHide() { calls.push('detail:hide'); },
      onUnload() { calls.push('detail:unload'); },
      edit(event) { this.setData({ text: event.detail.value }); }
    }) },
    '/crop': { name: 'crop', routes: ['partnerGame'], create: () => ({
      data: {}, onUnload() { this.getOpenerEventChannel().emit('cancel'); }
    }) }
  });
  const page = { ...definition, route: 'pages/main-pages/partnerMode/gamepage/index',
    data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }
  };
  page.onLoad({ roomId: '12345678' });
  page.onShow();
  return { page, calls, host: page._localScreens };
}

async function mount(f, url, options = {}) {
  const opened = f.host.open(url, options);
  const entry = f.page.data.localScreens.at(-1);
  f.host.ready(entry.token, { createSelectorQuery() {} });
  await opened;
  return f.host.current();
}

test('辅助屏幕不创建微信页面栈；UI 关闭恢复同一 owner 和草稿', async () => {
  const f = fixture();
  const detail = await mount(f, '/detail?text=内容');
  assert.equal(detail.data.text, '内容');
  assert.equal(f.page.data.localScreenActive, true);
  await f.host.close(detail);
  assert.equal(f.page.data.localScreenActive, false);
  assert.equal(f.page.data.draft, '未提交草稿');
  assert.deepEqual(f.calls, ['root:show', 'root:hide', 'detail:show', 'detail:hide', 'detail:unload', 'root:show']);
});

test('嵌套屏幕关闭只恢复直接下层；裁图取消回调仅一次', async () => {
  const f = fixture();
  const detail = await mount(f, '/detail');
  let cancelled = 0;
  const crop = await mount(f, '/crop', { events: { cancel: () => { cancelled += 1; } } });
  await f.host.close(crop);
  f.host.ready(f.page.data.localScreens.at(-1).token, {});
  assert.equal(f.host.current(), detail);
  assert.equal(cancelled, 1);
  await f.host.close(crop);
  assert.equal(cancelled, 1, '迟到关闭不能再次弹出下层');
});

test('嵌套返回与前后台交错时，不能通过已销毁的组件作用域恢复下层副作用', async () => {
  const f = fixture();
  const detail = await mount(f, '/detail');
  const crop = await mount(f, '/crop');
  f.page.onHide();
  await f.host.close(crop);
  const beforeShow = f.calls.length;
  f.page.onShow();
  assert.equal(f.calls.length, beforeShow, '下层新组件 ready 前不能恢复 onShow');
  assert.equal(f.host.current(), detail);
  f.host.ready(f.page.data.localScreens.at(-1).token, { createSelectorQuery() {} });
  assert.equal(f.calls.at(-1), 'detail:show');
});

test('同一权威路由保留局部屏幕，路由切换先清屏再恢复 owner', async () => {
  const f = fixture();
  await mount(f, '/detail');
  await f.host.reconcileAuthority({ name: 'partnerGame' }, '12345678');
  assert.equal(f.page.data.localScreenActive, true);
  await f.host.reconcileAuthority({ name: 'closingStatement' }, '12345678');
  assert.equal(f.page.data.localScreenActive, false);
  assert.equal(f.calls.at(-1), 'root:show');
});

test('后台、卸载和迟到 UI 意图不触发业务命令或恢复已退出页面', async () => {
  const f = fixture();
  const detail = await mount(f, '/detail');
  f.page.onHide();
  await f.host.close(detail);
  assert.notEqual(f.calls.at(-1), 'root:show', '后台关闭不得启动录音等 owner 副作用');
  f.page.onShow();
  assert.equal(f.calls.at(-1), 'root:show');
  const late = await mount(f, '/detail');
  f.page.onUnload();
  assert.equal((await f.host.close(late)).ok, false);
  late.setData({ text: '迟到修改' });
  assert.equal(f.page.data.localScreens.length, 0);
  assert.equal(f.calls.at(-1), 'root:unload');
});

test('导航入口实际打开页内屏幕并等待组件就绪，不调用微信 navigateTo', async () => {
  const f = fixture();
  const previousWx = global.wx;
  global.wx = { navigateTo() { assert.fail('辅助屏幕不得创建真实页面'); } };
  try {
    const opened = waitForPageNavigation('navigateTo', { url: '/detail?text=测试' }, f.page);
    const entry = f.page.data.localScreens.at(-1);
    assert.equal(f.page.data.localScreenActive, true);
    f.host.ready(entry.token, {});
    assert.equal((await opened).ok, true);
    await waitForPageNavigation('navigateBack', {}, f.host.current());
    assert.equal(f.page.data.localScreenActive, false);
  } finally { global.wx = previousWx; }
});

test('挂载失败恢复 owner 并释放请求；迟到 ready 不复活旧屏幕', async () => {
  const f = fixture();
  const opened = f.host.open('/detail', { navigationTimeoutMs: 5 });
  const token = f.page.data.localScreens.at(-1).token;
  assert.equal((await opened).reason, 'LOCAL_SCREEN_MOUNT_TIMEOUT');
  assert.equal(f.page.data.localScreenActive, false);
  const count = f.calls.length;
  f.host.ready(token, {});
  assert.equal(f.calls.length, count);
});

test('旧屏幕迟到导航不触发原生 API，也不关闭新打开的屏幕', async () => {
  const f = fixture();
  const old = await mount(f, '/detail');
  await f.host.close(old);
  const current = await mount(f, '/detail');
  const result = await waitForPageNavigation('navigateBack', {}, old);
  assert.equal(result.reason, 'LOCAL_SCREEN_GONE');
  assert.equal(f.host.current(), current);
});

test('RoomSession 同步回放中关闭屏幕，不恢复失效订阅，也不导航旧页面', async () => {
  const { bindPageToRoomSession, unbindPageFromRoomSession } = require('../../modules/room-session');
  const previousApp = global.getApp;
  const previousWx = global.wx;
  let unsubscribed = 0;
  const session = {
    getState: () => ({ status: 'READY', roomId: '12345678' }),
    subscribe(callback) {
      callback({ roomId: '12345678', revision: 1, view: { route: { name: 'addPlayer' } } });
      return () => { unsubscribed += 1; };
    }
  };
  global.getApp = () => ({ globalData: { roomSession: session } });
  global.wx = { reLaunch() { assert.fail('旧页面不得导航'); } };
  const page = {};
  try {
    const result = await bindPageToRoomSession(page, {
      getRoomId: () => '12345678', followNavigation: true,
      onSnapshot() { unbindPageFromRoomSession(this); }
    });
    assert.equal(result, null);
    assert.equal(unsubscribed, 1);
    assert.equal(page._roomSessionUnsub, null);
    assert.equal(page._boundRoomSession, null);
  } finally { global.getApp = previousApp; global.wx = previousWx; }
});

test('展示组件只更新变更字段；传递输入/键盘和触摸意图，不持有房间连接', () => {
  const definition = localScreenView(['edit']);
  const patches = [], events = [];
  const view = { properties: { token: 7 }, setData: (patch) => patches.push(patch),
    triggerEvent: (name, event) => events.push({ name, event }) };
  definition.observers.model.call(view, { text: '草稿', focused: true });
  assert.equal(patches[0].modelReady, true, '首次完整模型安装前不创建交互节点');
  definition.observers.model.call(view, { text: '草稿', focused: true, height: 230 });
  assert.deepEqual(patches[1], { height: 230 }, '无关更新不能重新设置焦点/草稿');
  definition.methods.edit.call(view, { detail: { value: '新草稿' }, currentTarget: { dataset: { type: 'scene' } } });
  assert.equal(events[0].event.token, 7);
  assert.equal(events[0].event.event.detail.value, '新草稿');
});

test('迁移的展示组件意图与控制器接口完整对齐，展示层不持有房间连接', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const screens = [
    ['pages/main-pages/selectBG/controller', 'pages/main-pages/selectBG/view'],
    ['components/room-scenario-detail/controller', 'components/room-scenario-detail'],
    ['pages/main-pages/case/controller', 'pages/main-pages/case/view'],
    ['pages/inspiration/controller', 'pages/inspiration/view'],
    ['pages/main-pages/partnerMode/specialMove/controller', 'pages/main-pages/partnerMode/specialMove/view'],
    ['pages/main-pages/partnerMode/imageCrop/controller', 'pages/main-pages/partnerMode/imageCrop/view'],
    ['packageSpy/pages/cardLibrary/controller', 'packageSpy/pages/cardLibrary/view']
  ];
  const root = path.resolve(__dirname, '../..');
  for (const [controllerPath, viewPath] of screens) {
    const controller = require(path.join(root, controllerPath))();
    const intents = require(path.join(root, `${viewPath}/intents`));
    for (const intent of intents) assert.equal(typeof controller[intent], 'function', `${viewPath}: ${intent}`);
    assert.doesNotMatch(fs.readFileSync(path.join(root, `${viewPath}/index.js`), 'utf8'), /room-session|roomCommand|roomQuery/);
  }
});
