'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('静默模式其他成员叠入 specialMove，全员本机采麦测 40dB', () => {
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
  const appJson = fs.readFileSync(
    path.resolve(__dirname, '../../app.json'),
    'utf8'
  );
  assert.match(gamepage, /this\.data\.isCurrentPlayer \? \{\} : \{ silent: 1 \}/);
  assert.match(routes, /url \+= '&silent=1'/);
  assert.match(special, /joinSilent \? 'silent' : 'wheel'/);
  const sampling = special.match(/async _startSoundLevelSampling\(\) \{[\s\S]*?manager\.start\([\s\S]*?\}\);/);
  assert.ok(sampling, '应存在全员本机采麦');
  assert.doesNotMatch(sampling[0], /if \(!this\.data\.isHost\) return;/);
  assert.match(sampling[0], /_ensureRecordAuth/);
  assert.match(sampling[0], /if \(this\.data\.isHost\) this\._broadcastSilentSoundLevel\(smooth\)/);
  assert.match(appJson, /"scope\.record"/);
  assert.match(special, /_canEndSilent\(\) \{\s*return this\.data\.isCurrentPlayer === true;/);
  assert.match(fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/specialMove/index.wxml'),
    'utf8'
  ), /wx:if="\{\{canEndSilent\}\}"/);
});
