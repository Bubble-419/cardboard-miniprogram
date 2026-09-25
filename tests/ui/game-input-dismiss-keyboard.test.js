'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const GAME_JS = path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.js');
const INSPIRATION_JS = path.resolve(__dirname, '../../pages/inspiration/index.js');

function loadPageDefinition(wxMock = {}) {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  global.getApp = () => ({ globalData: {} });
  global.wx = wxMock;
  delete require.cache[require.resolve(GAME_JS)];
  require(GAME_JS);
  delete require.cache[require.resolve(GAME_JS)];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition, data = {}) {
  return {
    ...definition,
    data: { ...definition.data, ...data },
    setData(patch) { Object.assign(this.data, patch); }
  };
}

function loadInspirationPageDefinition(wxMock = {}) {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  global.getApp = () => ({ globalData: {} });
  global.wx = wxMock;
  delete require.cache[require.resolve(INSPIRATION_JS)];
  require(INSPIRATION_JS);
  delete require.cache[require.resolve(INSPIRATION_JS)];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

test('点击空白关闭匿名表达输入框时同步收起键盘', () => {
  let hideKeyboardCalls = 0;
  const wxMock = { hideKeyboard() { hideKeyboardCalls += 1; } };
  const definition = loadPageDefinition(wxMock);
  const page = makePage(definition, {
    expressComposerOpen: true,
    expressComposerNeedFocus: true,
    expressSending: false
  });
  page._flushPendingRoomContextIfIdle = () => {};

  const originalWx = global.wx;
  global.wx = wxMock;
  try {
    page.closeExpressComposer();
  } finally {
    global.wx = originalWx;
  }

  assert.equal(page.data.expressComposerOpen, false);
  assert.equal(hideKeyboardCalls, 1);
});

test('点击空白使灵感输入框失焦时同步收起键盘', () => {
  let hideKeyboardCalls = 0;
  const timers = [];
  const wxMock = { hideKeyboard() { hideKeyboardCalls += 1; } };
  const definition = loadPageDefinition(wxMock);
  const page = makePage(definition, {
    inspirationInputFocused: true,
    inspirationHoldKeyboard: false,
    inspirationKeyboardHeight: 300
  });
  page._inspirationNativeFocused = true;

  const originalWx = global.wx;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.wx = wxMock;
  global.setTimeout = (callback) => {
    timers.push(callback);
    return timers.length;
  };
  global.clearTimeout = () => {};
  try {
    page.onInspirationBlur();
    while (timers.length) timers.shift()();
  } finally {
    global.wx = originalWx;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  assert.equal(page.data.inspirationInputFocused, false);
  assert.equal(page.data.inspirationKeyboardHeight, 0);
  assert.equal(hideKeyboardCalls, 1);
});

test('灵感空间点击输入框外遮罩时显式收起原生键盘', () => {
  let hideKeyboardCalls = 0;
  const wxMock = { hideKeyboard() { hideKeyboardCalls += 1; } };
  const definition = loadInspirationPageDefinition(wxMock);
  const page = makePage(definition, {
    inspirationInputFocused: true,
    inspirationHoldKeyboard: false,
    inspirationKeyboardHeight: 300,
    inspirationLiftStyle: 'bottom: 300px;',
    inspirationMaskStyle: 'bottom: 300px;'
  });
  page._inspirationFocusRequestedAt = 0;
  page._inspirationNativeFocused = true;

  const originalWx = global.wx;
  global.wx = wxMock;
  try {
    page.onInspirationDismissFocus();
  } finally {
    global.wx = originalWx;
  }

  assert.equal(hideKeyboardCalls, 1);
  assert.equal(page.data.inspirationInputFocused, false);
  assert.equal(page.data.inspirationHoldKeyboard, false);
  assert.equal(page.data.inspirationKeyboardHeight, 0);
  assert.equal(page._inspirationNativeFocused, false);
});
