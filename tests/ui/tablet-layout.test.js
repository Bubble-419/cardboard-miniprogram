'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('iPad 宽屏下主页面内容保持居中并限制阅读宽度', () => {
  const styles = read('app.wxss');
  const tabletRule = styles.match(/@media\s+screen\s+and\s+\(min-width:\s*768px\)\s*\{[\s\S]*\n\}/);

  assert.ok(tabletRule, '应提供常见 iPad 宽度断点');
  assert.match(tabletRule[0], /\.container\s*,\s*\.page/);
  assert.match(tabletRule[0], /max-width:\s*640px;/);
  assert.match(tabletRule[0], /margin-left:\s*auto;/);
  assert.match(tabletRule[0], /margin-right:\s*auto;/);
});

test('iPad 上身份牌与底部弹层不会继续按整屏宽度拉伸', () => {
  const styles = read('packageSpy/pages/speak/index.wxss');
  assert.match(styles, /@media\s+screen\s+and\s+\(min-width:\s*768px\)/);
  assert.match(styles, /\.page-shell\s*\{[\s\S]*?max-width:\s*640px;/);
  assert.match(styles, /\.viewer-sheet\s*\{[\s\S]*?max-width:\s*640px;/);
});

test('RoomShell 的等待与收尾组件在样式隔离下也限制平板宽度', () => {
  [
    'components/room-wait-screen/index.wxss',
    'components/partner-closing-vote-screen/index.wxss'
  ].forEach((relativePath) => {
    const styles = read(relativePath);
    assert.match(styles, /@media\s+screen\s+and\s+\(min-width:\s*768px\)/, relativePath);
    assert.match(styles, /:host\s*\{[\s\S]*?max-width:\s*640px;/, relativePath);
    assert.match(styles, /margin:\s*0 auto;/, relativePath);
  });
});
