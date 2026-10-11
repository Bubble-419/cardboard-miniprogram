'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withLocalScreens } = require('../../modules/room-navigation/localScreens');
const createLibrary = require('../../packageSpy/pages/cardLibrary/controller');
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

test('禁用页面滚动的 Spy owner 内，四类牌库必须由有界的内部 scroll-view 承载', () => {
  const owner = JSON.parse(read('packageSpy/pages/modeIndex/index.json'));
  assert.equal(owner.disableScroll, true, '保留 owner 原有滚动规则，不影响玩法说明等主屏幕');
  assert.match(read('packageSpy/pages/cardLibrary/view/index.wxml'), /include src="\.\.\/index\.wxml"/);
  assert.match(read('packageSpy/pages/cardLibrary/view/index.wxss'), /@import "\.\.\/index\.wxss"/);
  const template = read('packageSpy/pages/cardLibrary/index.wxml');
  assert.match(template, /<scroll-view[^>]*class="category-list"[^>]*scroll-y="\{\{!viewerOpen\}\}"/);
  assert.match(template, /<scroll-view[\s\S]*wx:for="\{\{categories\}\}"[\s\S]*<\/scroll-view>/);
  assert.match(template, /<\/scroll-view>[\s\S]*class="viewer-mask"/, '翻牌叠层必须在滚动容器之外');
  const styles = read('packageSpy/pages/cardLibrary/index.wxss');
  assert.match(styles, /\.container\s*\{[^}]*height:\s*100vh/);
  assert.match(styles, /\.container\s*\{[^}]*display:\s*flex/);
  assert.match(styles, /\.category-list\s*\{[^}]*flex:\s*1/);
  assert.match(styles, /\.category-list\s*\{[^}]*min-height:\s*0/);
  assert.match(styles, /\.category-list\s*\{[^}]*height:\s*0/);
  assert.match(styles, /padding-bottom:\s*calc\(200rpx \+ env\(safe-area-inset-bottom\)\)/,
    '固定后退按钮和安全区不能遮挡最后一类词卡');
});

test('牌库最后一类词卡仍可打开/关闭；后退只关闭本地屏幕并保留 owner 与草稿', async () => {
  const previous = { wx: global.wx, getApp: global.getApp };
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    showLoading() {}, hideLoading() {}, showToast() {},
    cloud: { callFunction() { assert.fail('本地翻阅不能发送 Command'); } },
    navigateBack() { assert.fail('牌库后退不能修改微信页面栈'); }
  };
  const definition = withLocalScreens({ data: { draft: '保持原来的输入' } }, {
    '/library': { name: 'library', routes: ['spyIntro'], create: createLibrary,
      intents: ['onTapCard', 'onCloseViewer', 'handleGoBack'] }
  });
  const page = { ...definition, route: 'packageSpy/pages/modeIndex/index',
    data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }
  };
  try {
    page.onLoad({}); page.onShow();
    const opened = page._localScreens.open('/library');
    const token = page.data.localScreens.at(-1).token;
    page._localScreens.ready(token, {});
    assert.equal((await opened).ok, true);
    const screen = page._localScreens.current();
    assert.equal(screen.data.categories.length, 4);
    assert.equal(screen.data.cards.length, 36);
    const last = screen.data.categories.at(-1).cards.at(-1);
    page._localScreens.intent(token, 'onTapCard', { currentTarget: { dataset: { word: last.word } } });
    assert.equal(screen.data.selectedCard.word, last.word);
    assert.equal(screen.data.viewerOpen, true);
    page._localScreens.intent(token, 'onCloseViewer', {});
    assert.equal(screen.data.viewerOpen, false);
    assert.equal(page._localScreens.current(), screen, '关闭翻牌不关闭牌库');
    await page._localScreens.intent(token, 'handleGoBack', {});
    assert.equal(page.data.localScreenActive, false);
    assert.equal(page.route, 'packageSpy/pages/modeIndex/index');
    assert.equal(page.data.draft, '保持原来的输入');
  } finally {
    page.onUnload();
    Object.assign(global, previous);
  }
});
