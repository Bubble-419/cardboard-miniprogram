'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSpyRevealPlayers } = require('../../packageSpy/utils/spyGameState');

test('Spy 结算 reveal 把 nickName/词语映射为页面可展示字段', () => {
  const rows = buildSpyRevealPlayers({
    players: [
      { memberId: 'm2', playerIndex: 2, name: '乙', nickName: '乙' },
      { memberId: 'm1', playerIndex: 1, name: '甲', nickName: '甲' },
      { memberId: 'm3', playerIndex: 3, name: '丙', nickName: '丙' }
    ],
    reveal: [
      { memberId: 'm2', nickName: '乙', role: 'spy', word: '梨', alive: true },
      { memberId: 'm1', nickName: '甲', role: 'civilian', word: '苹果', alive: false },
      { memberId: 'm3', nickName: '丙', role: 'civilian', word: '苹果', alive: true }
    ]
  });

  assert.deepEqual(rows.map((row) => ({
    playerIndex: row.playerIndex,
    name: row.name,
    word: row.word,
    roleLabel: row.roleLabel,
    alive: row.alive
  })), [
    { playerIndex: 1, name: '甲', word: '苹果', roleLabel: '平民', alive: false },
    { playerIndex: 2, name: '乙', word: '梨', roleLabel: '卧底', alive: true },
    { playerIndex: 3, name: '丙', word: '苹果', roleLabel: '平民', alive: true }
  ]);
});

test('Spy 结算页全员身份为两行左对齐，列表词语不可点开', () => {
  const root = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'packageSpy/pages/settle/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'packageSpy/pages/settle/index.wxml'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'packageSpy/pages/settle/index.wxss'), 'utf8');
  const pageJson = fs.readFileSync(path.join(root, 'packageSpy/pages/settle/index.json'), 'utf8');
  assert.match(source, /buildSpyRevealPlayers/);
  assert.match(source, /onTapRevealWord/);
  assert.match(source, /onViewerHorizontalSwipe/);
  assert.match(source, /buildGamePairCards/);
  assert.match(template, /全员身份与词语/);
  assert.match(template, /player-main/);
  assert.match(template, /\{\{item\.name\}\}/);
  assert.match(template, /class="player-word">\{\{item\.word\}\}/);
  assert.match(template, /\{\{item\.roleLabel\}\}/);
  assert.doesNotMatch(
    template,
    /player-word[\s\S]*?catchtap="onTapRevealWord"/
  );
  assert.match(styles, /\.player-main\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(styles, /\.player-main\s*\{[\s\S]*?align-items:\s*flex-start/);
  assert.match(template, /enableHorizontalSwipe="\{\{true\}\}"/);
  assert.match(template, /bind:horizontalswipe="onViewerHorizontalSwipe"/);
  assert.match(template, /bind:fullscreen="onOpenCardFullscreen"/);
  assert.match(pageJson, /flip-word-card/);
});
