const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const expectedDescription = '每轮行动 1–3 次，可新开方案，也可延续他人想法。每次行动后，简要说明你的想法。';
const expectedActions = ['出 1 张卡牌', '删 1 张卡牌', '调整 1 张卡牌', '交换 2 张卡牌'];
const removedActionDetails = ['新开或延续方案', '改变卡牌朝向', '移动卡牌位置', '互换卡牌位置'];

test('出牌规则卡使用完整说明和四项简洁动作名称', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const silentWxml = read('pages/main-pages/partnerMode/specialMove/index.wxml');

  for (const wxml of [gameWxml, silentWxml]) {
    assert.match(wxml, new RegExp(expectedDescription));
    for (const title of expectedActions) {
      assert.match(wxml, new RegExp(title));
    }
    for (const detail of removedActionDetails) assert.doesNotMatch(wxml, new RegExp(detail));
    assert.doesNotMatch(wxml, /翻 1 张卡牌/);
  }
});

test('普通与静默行动插画区域都固定为 4:3', () => {
  const gameWxss = read('pages/main-pages/partnerMode/gamepage/index.wxss');
  const specialWxss = read('pages/main-pages/partnerMode/specialMove/index.wxss');

  assert.match(gameWxss, /\.action-illus\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(specialWxss, /\.silent-action-illus\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/);
});
