const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
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
