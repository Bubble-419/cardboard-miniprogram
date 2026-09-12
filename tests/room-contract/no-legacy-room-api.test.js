'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const legacyFunctions = [
  'clearRoomScores', 'finalizePartnerTurnRecord', 'getAddPlayerData', 'getDesignProblems',
  'getGameScoreStatus', 'getLeaderboard', 'postPartnerExpress', 'regenerateRoomQrcode',
  'roomClearBrainstormMode', 'roomCreate', 'roomDissolve', 'roomJoin', 'roomKickMember',
  'roomLeave', 'roomSetBrainstormMode', 'roomStartWorkshop', 'roomUpdateWorkshopName',
  'spyGameAction', 'submitClosingVote', 'submitCreativeIdea', 'submitDesignProblem',
  'submitGameScore', 'updateDesignProblem', 'updateRoomMemberProfile', 'updateRoomState'
];

function walkFiles(relativeDir, predicate = () => true) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const files = [];
  fs.readdirSync(absoluteDir, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === 'node_modules') return;
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(relative, predicate));
    else if (predicate(relative)) files.push(relative);
  });
  return files;
}

function existsWithExactCase(relativePath) {
  let cursor = root;
  for (const segment of relativePath.split('/')) {
    if (!fs.readdirSync(cursor).includes(segment)) return false;
    cursor = path.join(cursor, segment);
  }
  return true;
}

function registeredPages() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  return [
    ...(manifest.pages || []),
    ...(manifest.subPackages || []).flatMap((pack) =>
      (pack.pages || []).map((page) => `${pack.root}/${page}`))
  ];
}

test('app.json 中的页面均以准确大小写注册且文件完整', () => {
  registeredPages().forEach((page) => {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      const file = `${page}.${extension}`;
      assert.equal(existsWithExactCase(file), true, `缺少或大小写不一致: ${file}`);
    }
  });
});

test('房间运行时代码不直接访问数据库，也不调用旧房间云函数', () => {
  const runtimeFiles = [
    ...registeredPages().map((page) => `${page}.js`),
    ...walkFiles('modules', (file) => file.endsWith('.js')),
    ...walkFiles('utils', (file) => file.endsWith('.js')),
    ...walkFiles('packageSpy', (file) => file.endsWith('.js'))
  ];
  const legacyCallPattern = new RegExp(`name\\s*:\\s*['\"](?:${legacyFunctions.join('|')})['\"]`);
  runtimeFiles.forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /wx\.cloud\.database\s*\(/, `${file} 仍直接读取或写入数据库`);
    assert.doesNotMatch(source, legacyCallPattern, `${file} 仍调用旧房间云函数`);
  });
});

test('旧房间云函数和已下线页面不再进入代码树', () => {
  legacyFunctions.forEach((name) => {
    assert.equal(fs.existsSync(path.join(root, 'cloudfunctions', name)), false, `旧云函数仍存在: ${name}`);
  });
  [
    'pages/main-pages/selectMode',
    'pages/main-pages/partnerMode/statement',
    'pages/main-pages/partnerMode/closingEnd',
    'pages/main-pages/playSuccess',
    'pages/main-pages/playFail',
    'pages/sub-pages/selectProblem',
    'packageSpy/pages/assign',
    'packageSpy/pages/nextRound'
  ].forEach((relative) => {
    assert.equal(fs.existsSync(path.join(root, relative, 'index.js')), false, `已下线页面仍存在: ${relative}`);
  });
});
