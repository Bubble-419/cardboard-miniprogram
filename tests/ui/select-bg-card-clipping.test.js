'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('新建情境卡片在 swiper 内保留上下安全留白，避免边框和阴影被裁切', () => {
  const wxss = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/selectBG/index.wxss'
  ), 'utf8');

  assert.match(wxss, /\.cards-swiper\s*\{[^}]*height:\s*740rpx;/);
  assert.match(wxss, /\.card-item\s*\{[^}]*padding:\s*20rpx 0 28rpx;[^}]*box-sizing:\s*border-box;/);
  assert.match(wxss, /\.card-padding\s*\{[^}]*height:\s*100%;[^}]*display:\s*flex;[^}]*align-items:\s*center;/);
});
