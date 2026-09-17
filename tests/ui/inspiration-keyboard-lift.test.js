'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInspirationKeyboardLift } = require('../../utils/inspirationKeyboardLift');

test('Android webview 缩小后只补偿差值，避免输入栏被顶出屏幕', () => {
  const heights = [800, 500];
  let call = 0;
  global.wx = {
    getWindowInfo() {
      return { windowHeight: heights[Math.min(call++, heights.length - 1)], screenHeight: 800 };
    }
  };
  const lift = createInspirationKeyboardLift();
  lift.captureBase();
  assert.equal(lift.resolveLiftPx(300), 0);
  assert.equal(lift.buildBarStyle(300), '');
});

test('收尾复盘追加 cloud:// 图片时保留 fileRef，避免同步成展示 HTTPS', () => {
  const { appendImageBlocks, imageFileRef, normalizeContentBlocks } = require('../../utils/partnerRoundContent');
  const cloudId = 'cloud://env.file/closing.jpg';
  const blocks = appendImageBlocks([], [cloudId]);
  assert.equal(imageFileRef(blocks[0]), cloudId);
  const normalized = normalizeContentBlocks(blocks);
  assert.equal(normalized[0].fileRef, cloudId);
});

test('未缩小窗口时按键盘高度用 position:fixed 抬起输入栏', () => {
  global.wx = {
    getWindowInfo() {
      return { windowHeight: 800, screenHeight: 800 };
    }
  };
  const lift = createInspirationKeyboardLift();
  lift.captureBase();
  assert.equal(lift.resolveLiftPx(320), 320);
  const style = lift.buildBarStyle(320, { background: '#fafafa' });
  assert.match(style, /position:fixed/);
  assert.match(style, /bottom:320px/);
  assert.doesNotMatch(style, /transform/);
});
