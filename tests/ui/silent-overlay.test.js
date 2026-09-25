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
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/specialMove/index.js'),
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
  const sampling = special.match(/async _startSoundLevelSampling\(\) \{[\s\S]*?manager\.start\([\s\S]*?\}\);/);
  assert.ok(sampling, '当前行动者应在静默页本机采麦');
  assert.doesNotMatch(sampling[0], /if \(!this\.data\.isHost\) return;/);
  assert.match(sampling[0], /_ensureRecordAuth/);
  assert.match(sampling[0], /this\._broadcastSilentSoundLevel\(smooth\)/);
  assert.doesNotMatch(sampling[0], /if \(this\.data\.isHost\)/);
  assert.match(special, /const granted = !!\(settingRes\.authSetting[\s\S]*?if \(!granted\) this\._silentRecordDenied = true;/,
    '设置页仍未授权时应记住本页拒绝，避免轮询重复弹窗');
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
