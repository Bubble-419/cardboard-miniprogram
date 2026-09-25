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

test('全局回顾把收尾创意复盘生成为唯一且不属于轮次的专属卡', () => {
  const page = makePage(loadPageDefinition());
  page.data.sessionId = 'session-1';
  const summary = page._buildClosingReviewCard({
    partnerClosingCreativePoints: {
      blocks: [
        { type: 'text', text: '第一条', key: 'closing-1' },
        { type: 'image', url: 'cloud://env/review.jpg', key: 'closing-2' },
        { type: 'text', text: '第二条', key: 'closing-3' }
      ]
    }
  }, []);

  assert.equal(summary.cardType, 'closingReview');
  assert.equal(summary.reviewCardKey, 'closing-review:session-1');
  assert.equal('round' in summary, false);
  assert.equal('playerIndex' in summary, false);
  assert.equal('playBlocks' in summary, false);
  assert.equal('discussionBlocks' in summary, false);
  assert.deepEqual(
    summary.closingReviewBlocks.map((item) => item.key),
    ['closing-1', 'closing-2', 'closing-3']
  );
  assert.deepEqual(summary.closingReviewNotes, ['第一条', '第二条']);
  assert.deepEqual(summary.closingReviewImages, ['cloud://env/review.jpg']);
});

test('旧数据中重复附着的创意复盘只迁移成一张去重专属卡', () => {
  const page = makePage(loadPageDefinition());
  const duplicated = [{ type: 'text', text: '同一条', key: 'old-1' }];
  const card = page._buildClosingReviewCard({}, [
    { round: 2, closingReviewBlocks: duplicated },
    { round: 2, closingReviewBlocks: duplicated }
  ]);

  assert.equal(card.cardType, 'closingReview');
  assert.equal(card.closingReviewBlocks.length, 1);
  assert.equal(card.closingReviewBlocks[0].text, '同一条');
});

test('全局回顾卡片独立展示创意复盘文本与图片', () => {
  const markup = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.wxml'),
    'utf8'
  );

  assert.match(markup, />创意点复盘<\/text>/);
  assert.match(markup, /wx:if="\{\{item\.cardType === 'closingReview'\}\}"/);
  assert.match(markup, /class="closing-badge">收尾阶段<\/view>/);
  assert.match(markup, /wx:for="\{\{item\.closingReviewBlocks\}\}"/);
  assert.match(markup, /bindtap="onReviewClosingImagePreview"/);
  assert.doesNotMatch(markup, /data-scope="closingReview"/);
});
