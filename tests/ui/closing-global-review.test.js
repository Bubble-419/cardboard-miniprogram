'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GAME_JS = path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.js');

function loadPageDefinition() {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: {} });
  global.wx = {};
  delete require.cache[require.resolve(GAME_JS)];
  require(GAME_JS);
  delete require.cache[require.resolve(GAME_JS)];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition) {
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key].bind(page);
  });
  return page;
}

test('全局回顾把收尾创意复盘按原顺序归入实际行动玩家卡片', () => {
  const page = makePage(loadPageDefinition());
  const summary = page._buildActiveReviewSummary({
    partnerClosingCreativePoints: {
      blocks: [
        { type: 'text', text: '第一条', key: 'closing-1' },
        { type: 'image', url: 'cloud://env/review.jpg', key: 'closing-2' },
        { type: 'text', text: '第二条', key: 'closing-3' }
      ]
    }
  }, {
    playHistory: [],
    discussionNotes: [],
    playImages: [],
    discussionImages: [],
    playBlocks: [],
    discussionBlocks: [],
    voiceLines: [],
    turnRecords: []
  }, {
    currentRound: 7,
    turnId: 'turn-closing',
    playerIndex: 3,
    playerName: '玩家丙'
  });

  assert.equal(summary.round, 7);
  assert.equal(summary.turnId, 'turn-closing');
  assert.equal(summary.playerIndex, 3);
  assert.equal(summary.playerName, '玩家丙');
  assert.deepEqual(
    summary.closingReviewBlocks.map((item) => item.key),
    ['closing-1', 'closing-2', 'closing-3']
  );
  assert.deepEqual(summary.closingReviewNotes, ['第一条', '第二条']);
  assert.deepEqual(summary.closingReviewImages, ['cloud://env/review.jpg']);
});

test('全局回顾卡片独立展示创意复盘文本与图片', () => {
  const markup = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxml'),
    'utf8'
  );

  assert.match(markup, />创意复盘<\/text>/);
  assert.match(markup, /wx:for="\{\{item\.closingReviewBlocks\}\}"/);
  assert.match(markup, /data-scope="closingReview"/);
});
