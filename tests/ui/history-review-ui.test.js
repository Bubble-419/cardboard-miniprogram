'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('全局回顾展示全部纪要卡、允许横滑，并返回排行榜', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxml'),
    'utf8'
  );
  const js = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.js'),
    'utf8'
  );
  assert.match(wxml, /disable-touch="\{\{!isHistoryReview &&/);
  assert.match(wxml, /wx:if="\{\{isHistoryReview\}\}"[\s\S]*bindtap="handleGoBack"/);
  assert.match(js, /expectedPrev:\s*'pages\/leaderboard\/index'/);
  assert.match(js, /if \(isReview\) return true/);
  assert.match(js, /innerScrollLocked:\s*false/);
});
