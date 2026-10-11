'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('静默模式其他成员留在游戏卡片并保留匿名表达与打分', () => {
  const gamepage = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.js'),
    'utf8'
  );
  const special = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/specialMove/controller.js'),
    'utf8'
  );
  const gameWxml = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxml'),
    'utf8'
  );
  const appJson = fs.readFileSync(
    path.resolve(__dirname, '../../app.json'),
    'utf8'
  );
  assert.doesNotMatch(gamepage, /_openSilentOverlayIfNeeded/);
  assert.doesNotMatch(gamepage, /\{ silent: 1 \}/);
  assert.match(gameWxml, /spectator-card-head \{\{specialActionBadge/);
  assert.match(gameWxml, /class="star-rating-shell/);
  assert.match(gameWxml, /class="spectator-express-slot/);
  assert.match(gameWxml, /borderVariant="\{\{cardBorderVariant\}\}"/);
  // 采麦、授权与多角色广播行为由 partner-silent-sound 的运行时测试覆盖。
  assert.doesNotMatch(
    appJson,
    /"scope\.record"/,
    '录音权限应通过 wx.authorize 运行时申请，app.json.permission 不支持 scope.record'
  );
  assert.match(special, /_canEndSilent\(\) \{\s*return this\.data\.isCurrentPlayer === true;/);
  assert.match(fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/specialMove/index.wxml'),
    'utf8'
  ), /wx:if="\{\{canEndSilent\}\}"/);
});
