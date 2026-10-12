'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `缺少样式 ${selector}`);
  return Object.fromEntries(match[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';')
    .filter((line) => line.includes(':')).map((line) => line.split(':').map((part) => part.trim())));
}

function createPage() {
  const filename = path.join(root, 'pages/main-pages/partnerMode/gamepage/index.js');
  let definition;
  let nextId = 0;
  const timers = new Map();
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: createRequire(filename),
    Page(value) { definition = value; },
    getApp: () => ({ globalData: {} }),
    wx: {}, console,
    setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  }, { filename });
  const page = {
    ...definition,
    data: { ...definition.data, currentRound: 1, sessionId: 's1' },
    setData(patch) { Object.assign(this.data, patch); }
  };
  return { page, flushTimers() {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((callback) => callback());
  } };
}

const messages = [
  { id: 'play-1', sessionId: 's1', round: 1, phase: 'play', text: '匿名表达' },
  { id: 'discussion-1', sessionId: 's1', round: 1, phase: 'discussion', text: '疑问讨论' }
];

test('手动回看聊天时立即释放底部定位，同步新消息不抢走正在进行的滚动', () => {
  const { page, flushTimers } = createPage();
  page._syncExpressChatList(messages);
  assert.equal(page.data.expressChatAnchor, 'express-chat-bottom');
  assert.equal(page.data.discussionExpressChatAnchor, 'discussion-express-chat-bottom');

  page.onInnerScrollTouchStart();
  assert.equal(page.data.innerScrollLocked, true);
  assert.equal(page.data.expressChatAnchor, '', '开始拖动后不能仍由 scroll-into-view 固定在底部');
  assert.equal(page.data.discussionExpressChatAnchor, '');
  const updated = [...messages, { ...messages[0], id: 'play-2', text: '拖动期间的新消息' }];
  page._syncExpressChatList(updated);
  assert.equal(page.data.expressChatList.length, 2, '滚动期间仍应正常接收内容');
  assert.equal(page.data.expressChatAnchor, '', '新消息不能强制中断当前手势');
  assert.equal(page.data.discussionExpressChatAnchor, '');

  page.onInnerScrollTouchEnd();
  flushTimers();
  assert.equal(page.data.innerScrollLocked, false);
  page._syncExpressChatList([...updated, { ...messages[1], id: 'discussion-2' }]);
  assert.equal(page.data.discussionExpressChatAnchor, 'discussion-express-chat-bottom');
  flushTimers();
  assert.equal(page.data.discussionExpressChatAnchor, '');
});

test('普通倒计时与特殊模式一致：聊天内容层在原生画布上方', () => {
  const css = read('components/game-card-timer/index.wxss');
  const content = rule(css, '.gct-inner');
  for (const selector of ['.gct-canvas', '.gct-sound-canvas', '.gct-canvas-placeholder']) {
    assert.ok(Number(content['z-index']) > Number(rule(css, selector)['z-index']),
      `${selector} 不能覆盖卡内原生滚动视图的触摸区域`);
  }
  const inset = rule(css, '.gct-wrap-timer-on .gct-inner');
  assert.equal(inset.left, '8rpx', '抬高内容层后仍要为倒计时边框留出空间');
});

test('三种聊天入口均使用有界视口，滚动内容不能撑开原生 scroll-view', () => {
  const wxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const css = read('pages/main-pages/partnerMode/gamepage/index.wxss');
  for (const name of ['discussion-scroll', 'action-express-chat', 'spectator-chat']) {
    const match = wxml.match(new RegExp(`<scroll-view\\s+class="${name} chat-scroll-view"([^>]+)>`));
    assert.ok(match, `${name} 必须使用统一原生滚动视口`);
    assert.match(match[1], /scroll-y/);
    assert.match(match[1], /bindtouchstart="onInnerScrollTouchStart"/);
    assert.match(match[1], /bindtouchcancel="onInnerScrollTouchEnd"/);
  }
  assert.equal((wxml.match(/class="[^"]*chat-scroll-viewport[^"]*"/g) || []).length, 3);
  const viewport = rule(css, '.chat-scroll-viewport');
  assert.equal(viewport.height, '0');
  assert.equal(viewport['min-height'], '0');
  assert.equal(viewport.flex, '1');
  assert.equal(viewport.position, 'relative');
  const scroll = rule(css, '.chat-scroll-view');
  assert.equal(scroll.position, 'absolute');
  assert.equal(scroll.height, '100%');
  assert.equal(rule(css, '.action-express-chat-body')['min-height'], '0',
    '键盘压缩卡片时，聊天区不能被固定最小高度撑出卡片');
});
