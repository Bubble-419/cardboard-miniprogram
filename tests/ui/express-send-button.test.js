'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GAME_WXML = path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxml');
const GAME_WXSS = path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxss');
const GAME_JS = path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.js');

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
