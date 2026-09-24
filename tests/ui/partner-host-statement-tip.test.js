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
  global.wx = {};
  const modulePath = require.resolve('../../pages/main-pages/partnerMode/gamepage/index');
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
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (typeof callback === 'function') callback();
    }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key].bind(page);
  });
  return page;
}

function selectorFor(rect) {
  return {
    select() { return this; },
    boundingClientRect(callback) { callback(rect); return this; },
    exec() {}
  };
}

test('房主开始表态新手提示使用聚光层、层级文案和实时打分进度', () => {
  const wxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const wxss = read('pages/main-pages/partnerMode/gamepage/index.wxss');

  assert.match(wxml, /wx:if="\{\{showHostStatementTip && hostStatementTipReady\}\}"/);
  assert.match(wxml, /class="host-statement-tip-spot"[\s\S]*?style="\{\{hostStatementTipSpotStyle\}\}"/);
  assert.match(wxml, /操作提示[\s\S]*?先完成全员打分/);
  assert.match(wxml, /全部完成后，「开始表态」按钮会亮起/);
  assert.match(wxml, /已打分 \{\{scoredCount\}\}\/\{\{totalRequired\}\} 人/);
  assert.match(wxml, /点击任意处继续/);
  assert.match(wxml, /class="host-statement-tip-arrow" style="\{\{hostStatementTipArrowStyle\}\}"/);
  assert.match(wxss, /\.host-statement-tip-spot\s*\{[\s\S]*?box-shadow:\s*0 0 0 9999px/);
  assert.match(wxss, /@keyframes host-statement-tip-pulse/);
});

test('聚光框按真实按钮位置外扩，提示箭头对准按钮中心', () => {
  const definition = loadPageDefinition();
  const page = makePage(definition, {
    isHost: true,
    gamepagePhase: 'play',
    showHostStatementTip: true,
    hostStatementTipReady: false
  });
  page.selectComponent = () => ({
    createSelectorQuery: () => selectorFor({ left: 108, top: 700, width: 237, height: 56 })
  });

  const originalWx = global.wx;
  global.wx = {
    getWindowInfo() { return { windowWidth: 375, windowHeight: 812 }; }
  };
  try {
    page._measureHostStatementTip(0);
  } finally {
    global.wx = originalWx;
  }

  assert.equal(page.data.hostStatementTipReady, true);
  assert.equal(page.data.hostStatementTipSpotStyle, 'left:102px;top:694px;width:249px;height:68px;');
  assert.equal(page.data.hostStatementTipTextStyle, 'bottom:130px;');
  assert.equal(page.data.hostStatementTipArrowStyle, 'left:202.5px;');
});

test('按钮持续测量失败后取消提示，不留下阻断页面的透明层', () => {
  const definition = loadPageDefinition();
  const page = makePage(definition, {
    isHost: true,
    gamepagePhase: 'play',
    showHostStatementTip: true,
    hostStatementTipReady: false
  });
  page.selectComponent = () => ({ createSelectorQuery: () => selectorFor(null) });

  page._measureHostStatementTip(8);

  assert.equal(page.data.showHostStatementTip, false);
  assert.equal(page.data.hostStatementTipReady, false);
  assert.equal(page._hostStatementTipMeasureFailed, true);
});

test('提示仅向未读房主展示，点击任意处关闭后记录已读', () => {
  const definition = loadPageDefinition();
  let stored = '';
  const originalWx = global.wx;
  global.wx = {
    getStorageSync() { return stored; },
    setStorageSync(key, value) { stored = `${key}:${value}`; }
  };
  try {
    const guest = makePage(definition, { isHost: false, gamepagePhase: 'play' });
    guest._maybeShowHostStatementTip();
    assert.equal(guest.data.showHostStatementTip, false);

    const discussionHost = makePage(definition, { isHost: true, gamepagePhase: 'discussion' });
    discussionHost._maybeShowHostStatementTip();
    assert.equal(discussionHost.data.showHostStatementTip, false);

    const closingHost = makePage(definition, { isHost: true, gamepagePhase: 'closing' });
    closingHost._maybeShowHostStatementTip();
    assert.equal(closingHost.data.showHostStatementTip, false);

    const host = makePage(definition, { isHost: true, gamepagePhase: 'play' });
    host._measureHostStatementTip = () => {};
    host._maybeShowHostStatementTip();
    assert.equal(host.data.showHostStatementTip, true);
    host.dismissHostStatementTip();
    assert.equal(host.data.showHostStatementTip, false);
    assert.equal(stored, 'partnerHostGamepageTipSeen:1');

    const seenHost = makePage(definition, { isHost: true, gamepagePhase: 'play' });
    seenHost._maybeShowHostStatementTip();
    assert.equal(seenHost.data.showHostStatementTip, false);
  } finally {
    global.wx = originalWx;
  }
});
