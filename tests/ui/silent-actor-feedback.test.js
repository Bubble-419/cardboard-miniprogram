'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

function loadPageDefinition() {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    getStorageSync() { return null; },
    setStorageSync() {},
    getWindowInfo() { return { windowWidth: 375, windowHeight: 800, statusBarHeight: 44 }; },
    getMenuButtonBoundingClientRect() { return { top: 48, height: 32, width: 87, right: 360 }; }
  };
  const modulePath = require.resolve('../../pages/main-pages/partnerMode/specialMove/index');
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition, data = {}) {
  const page = {
    ...definition,
    data: { ...definition.data, ...data },
    setData(patch) { Object.assign(this.data, patch); }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key].bind(page);
  });
  return page;
}

test('静默特殊行动为出牌玩家显示打分进度和匿名表达入口', () => {
  const markup = read('pages/main-pages/partnerMode/specialMove/index.wxml');
  const styles = read('pages/main-pages/partnerMode/specialMove/index.wxss');

  assert.match(markup, /class="silent-card-feedback[^"]*"[\s\S]*?wx:if="\{\{isCurrentPlayer\}\}"/);
  assert.match(markup, /已打分：\{\{scoredCount\}\}\/\{\{totalRequired\}\}人/);
  assert.match(markup, /catchtap="toggleSilentExpressChat"/);
  assert.match(markup, /silentExpressPanelVisible && isCurrentPlayer/);
  assert.match(styles, /\.silent-card-feedback\s*\{[\s\S]*?bottom:\s*20rpx;/);
  assert.match(styles, /\.silent-card-inner-with-actions\s*\{[\s\S]*?padding-bottom:\s*120rpx;/);
});

test('静默页只投影当前场次当前轮的出牌阶段匿名表达和评分人数', () => {
  const definition = loadPageDefinition();
  const page = makePage(definition, { sessionId: 'session-1', currentRound: 2 });

  page._syncSilentCardFeedback({
    progress: { scoredCount: 1, requiredScoreCount: 3, turnId: 'turn-2' },
    partnerExpressMessages: [
      { id: 'm1', text: '保留', anonKey: 'a', sessionId: 'session-1', round: 2, phase: 'play' },
      { id: 'm2', text: '旧轮次', anonKey: 'b', sessionId: 'session-1', round: 1, phase: 'play' },
      { id: 'm3', text: '讨论阶段', anonKey: 'c', sessionId: 'session-1', round: 2, phase: 'discussion' },
      { id: 'm4', text: '旧场次', anonKey: 'd', sessionId: 'session-old', round: 2, phase: 'play' }
    ]
  }, 2, 'session-1');

  assert.equal(page.data.scoredCount, 1);
  assert.equal(page.data.totalRequired, 3);
  assert.deepEqual(page.data.silentExpressChatList.map((item) => item.text), ['保留']);
  assert.equal(page.data.silentExpressChatAnchor, 'silent-express-m1');

  page.toggleSilentExpressChat();
  assert.equal(page.data.silentExpressPanelVisible, true);
});
