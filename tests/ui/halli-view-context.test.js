'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('德国心脏病活动页点击情境可打开 confirmBG 只读叠卡', () => {
  const wxml = read('pages/main-pages/halliGalli/gamepage/index.wxml');
  const js = read('pages/main-pages/halliGalli/gamepage/index.js');
  const detail = read('components/room-scenario-detail/controller.js');

  assert.match(wxml, /context-display[\s\S]*?bind:opentap="handleViewContext"/);
  assert.match(js, /handleViewContext\s*\(/);
  assert.match(js, /from=halli/);
  assert.match(js, /partnerMode\/confirmBG\/index/);
  assert.match(detail, /from === 'halli'/);
  assert.match(detail, /halliGalli\/gamepage\/index/);
  assert.match(detail, /hasViewableScenarioBG/);
});

test('干瞪眼仍不展示情境格', () => {
  const wxml = read('pages/main-pages/halliGalli/gamepage/index.wxml');
  assert.match(wxml, /header-section" wx:if="\{\{!isGanDengYan\}\}"/);
});
