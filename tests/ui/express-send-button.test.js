'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GAME_WXML = path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxml');
const GAME_WXSS = path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxss');
const GAME_JS = path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.js');

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
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
}

test('iOS 点击匿名表达输入框外部可收起键盘', () => {
  const wxml = fs.readFileSync(GAME_WXML, 'utf8');
  const js = fs.readFileSync(GAME_JS, 'utf8');
  const inputs = wxml.match(
    /<input[\s\S]*?class="spectator-express-input"[\s\S]*?\/>/g
  ) || [];
  const closeMethod = js.match(
    /closeExpressComposer\(\)\s*\{[\s\S]*?\r?\n  \},\r?\n\r?\n  onExpressComposerFocus/
  );

  assert.equal(inputs.length, 2, '讨论卡与旁观卡各有一个匿名表达输入框');
  inputs.forEach((markup) => {
    assert.match(markup, /hold-keyboard="\{\{false\}\}"/);
  });
  assert.ok(closeMethod);
  assert.match(closeMethod[0], /wx\.hideKeyboard\(/);
});

test('匿名表达输入框右侧有微信风格发送键，并使用全局绿色', () => {
  const wxml = fs.readFileSync(GAME_WXML, 'utf8');
  const wxss = fs.readFileSync(GAME_WXSS, 'utf8');
  const js = fs.readFileSync(GAME_JS, 'utf8');

  const sendButtons = wxml.match(
    /<button[\s\S]*?class="spectator-express-send-btn[\s\S]*?<\/button>/g
  ) || [];
  assert.equal(sendButtons.length, 2, '讨论卡与旁观卡各应有一个发送键');
  sendButtons.forEach((markup) => {
    assert.match(markup, />发送</);
    assert.match(markup, /catchtap="onExpressSendTap"/);
    assert.doesNotMatch(markup, /form-type="submit"/);
  });

  assert.match(wxss, /\.spectator-express-send-btn\s*\{[\s\S]*?background:\s*#5ec159;/);
  assert.match(js, /'onExpressSendTap'/);
});

test('打分星星与匿名表态按钮在同一行垂直居中对齐', () => {
  const wxss = fs.readFileSync(GAME_WXSS, 'utf8');
  const starWxss = fs.readFileSync(
    path.resolve(__dirname, '../../components/star-rating/index.wxss'),
    'utf8'
  );
  const stack = wxss.match(/\.spectator-bottom-stack\s*\{[\s\S]*?\n\}/)[0];
  const host = wxss.match(/\.star-rating-row > star-rating\s*\{[\s\S]*?\n\}/)[0];
  const fabRow = wxss.match(/\.spectator-express-fab-row\s*\{[\s\S]*?\n\}/)[0];
  const starRoot = starWxss.match(/\.star-rating\s*\{[\s\S]*?\n\}/)[0];

  assert.match(stack, /align-items:\s*center;/);
  assert.match(host, /display:\s*flex;/);
  assert.match(host, /align-items:\s*center;/);
  assert.match(host, /height:\s*var\(--star-hit-height\)/);
  assert.match(fabRow, /align-items:\s*center;/);
  assert.match(fabRow, /height:\s*var\(--star-hit-height\)/);
  assert.match(starRoot, /align-items:\s*center;/);
  assert.match(starRoot, /height:\s*100%;/);
});

test('讨论卡暂无匿名表达时使用紧凑空状态，不撑出大块空白', () => {
  const wxml = fs.readFileSync(GAME_WXML, 'utf8');
  const wxss = fs.readFileSync(GAME_WXSS, 'utf8');
  const discussion = wxml.match(/提出疑问并讨论[\s\S]*?暂无疑问讨论/)[0];
  assert.match(discussion, /spectator-chat-empty spectator-chat-empty-compact[\s\S]*?暂无匿名表达/);
  const compact = wxss.match(/\.spectator-chat-empty-compact\s*\{[\s\S]*?\n\}/)[0];
  assert.match(compact, /padding:\s*0 0 8rpx;/);
  assert.doesNotMatch(compact, /padding:\s*80rpx 0;/);
});

test('匿名表达键盘收起后关闭输入框并恢复打分状态', () => {
  const wxml = fs.readFileSync(GAME_WXML, 'utf8');
  const inputs = wxml.match(
    /<input[\s\S]*?class="spectator-express-input"[\s\S]*?\/>/g
  ) || [];
  inputs.forEach((markup) => {
    assert.match(markup, /bindkeyboardheightchange="onExpressKeyboardHeightChange"/);
  });

  const definition = loadPageDefinition();
  const page = makePage(definition, {
    expressComposerOpen: true,
    expressComposerNeedFocus: true,
    expressDraftText: '未发送的草稿',
    expressHasText: true,
    expressSending: false
  });
  page._expressDraftText = '未发送的草稿';
  page._flushPendingRoomContextIfIdle = () => {};

  page.onExpressKeyboardHeightChange({ detail: { height: 0 } });
  assert.equal(page.data.expressComposerOpen, true, '首次零高度事件不能误关刚挂载的输入框');

  page.onExpressKeyboardHeightChange({ detail: { height: 300 } });
  page.onExpressKeyboardHeightChange({ detail: { height: 0 } });

  assert.equal(page.data.expressComposerOpen, false);
  assert.equal(page.data.expressComposerNeedFocus, false);
  assert.equal(page.data.expressDraftText, '未发送的草稿');
});
