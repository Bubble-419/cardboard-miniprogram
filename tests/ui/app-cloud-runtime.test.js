'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '../..');

test('资源方小程序使用自身云环境初始化，不经过跨应用共享鉴权', async () => {
  const source = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
  const calls = { directInit: [], sharedCloud: [] };
  let appDefinition = null;

  function SharedCloud(options) {
    calls.sharedCloud.push(options);
    this.init = async () => {};
  }

  const wx = {
    cloud: {
      Cloud: SharedCloud,
      init(options) { calls.directInit.push(options); },
      callFunction() {},
      downloadFile() {}
    }
  };
  const context = {
    wx,
    App(definition) { appDefinition = definition; },
    require(request) {
      if (request === './utils/scanJoinGate') return { beginScanJoinFromLaunch() {} };
      throw new Error(`unexpected require: ${request}`);
    },
    console
  };

  vm.runInNewContext(source, context, { filename: 'app.js' });
  appDefinition.onLaunch.call(appDefinition, {});
  await appDefinition.globalData.cloudReady;

  assert.equal(calls.sharedCloud.length, 0);
  assert.equal(calls.directInit.length, 1);
  assert.equal(calls.directInit[0].env, 'cardboard-miniprogram-6a13aab073');
  assert.equal(appDefinition.globalData.cloud, wx.cloud);
});
