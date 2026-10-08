const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('卧底投票/结果/结算顶栏与标题左对齐，并启用胶囊同高紧凑头像', () => {
  const pages = [
    'packageSpy/pages/vote/index.wxml',
    'packageSpy/pages/result/index.wxml',
    'packageSpy/pages/settle/index.wxml'
  ];

  for (const page of pages) {
    const wxml = read(page);
    assert.match(
      wxml,
      /<player-top-bar[\s\S]*?padLeftRpx="\{\{48\}\}"[\s\S]*?compactAvatars="\{\{true\}\}"/
    );
    assert.doesNotMatch(
      wxml,
      /<view class="header-section">\s*<player-top-bar/
    );
  }

  const speakWxml = read('packageSpy/pages/speak/index.wxml');
  assert.match(speakWxml, /compactAvatars="\{\{true\}\}"/);

  const topBarJs = read('components/player-top-bar/index.js');
  assert.match(topBarJs, /avatarNeedRpx:\s*64/);

  const topBarWxss = read('components/player-top-bar/index.wxss');
  assert.match(topBarWxss, /:host\s*\{[\s\S]*?display:\s*block/);

  const metrics = read('utils/capsuleTopBar.js');
  assert.match(metrics, /options\.avatarNeedRpx/);
});
