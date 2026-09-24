'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { callCloudFunction } = require('../../utils/cloudApi');

test('二维码等直连云函数丢失回调时按统一超时返回', async () => {
  global.getApp = () => ({ globalData: { cloudReady: Promise.resolve() } });
  global.wx = {
    cloud: {
      callFunction() { return new Promise(() => {}); }
    }
  };

  await assert.rejects(
    callCloudFunction('roomMedia', { action: 'qrcode' }, { timeoutMs: 5 }),
    (error) => error.code === 'DEPENDENCY_UNAVAILABLE' && error.retryable === true
  );
});
