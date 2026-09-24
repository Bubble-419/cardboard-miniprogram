'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

test('自定义导航页面统一使用标准返回图标资源，不再混用字符和旧图标', () => {
  const pageTemplates = [
    'pages/inspiration/index.wxml',
    'pages/main-pages/selectPlayer/index.wxml',
    'pages/main-pages/partnerMode/confirmFirstPlayer/index.wxml',
    'pages/main-pages/partnerMode/specialMove/index.wxml'
  ];

  pageTemplates.forEach((relativePath) => {
    const wxml = read(relativePath);
    assert.match(wxml, /src="\/assets\/icons\/icon-nav-back\.svg"/, relativePath);
    assert.doesNotMatch(wxml, /class="back-chevron"|icon-special-back\.svg|miniprogram-btn\.png/, relativePath);
  });
});

test('返回图标统一为 40rpx，点击热区统一为至少 72rpx', () => {
  const standardStyles = [
    ['components/custom-navbar/index.wxss', 'navbar-back', 'navbar-back-icon'],
    ['components/player-top-bar/index.wxss', 'back-entry', 'back-entry-icon'],
    ['pages/inspiration/index.wxss', 'navbar-left', 'back-icon'],
    ['pages/main-pages/selectPlayer/index.wxss', 'navbar-left', 'back-icon'],
    ['pages/main-pages/partnerMode/confirmFirstPlayer/index.wxss', 'navbar-left', 'back-icon'],
    ['pages/main-pages/partnerMode/specialMove/index.wxss', 'section-back', 'section-back-icon']
  ];

  standardStyles.forEach(([relativePath, hitClass, iconClass]) => {
    const wxss = read(relativePath);
    const hitRules = Array.from(
      wxss.matchAll(new RegExp(`\\.${hitClass}\\s*\\{[\\s\\S]*?\\}`, 'g')),
      (match) => match[0]
    ).join('\n');
    const iconRules = Array.from(
      wxss.matchAll(new RegExp(`\\.${iconClass}\\s*\\{[\\s\\S]*?\\}`, 'g')),
      (match) => match[0]
    ).join('\n');
    assert.ok(hitRules, `${relativePath} 缺少 ${hitClass}`);
    assert.match(hitRules, /(?:min-)?width:\s*(?:72|80|96|174)rpx;/, `${relativePath} 返回热区宽度不足`);
    assert.match(hitRules, /(?:min-)?height:\s*(?:64|72)rpx;|top:\s*0;[\s\S]*?bottom:\s*0;/, `${relativePath} 返回热区高度不足`);
    assert.ok(iconRules, `${relativePath} 缺少 ${iconClass}`);
    assert.match(iconRules, /width:\s*40rpx;/);
    assert.match(iconRules, /height:\s*40rpx;/);
  });
});

test('排行榜不展示返回入口', () => {
  const wxml = read('pages/leaderboard/index.wxml');
  const js = read('pages/leaderboard/index.js');
  assert.doesNotMatch(wxml, /icon-nav-back|bindtap="handleBack"/);
  assert.doesNotMatch(js, /handleBack\s*\(/);
});
