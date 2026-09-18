'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const {
  CDN_HOST,
  STATIC_PREFIX,
  WAIT_HERO_SRC,
  EMPTY_HISTORY_SRC,
  PACK_IGNORE_FOR_CDN,
  staticCdnUrl
} = require('../../utils/staticCdn');
const { getWordCardAssets, CARD_BACK_WEBP } = require('../../packageSpy/utils/spyWordCardAssets');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('CDN URL 编码中文文件名，并使用云存储公有域名', () => {
  const url = staticCdnUrl('/packageSpy/assets/interactionCards/webp/开关3x.webp');
  assert.equal(
    url,
    `${CDN_HOST}/${STATIC_PREFIX}/packageSpy/assets/interactionCards/webp/${encodeURIComponent('开关3x.webp')}`
  );
  assert.match(WAIT_HERO_SRC, /^https:\/\//);
  assert.match(EMPTY_HISTORY_SRC, /empty-history-6f27f1\.webp$/);
});

test('Spy 交互卡与牌背改为 CDN URL，不再引用代码包路径', () => {
  const assets = getWordCardAssets('开关');
  assert.equal(assets.assignedWordSrc, staticCdnUrl('packageSpy/assets/interactionCards/webp/开关3x.webp'));
  assert.equal(assets.word1Src, staticCdnUrl('packageSpy/assets/interactionCards/webp/开关13x.webp'));
  assert.equal(CARD_BACK_WEBP, staticCdnUrl('packageSpy/assets/interactionCards/webp/背面3x.webp'));
  assert.doesNotMatch(assets.assignedWordSrc, /^\/packageSpy\//);
});

test('packOptions 排除已改走 CDN 的插图，保留小图标在代码包', () => {
  const config = JSON.parse(read('project.config.json'));
  const ignore = (config.packOptions && config.packOptions.ignore) || [];
  PACK_IGNORE_FOR_CDN.forEach((rule) => {
    assert.ok(
      ignore.some((item) => item.type === rule.type && item.value === rule.value),
      `missing pack ignore ${rule.type}:${rule.value}`
    );
  });
  assert.ok(!ignore.some((item) => item.value === 'assets/icons' || item.value === 'assets/avatar'));
});

test('等待页 / 首页 / 模式封面 / Halli 步骤图不再写死本地大图路径', () => {
  const subAwaitWxml = read('pages/sub-pages/subAwait/index.wxml');
  const closingWxml = read('pages/main-pages/partnerMode/closingStatement/index.wxml');
  const homeWxml = read('pages/main-pages/aaa/index.wxml');
  const subAwaitJs = read('pages/sub-pages/subAwait/index.js');
  const closingJs = read('pages/main-pages/partnerMode/closingStatement/index.js');
  const homeJs = read('pages/main-pages/aaa/index.js');
  const brainstormJs = read('pages/main-pages/brainstormMode/index.js');
  const halliJs = read('pages/main-pages/halliGalli/gamepage/index.js');

  assert.match(subAwaitWxml, /src="\{\{waitHeroSrc\}\}"/);
  assert.match(closingWxml, /src="\{\{waitHeroSrc\}\}"/);
  assert.match(homeWxml, /src="\{\{emptyHistorySrc\}\}"/);
  assert.doesNotMatch(subAwaitWxml, /\/assets\/subAwait\/wait-hero-5a8ea5\.webp/);
  assert.doesNotMatch(homeWxml, /\/assets\/home\/empty-history-6f27f1\.webp/);
  assert.match(subAwaitJs, /WAIT_HERO_SRC/);
  assert.match(closingJs, /WAIT_HERO_SRC/);
  assert.match(homeJs, /EMPTY_HISTORY_SRC/);
  assert.match(brainstormJs, /staticCdnUrl\('assets\/brainstormMode\/mode-cover-/);
  assert.match(halliJs, /staticCdnUrl\(`assets\/halliGalli\/step-\$\{key\}\.webp`\)/);
});

test('Halli CDN 步骤图加载失败时回退到随包 PNG', () => {
  const halliJs = read('pages/main-pages/halliGalli/gamepage/index.js');
  const halliWxml = read('pages/main-pages/halliGalli/gamepage/index.wxml');
  const config = JSON.parse(read('project.config.json'));
  const ignore = (config.packOptions && config.packOptions.ignore) || [];

  assert.match(halliJs, /onStepImgError\(e\)/);
  assert.match(halliJs, /`\/assets\/halliGalli\/step-\$\{key\}\.png`/);
  assert.equal((halliWxml.match(/binderror="onStepImgError"/g) || []).length, 6);
  assert.equal((halliWxml.match(/data-key=/g) || []).length, 6);
  assert.ok(!ignore.some((item) => item.value === 'assets/halliGalli/*.png'),
    '随包 PNG 不能被 packOptions 排除');
});
