const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('干瞪眼活动页隐藏情境并展示独立的四步图文规则', () => {
  const js = read('pages/main-pages/halliGalli/gamepage/index.js');
  const wxml = read('pages/main-pages/halliGalli/gamepage/index.wxml');

  assert.match(js, /isGanDengYan:\s*\(result\.selectedModeId \|\| roomState\.selectedModeId\) === 'ganDengYan'/);
  assert.match(wxml, /class="header-section" wx:if="\{\{!isGanDengYan\}\}"/);
  assert.match(wxml, /class="gan-steps-list" wx:if="\{\{isGanDengYan\}\}"/);

  const rules = [
    ['rule-deal.jpg', '洗牌发牌', '打乱所有卡牌，随机分给玩家，每人获得相同数量的卡牌。'],
    ['rule-first-play.jpg', '首位出牌', '放下第一张卡牌，按基础连接原则继续拼接，直到无法继续。'],
    ['rule-connect.jpg', '依次接牌', '下一位玩家从已拼卡牌的任一可连接处延伸，之后依次进行。'],
    ['rule-win.jpg', '获胜条件', '最先出完手中所有卡牌的玩家获胜。']
  ];

  rules.forEach(([file, title, description]) => {
    assert.match(wxml, new RegExp(`/assets/ganDengYan/${file.replace('.', '\\.')}`));
    assert.ok(wxml.includes(`<text class="step-title">${title}</text>`));
    assert.ok(wxml.includes(`<text class="step-desc">${description}</text>`));
    assert.ok(fs.existsSync(path.join(root, 'assets/ganDengYan', file)), `missing ${file}`);
  });

  assert.doesNotMatch(wxml, /isGanDengYan\s*\?/);
  assert.match(wxml, /class="steps-card" wx:else/);
  assert.match(wxml, /class="key-highlight" wx:if="\{\{!isGanDengYan\}\}"/);
});

test('干瞪眼规则改为单列横向卡片，为中文说明保留足够行宽', () => {
  const wxss = read('pages/main-pages/halliGalli/gamepage/index.wxss');

  assert.match(wxss, /\.gan-steps-list\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(wxss, /\.gan-step-card\s*\{[\s\S]*?display:\s*flex/);
  assert.match(wxss, /\.gan-step-image-wrap\s*\{[\s\S]*?width:\s*220rpx/);
  assert.match(wxss, /\.gan-step-copy\s*\{[\s\S]*?padding:\s*24rpx/);
});
