'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeModeDisplayTitle,
  titleForModeId,
  PARTNER_MODE_DISPLAY_TITLE
} = require('../../utils/modeDisplayNames');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('titleForModeId 覆盖四套在线模式', () => {
  assert.equal(titleForModeId('partner'), PARTNER_MODE_DISPLAY_TITLE);
  assert.equal(titleForModeId('spy'), '谁是卧底模式');
  assert.equal(titleForModeId('halliGalli'), '德国心脏病模式');
  assert.equal(titleForModeId('ganDengYan'), '干瞪眼模式');
  assert.equal(titleForModeId(''), '');
  assert.equal(titleForModeId(null), '');
});

test('normalizeModeDisplayTitle 在无标题时按 modeId 回退', () => {
  assert.equal(normalizeModeDisplayTitle('', 'spy'), '谁是卧底模式');
  assert.equal(normalizeModeDisplayTitle('', 'halliGalli'), '德国心脏病模式');
  assert.equal(normalizeModeDisplayTitle('', 'partner'), PARTNER_MODE_DISPLAY_TITLE);
  assert.equal(normalizeModeDisplayTitle('自定义标题', 'spy'), '自定义标题');
  assert.equal(normalizeModeDisplayTitle('合伙人模式', 'x'), PARTNER_MODE_DISPLAY_TITLE);
});

test('PageModel 投影 selectedModeTitle，房间页不依赖双条件标题', () => {
  const pageModel = read('modules/room-session/page-model.js');
  assert.match(pageModel, /selectedModeTitle:\s*session \? titleForModeId\(modeId\(session\.mode\)\) : ''/);

  const wxml = read('pages/main-pages/addPlayer/index.wxml');
  assert.match(wxml, /wx:if="\{\{hasSelectedMode\}\}"/);
  assert.match(wxml, /selectedModeTitle \|\| '游戏进行中'/);
  assert.doesNotMatch(wxml, /hasSelectedMode && selectedModeTitle/);
});
