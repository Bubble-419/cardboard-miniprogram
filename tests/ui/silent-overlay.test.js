'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('静默模式其他成员叠入 specialMove，仅房主采麦并广播声纹', () => {
  const gamepage = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.js'),
    'utf8'
  );
  const special = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/specialMove/index.js'),
    'utf8'
  );
  const routes = fs.readFileSync(
    path.resolve(__dirname, '../../utils/modeRoutes.js'),
    'utf8'
  );
  assert.match(gamepage, /this\.data\.isCurrentPlayer \? \{\} : \{ silent: 1 \}/);
  assert.match(routes, /url \+= '&silent=1'/);
  assert.match(special, /joinSilent \? 'silent' : 'wheel'/);
  assert.match(special, /async _startSoundLevelSampling\(\) \{[\s\S]*?if \(!this\.data\.isHost\) return;/);
  assert.match(special, /this\._broadcastSilentSoundLevel\(smooth\)/);
  assert.match(special, /_canEndSilent\(\) \{\n    return this\.data\.isCurrentPlayer === true;/);
  assert.match(fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/specialMove/index.wxml'),
    'utf8'
  ), /wx:if="\{\{canEndSilent\}\}"/);
});
