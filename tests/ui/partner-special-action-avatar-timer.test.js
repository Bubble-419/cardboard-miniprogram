const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadPageDefinition() {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    showToast() {},
    getStorageSync() { return null; },
    setStorageSync() {},
    getWindowInfo() { return { windowHeight: 800, statusBarHeight: 44 }; },
    getMenuButtonBoundingClientRect() { return { top: 48, height: 32, width: 87, right: 360 }; }
  };
  const modulePath = require.resolve('../../pages/main-pages/partnerMode/specialMove/index');
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition, data) {
  const page = {
    ...definition,
    data: { ...definition.data, ...data },
    setData(patch) { Object.assign(this.data, patch); }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key].bind(page);
  });
  return page;
}

test('three playable special actions keep the countdown on the acting avatar', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const specialWxml = read('pages/main-pages/partnerMode/specialMove/index.wxml');

  assert.match(gameWxml, /specialMoveActive="\{\{!!specialActionBadge\}\}"/);
  assert.match(
    specialWxml,
    /specialMoveActive="\{\{viewMode === 'reverseRandom' \|\| viewMode === 'silent' \|\| selectedAction === 'master' \|\| selectedAction === 'helpLuck' \|\| selectedAction === 'silent'\}\}"/
  );
});

test('closing stage does not enable the acting-avatar countdown', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const specialWxml = read('pages/main-pages/partnerMode/specialMove/index.wxml');

  assert.match(gameWxml, /interactive="\{\{gamepagePhase !== 'closing'\}\}"/);
  const timerBinding = specialWxml.match(/specialMoveActive="([^"]+)"/);
  assert.ok(timerBinding);
  assert.doesNotMatch(timerBinding[1], /selectedAction === 'closing'/);
});

test('closing stage clears player pointing arrow for rune and review steps', () => {
  const gameWxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const gameJs = read('pages/main-pages/partnerMode/gamepage/index.js');

  assert.match(
    gameWxml,
    /indicatorUser="\{\{gamepagePhase === 'closing' \? -1 : indicatorPlayerIndex\}\}"/
  );
  assert.match(
    gameWxml,
    /actingUser="\{\{isHistoryReview \|\| gamepagePhase === 'closing' \? -1 : currentPlayerIndex\}\}"/
  );
  assert.match(gameJs, /isClosingPhase\(this\.data\.gamepagePhase\)\) return -1/);
  assert.match(gameJs, /isClosingPhase\(roomPhase\) \? -1 : paginationState\.indicatorPlayerIndex/);
});

test('特殊行动横滑历史卡片时箭头仍固定在当前行动者', () => {
  const definition = loadPageDefinition();
  const page = makePage(definition, {
    currentPlayerIndex: 3,
    indicatorPlayerIndex: 3,
    displayRoundSummaries: [
      { playerIndex: 1, reviewCardKey: 'old-1' },
      { playerIndex: 2, reviewCardKey: 'old-2' }
    ],
    cardSlides: [
      { slideType: 'history', playerIndex: 1 },
      { slideType: 'history', playerIndex: 2 },
      { slideType: 'silent' }
    ],
    cardCount: 3,
    cardIndex: 2
  });

  page.onCardSwiperChange({ detail: { current: 0 } });

  assert.equal(page.data.cardIndex, 0);
  assert.equal(page.data.indicatorPlayerIndex, 3);
});
