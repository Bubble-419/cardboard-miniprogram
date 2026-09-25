const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('德国心脏病与干瞪眼共用活动页启用胶囊对齐的紧凑头像条', () => {
  const pageWxml = read('pages/main-pages/halliGalli/gamepage/index.wxml');
  const pageWxss = read('pages/main-pages/halliGalli/gamepage/index.wxss');
  const topBarWxml = read('components/player-top-bar/index.wxml');
  const userListWxss = read('components/user-list/index.wxss');

  assert.match(pageWxml, /<player-top-bar[\s\S]*?compactAvatars="\{\{true\}\}"/);
  assert.match(topBarWxml, /compactStack="\{\{compactAvatars\}\}"/);
  assert.match(userListWxss, /\.layout-stack\.compact-stack[\s\S]*?height:\s*64rpx/);
  assert.match(userListWxss, /\.layout-stack\.compact-stack\.fold \.avatar-wrap[\s\S]*?width:\s*64rpx/);
  assert.match(pageWxss, /\.topbar-fixed\s*\{[\s\S]*?width:\s*100%/);
  assert.doesNotMatch(pageWxss, /\.topbar-fixed\s*>\s*player-top-bar/);
});
