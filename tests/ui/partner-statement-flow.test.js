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
  return { page, commands };
}

test('Partner 表态选择器对房主提供三种 V2 结果', () => {
  const wxml = fs.readFileSync(path.resolve(
    __dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxml'
  ), 'utf8');
  for (const result of ['allPass', 'partialPass', 'allQuestion']) {
    assert.match(wxml, new RegExp(`data-result="${result}"`));
  }
});

test('Partner 打开表态选择器不推进房间，选定结果后才发送指令', async () => {
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  global.wx = { showToast() {} };
  global.getApp = () => ({ globalData: {} });
  try {
    const { page, commands } = makePage(loadPageDefinition());
    await page.handleStartStatement();
    assert.equal(page.data.statementPickerVisible, true);
    assert.equal(commands.length, 0);

    await page.handleStatementResult({ currentTarget: { dataset: { result: 'partialPass' } } });
    assert.deepEqual(commands, [{
      type: 'START_PARTNER_STATEMENT',
      payload: { statementResult: 'partialPass' }
    }]);
    assert.equal(page.data.statementPickerVisible, false);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});
