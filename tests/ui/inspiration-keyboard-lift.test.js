'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

function loadPageDefinition(modulePath, wxMock = {}) {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  global.getApp = () => ({ globalData: {} });
  global.wx = wxMock;
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  delete require.cache[require.resolve(modulePath)];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition, data = {}) {
  return {
    ...definition,
    data: { ...definition.data, ...data },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
}

test('三个灵感/复盘输入入口只使用系统 adjust-position，不叠加 fixed 键盘位移', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const inspirationWxml = read('pages/inspiration/index.wxml');

  const gameInspirationInputs = gameWxml.match(/<input[\s\S]*?class="inspiration-textarea"[\s\S]*?\/>/g) || [];
  assert.equal(gameInspirationInputs.length, 2);
  gameInspirationInputs.forEach((markup) => {
    assert.match(markup, /adjust-position="\{\{true\}\}"/);
    assert.match(markup, /cursor-spacing="24"/);
  });

  const inspirationTextarea = inspirationWxml.match(/<textarea[\s\S]*?class="inspiration-textarea"[\s\S]*?\/>/);
  assert.ok(inspirationTextarea);
  assert.match(inspirationTextarea[0], /adjust-position="\{\{true\}\}"/);
  assert.match(inspirationTextarea[0], /cursor-spacing="24"/);
  assert.match(
    inspirationWxml,
    /inspirationInputFocused \|\| inspirationKeyboardHeight > 0/,
    '聚焦态样式应在键盘高度事件后生效，不能在 focus 瞬间 setData'
  );

  const closingTextareas = gameWxml.match(/<textarea[\s\S]*?name="closingCreativeText"[\s\S]*?\/>/g) || [];
  assert.equal(closingTextareas.length, 1);
  closingTextareas.forEach((markup) => {
    assert.match(markup, /adjust-position="\{\{true\}\}"/);
    assert.match(markup, /cursor-spacing="120"/);
  });
  assert.doesNotMatch(gameWxml, /style="\{\{closingComposeLiftStyle\}\}"/);
});

test('gamepage 键盘只监听 input 自身事件，高度变化不得生成 fixed 样式', () => {
  let globalKeyboardBindings = 0;
  const originalWx = global.wx;
  const wxMock = {
    onKeyboardHeightChange() { globalKeyboardBindings += 1; },
    offKeyboardHeightChange() {},
    getWindowInfo() { return { windowHeight: 800, screenHeight: 800 }; }
  };
  const definition = loadPageDefinition(
    '../../pages/main-pages/partnerMode/gamepage/index',
    wxMock
  );
  const page = makePage(definition, {
    inspirationInputFocused: true,
    inspirationLiftStyle: ''
  });
  page._inspirationNativeFocused = true;

  global.wx = wxMock;
  try {
    page._bindInspirationKeyboard();
    page.onInspirationKeyboardHeightChange({ detail: { height: 320 } });
  } finally {
    global.wx = originalWx;
  }

  assert.equal(globalKeyboardBindings, 0, '全局监听与 input 事件双通道会产生高度抖动');
  assert.equal(page.data.inspirationKeyboardHeight, 320);
  assert.equal(page.data.inspirationLiftStyle, '');
});

test('灵感空间键盘高度只记录状态，不得生成 fixed 样式', () => {
  let globalKeyboardBindings = 0;
  const originalWx = global.wx;
  const wxMock = {
    onKeyboardHeightChange() { globalKeyboardBindings += 1; },
    offKeyboardHeightChange() {},
    getWindowInfo() { return { windowHeight: 800, screenHeight: 800 }; }
  };
  const definition = loadPageDefinition(
    '../../pages/inspiration/index',
    wxMock
  );
  const page = makePage(definition, {
    inspirationInputFocused: true,
    inspirationLiftStyle: ''
  });
  page._inspirationNativeFocused = true;

  global.wx = wxMock;
  try {
    page._bindInspirationKeyboard();
    page.onInspirationKeyboardHeightChange({ detail: { height: 300 } });
  } finally {
    global.wx = originalWx;
  }

  assert.equal(globalKeyboardBindings, 0);
  assert.equal(page.data.inspirationKeyboardHeight, 300);
  assert.equal(page.data.inspirationLiftStyle, '');
});

