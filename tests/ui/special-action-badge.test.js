'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

test('特殊行动卡统一使用 Master模式 / 反面随机拼 / 静默模式 标签', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const specialWxml = read('pages/main-pages/partnerMode/specialMove/index.wxml');
  const gameJs = read('pages/main-pages/partnerMode/gamepage/index.js');
  const gameWxss = read('pages/main-pages/partnerMode/gamepage/index.wxss');
  const specialWxss = read('pages/main-pages/partnerMode/specialMove/index.wxss');

  assert.match(gameJs, /specialActionBadge: roomState\.partnerMasterMode === true\s*\? 'Master模式'/);
  assert.match(gameJs, /partnerSilentMode === true \? '静默模式'/);
  assert.match(gameWxml, /class="special-mode-badge">\{\{specialActionBadge\}\}/);
  assert.match(specialWxml, /class="special-mode-badge">反面随机拼</);
  assert.match(specialWxml, /class="special-mode-badge">静默模式</);
  assert.doesNotMatch(gameWxml, /MASTER模式/);
  assert.doesNotMatch(specialWxml, /MASTER模式/);
  assert.match(gameWxss, /\.special-mode-badge\s*\{/);
  assert.match(specialWxss, /\.special-mode-badge\s*\{/);
});
