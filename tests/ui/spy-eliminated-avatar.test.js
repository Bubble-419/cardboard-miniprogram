'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const { buildSpyAvatarList } = require('../../packageSpy/utils/spyMode');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('buildSpyAvatarList 按 playerIndex 标记出局头像', () => {
  const members = [
    { playerIndex: 1, userId: 'u1', nickName: '甲', avatarImage: 'a.png', isMe: true },
    { playerIndex: 2, userId: 'u2', nickName: '乙', avatarImage: 'b.png', isMe: false },
    { playerIndex: 3, userId: 'u3', nickName: '丙', avatarImage: 'c.png', isMe: false }
  ];
  const spyPlayers = [
    { playerIndex: 1, alive: true },
    { playerIndex: 2, alive: false },
    { playerIndex: 3, alive: true }
  ];

  const list = buildSpyAvatarList(members, spyPlayers);
  assert.equal(list.length, 3);
  assert.equal(list[0].eliminated, false);
  assert.equal(list[1].eliminated, true);
  assert.equal(list[1].playerIndex, 2);
  assert.equal(list[2].eliminated, false);
});

test('buildSpyAvatarList 无 players 时全部未出局', () => {
  const list = buildSpyAvatarList([
    { playerIndex: 1, nickName: '甲', avatarImage: 'a.png' }
  ], null);
  assert.equal(list[0].eliminated, false);
});

test('user-list 默认视觉对 eliminated 叠黑色蒙版与白字 out', () => {
  const markup = read('components/user-list/index.wxml');
  const styles = read('components/user-list/index.wxss');
  assert.match(markup, /item\.eliminated \? 'is-eliminated'/);
  assert.match(markup, /avatar-eliminated-mask/);
  assert.match(markup, />out</);
  assert.match(styles, /\.avatar-img\.is-eliminated\s*\{[\s\S]*?grayscale/);
  assert.match(styles, /\.avatar-eliminated-mask\s*\{[\s\S]*?rgba\(0,\s*0,\s*0,\s*0\.55\)/);
  assert.match(styles, /\.avatar-eliminated-label\s*\{[\s\S]*?#ffffff/);
});

test('发言/投票/结果/结算页使用 buildSpyAvatarList', () => {
  const pages = [
    'packageSpy/pages/speak/index.js',
    'packageSpy/pages/vote/index.js',
    'packageSpy/pages/result/index.js',
    'packageSpy/pages/settle/index.js'
  ];
  for (const page of pages) {
    const source = read(page);
    assert.match(source, /buildSpyAvatarList/);
    assert.doesNotMatch(source, /avatarList:\s*buildAvatarList\(/);
  }
});