test('收尾复盘键盘事件只记录高度，不重建焦点节点或生成停靠样式', () => {
  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/gamepage/index');
  const page = makePage(definition, {
    isHost: true,
    closingCreativeEditFocus: false,
    closingKeyboardHeight: 0
  });
  page._closingNativeFocused = true;

  page.onClosingCreativeKeyboardHeightChange({ detail: { height: 300 } });

  assert.equal(page.data.closingKeyboardHeight, 300);
  assert.equal(page.data.closingCreativeEditFocus, false);
  assert.equal(Object.hasOwn(page.data, 'closingComposeLiftStyle'), false);
});

test('收尾复盘点击空白记录框必须切换到显式聚焦的原生 textarea', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const passiveTrigger = gameWxml.match(
    /<view\s+wx:else[\s\S]*?class="card-inline-textarea card-inline-textarea-hint closing-compose-trigger"[\s\S]*?<\/view>/
  );
  assert.ok(passiveTrigger, '未激活状态应使用不会被 scroll-view 吞焦点的普通点击框');
  assert.match(
    passiveTrigger[0],
    /bindtap="onClosingCreativeTitleTap"/,
    '点击框需要显式切换到 focus=true 的原生 textarea'
  );
  const focusedTextarea = gameWxml.match(
    /<textarea\s+wx:if="\{\{closingCreativeWantFocus\}\}"[\s\S]*?focus="\{\{true\}\}"[\s\S]*?\/>/
  );
  assert.ok(focusedTextarea, '点击后应渲染明确要求聚焦的原生 textarea');

  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/gamepage/index');
  const page = makePage(definition, {
    isHost: true,
    closingCreativeWantFocus: false,
    closingCreativeEditFocus: false,
    closingCreativeSaving: false
  });

  page.onClosingCreativeTitleTap();

  assert.equal(page.data.closingCreativeWantFocus, true);
  assert.equal(page.data.closingCreativeEditFocus, true);
});

test('收尾复盘右侧箭头必须直接触发发送，不能只依赖 form submit 命中', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const sendButton = gameWxml.match(
    /<button[\s\S]*?class="closing-compose-save-btn[\s\S]*?<\/button>/
  );
  assert.ok(sendButton, '应存在收尾复盘发送按钮');
  assert.match(
    sendButton[0],
    /bindtap="onClosingCreativeSendTap"/,
    '原生 textarea 可能覆盖 form 按钮，箭头必须有直接点击处理器'
  );
  assert.doesNotMatch(sendButton[0], /form-type="submit"/, '避免 tap 与 submit 双重发送');
  const gameWxss = read('pages/main-pages/partnerMode/gamepage/index.wxss');
  assert.match(
    gameWxss,
    /\.closing-compose-input-row \.card-inline-textarea\s*\{[\s\S]*?width:\s*0;/,
    '原生 textarea 的命中层必须严格止于发送箭头左侧'
  );

  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/gamepage/index');
  const page = makePage(definition, {
    isHost: true,
    closingCreativeSaving: false
  });
  let submitCalls = 0;
  page.onClosingCreativeFormSubmit = () => {
    submitCalls += 1;
  };

  page.onClosingCreativeSendTap({});

  assert.equal(submitCalls, 1);
});

test('收尾复盘瞬时失焦只保留草稿，不得自动提交', async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = [];
  global.setTimeout = (callback) => {
    timers.push(callback);
    return timers.length;
  };
  global.clearTimeout = () => {};

  try {
    const definition = loadPageDefinition('../../pages/main-pages/partnerMode/gamepage/index');
    let commitCalls = 0;
    const page = makePage(definition, {
      isHost: true,
      closingCreativeEditText: '刚输入的草稿',
      closingCreativeHasText: true,
      closingCreativeEditFocus: true,
      closingKeyboardHeight: 300
    });
    page._commitClosingCreativeEdit = () => {
      commitCalls += 1;
      return Promise.resolve();
    };

    page.onClosingCreativeBlur();
    while (timers.length) timers.shift()();
    await Promise.resolve();

    assert.equal(commitCalls, 0, '只有发送按钮才允许提交复盘文字');
    assert.equal(page.data.closingCreativeEditText, '刚输入的草稿');
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('收尾复盘追加 cloud:// 图片时保留 fileRef，避免同步成展示 HTTPS', () => {
  const { appendImageBlocks, imageFileRef, normalizeContentBlocks } = require('../../utils/partnerRoundContent');
  const cloudId = 'cloud://env.file/closing.jpg';
  const blocks = appendImageBlocks([], [cloudId]);
  assert.equal(imageFileRef(blocks[0]), cloudId);
  const normalized = normalizeContentBlocks(blocks);
  assert.equal(normalized[0].fileRef, cloudId);
});
