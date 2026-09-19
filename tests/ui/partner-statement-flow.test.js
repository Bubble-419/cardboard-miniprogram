'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadPageDefinition() {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    showToast() {},
    getStorageSync() { return null; },
    setStorageSync() {},
    nextTick(callback) { callback(); },
    getWindowInfo() { return { windowHeight: 800, windowWidth: 375, statusBarHeight: 44 }; },
    getMenuButtonBoundingClientRect() { return { top: 48, height: 32, width: 87, right: 360 }; }
  };
  const modulePath = require.resolve('../../pages/main-pages/partnerMode/gamepage/index');
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition) {
  const commands = [];
  const page = {
    ...definition,
    data: {
      ...definition.data,
      roomId: '12345678', sessionId: 's1', turnId: 't1', isHost: true,
      canStartStatement: true, gamepagePhase: 'play'
    },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (typeof callback === 'function') callback();
    }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key].bind(page);
  });
  page._dispatchPartnerCommand = async (type, payload) => {
    commands.push({ type, payload });
    return { ok: true };
  };
  page._stopRoundSpeech = () => {};
  page._stopStatePolling = () => {};
  page._stopRoundTimerBurstPoll = () => {};
  page._startStatePolling = () => {};
  page._syncRoundSpeech = () => {};
  page._applyRoomContext = () => {};
  page._cancelStarPanelCollapse = () => {};
  return { page, commands };
}

test('开始表态发送指令并由 Member View 进入讨论页，不本地猜测状态', async () => {
  const wxml = fs.readFileSync(path.resolve(
    __dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxml'
  ), 'utf8');
  const footerWxml = fs.readFileSync(path.resolve(
    __dirname, '../../components/partner-game-footer/index.wxml'
  ), 'utf8');
  assert.doesNotMatch(wxml, /statement-picker-mask/);
  assert.match(footerWxml, /data-intent="DISCUSSION_ALL_PASS"[\s\S]*?没有疑问/);
  assert.match(footerWxml, /data-intent="END_DISCUSSION"[\s\S]*?结束讨论/);

  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  global.wx = { showToast() {} };
  global.getApp = () => ({ globalData: {} });
  try {
    const { page, commands } = makePage(loadPageDefinition());
    await page.handleStartStatement();
    assert.equal(page.data.gamepagePhase, 'play', '测试未投影新 View 时不应乐观切换业务阶段');
    assert.deepEqual(commands, [{
      type: 'START_PARTNER_STATEMENT',
      payload: { statementResult: 'allQuestion' }
    }]);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('疑问讨论页两个按钮分别提交没有疑问和结束讨论', async () => {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  global.wx = { showToast() {} };
  global.getApp = () => ({ globalData: {} });
  try {
    const { page, commands } = makePage(loadPageDefinition());
    page.data.gamepagePhase = 'discussion';
    await page.handleAllPassFromDiscussion();
    await page.handleEndDiscussion();
    assert.deepEqual(commands, [
      { type: 'ADVANCE_PARTNER_TURN', payload: { statementResult: 'allPass' } },
      { type: 'ADVANCE_PARTNER_TURN', payload: { statementResult: 'allQuestion' } }
    ]);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});
