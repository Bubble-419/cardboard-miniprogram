const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const expectedCount = '每轮可行动';
const expectedCountRange = '1–3 次';
const expectedDescription = '下方任意一种操作均算 1 次行动。可新开方案或延续他人想法，行动后请简要说明。';
const expectedActions = ['出 1 张卡牌', '删 1 张卡牌', '调整 1 张卡牌', '交换 2 张卡牌'];
const removedActionDetails = ['新开或延续方案', '改变卡牌朝向', '移动卡牌位置', '互换卡牌位置'];

test('出牌规则卡使用完整说明和四项简洁动作名称', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const silentWxml = read('pages/main-pages/partnerMode/specialMove/index.wxml');

  for (const wxml of [gameWxml, silentWxml]) {
    assert.match(wxml, new RegExp(expectedCount));
    assert.match(wxml, new RegExp(expectedCountRange));
    assert.match(wxml, new RegExp(expectedDescription));
    for (const title of expectedActions) {
      assert.match(wxml, new RegExp(title));
    }
    for (const detail of removedActionDetails) assert.doesNotMatch(wxml, new RegExp(detail));
    assert.doesNotMatch(wxml, /翻 1 张卡牌/);
  }
});

test('行动次数与行动定义分层展示', () => {
  const gameWxss = read('pages/main-pages/partnerMode/gamepage/index.wxss');
  const specialWxss = read('pages/main-pages/partnerMode/specialMove/index.wxss');

  assert.match(gameWxss, /\.action-guidance\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(gameWxss, /\.action-count-number\s*\{[\s\S]*?font-weight:\s*800/);
  assert.match(specialWxss, /\.silent-guidance\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(specialWxss, /\.silent-action-count-number\s*\{[\s\S]*?font-weight:\s*800/);
});

test('普通状态参考 Master 模式的横向标题结构，并使用描边徽章区分', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const gameWxss = read('pages/main-pages/partnerMode/gamepage/index.wxss');

  assert.match(gameWxml, /action-title-row action-title-row-regular[\s\S]*?regular-mode-badge">普通模式/);
  assert.match(gameWxml, /action-title action-title-regular">请进行卡牌行动并解释/);
  assert.match(gameWxss, /\.regular-mode-badge\s*\{[\s\S]*?background:\s*#f2faef[\s\S]*?border:\s*2rpx solid #5ec159/);
  assert.match(gameWxss, /\.action-title-regular\s*\{[\s\S]*?font-size:\s*36rpx[\s\S]*?text-align:\s*left/);
  assert.match(gameWxss, /\.action-guidance\s*\{[\s\S]*?align-items:\s*flex-start/);
});

test('普通与静默行动插画区域都固定为 4:3', () => {
  const gameWxss = read('pages/main-pages/partnerMode/gamepage/index.wxss');
  const specialWxss = read('pages/main-pages/partnerMode/specialMove/index.wxss');

  assert.match(gameWxss, /\.action-illus\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(specialWxss, /\.silent-action-illus\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/);
});

test('反面随机拼使用正方形插画，提示标题与出牌标题字号一致', () => {
  const gameWxss = read('pages/main-pages/partnerMode/gamepage/index.wxss');
  const specialWxss = read('pages/main-pages/partnerMode/specialMove/index.wxss');

  assert.match(specialWxss, /\.reverse-step-illus\s*\{[\s\S]*?aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(gameWxss, /\.action-title\s*\{[\s\S]*?font-size:\s*52rpx/);
  assert.match(specialWxss, /\.reverse-card-inner \.special-action-title\s*\{[\s\S]*?font-size:\s*52rpx/);
});
