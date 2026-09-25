const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('干瞪眼活动页不展示空情境，并使用不依赖情境的出牌说明', () => {
  const js = read('pages/main-pages/halliGalli/gamepage/index.js');
  const wxml = read('pages/main-pages/halliGalli/gamepage/index.wxml');

  assert.match(js, /isGanDengYan:\s*\(result\.selectedModeId \|\| roomState\.selectedModeId\) === 'ganDengYan'/);
  assert.match(wxml, /class="header-section" wx:if="\{\{!isGanDengYan\}\}"/);
  assert.match(wxml, /isGanDengYan \? '说明卡牌组合产生的想法' : '说明如何与情境信息结合'/);
});
