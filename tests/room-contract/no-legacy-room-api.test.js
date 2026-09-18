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
  'roomLeave', 'roomPresence', 'roomSetBrainstormMode', 'roomStartWorkshop', 'roomUpdateWorkshopName',
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
    ...walkFiles('pages', (file) => file.endsWith('.js')),
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
    'pages/main-pages/createRoom',
    'pages/main-pages/setRoom',
    'pages/main-pages/firstplayer',
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

test('小程序运行时协议包不依赖未上传的 workspace node_modules', () => {
  const runtimeFiles = [
    path.join(root, 'packages/room-client/index.js'),
    path.join(root, 'packages/room-projection/index.js'),
    path.join(root, 'packages/room-contracts/index.js')
  ];
  runtimeFiles.forEach((file) => {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /require\(['"]@cardboard\//,
      `${path.relative(root, file)} 必须使用随小程序上传的相对依赖`);
  });
});

test('语音转写不再绕过 V3 协议写旧房间', () => {
  const source = fs.readFileSync(path.join(root, 'cloudfunctions/speechToText/src/entry.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'pages/main-pages/partnerMode/utils/partnerRoundSpeech.js'), 'utf8');
  assert.doesNotMatch(source, /ROOMS_COLLECTION|partnerCurrentRoundContent|collection\s*\(\s*['"]rooms['"]\s*\)/);
  assert.match(client, /dispatchRoomCommand\s*\(\s*['"]APPEND_ARTIFACT['"]/);
  assert.match(client, /segmentContext\s*=\s*\{ roomId, sessionId: session\.sessionId, turnId: turn\.turnId, phase \}/);
  assert.match(client, /workflowStep: context\.phase === ['"]discussion['"]/);
});

test('历史回看按 sessionId 读取归档 View，不使用当前房间快照', () => {
  const home = fs.readFileSync(path.join(root, 'pages/main-pages/aaa/index.js'), 'utf8');
  const cards = fs.readFileSync(path.join(root, 'pages/main-pages/aaa/index.wxml'), 'utf8');
  const game = fs.readFileSync(path.join(root, 'pages/main-pages/partnerMode/gamepage/index.js'), 'utf8');
  assert.match(cards, /data-session-id="\{\{item\.sessionId\}\}"/);
  assert.match(home, /sessionId=\$\{encodeURIComponent\(sessionId\)\}/);
  assert.match(game, /getRoomSessionPageSnapshot\(roomId, sessionId\)/);
});

test('Partner 页面不缓存上一份服务端 View 来掩盖投影缺失', () => {
  const pages = [
    'pages/main-pages/partnerMode/gamepage/index.js',
    'pages/main-pages/partnerMode/specialMove/index.js'
  ];
  pages.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(source, /_lastRawRoundSummaries/,
      `${relativePath} 必须只消费当前完整 Member View`);
  });
});

test('扫码路径只在尚未加入时携带 fromScan，房间号主动加入后不重复提交', () => {
  const home = fs.readFileSync(path.join(root, 'pages/main-pages/aaa/index.js'), 'utf8');
  assert.match(home, /async _handleMiniProgramPathScan[\s\S]*?await this\._goToScanJoinRoom\(roomId\)/);
  assert.match(home, /async _joinRoomAndGo[\s\S]*?await this\._goToRoomPage\(roomId\)/);
});

test('瞬时声贝信号必须绑定当前 sessionId 和 turnId', () => {
  const source = fs.readFileSync(path.join(root, 'cloudfunctions/roomSignal/src/entry.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(root, 'packages/room-cloudbase-adapter/index.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'pages/main-pages/partnerMode/specialMove/index.js'), 'utf8');
  assert.match(source, /app\.writeSignal\(\{ roomId, signalType, sessionId, turnId/);
  assert.match(adapter, /scope\.sessionId !== input\.sessionId/);
  assert.match(adapter, /scope\.turnId !== input\.turnId/);
  assert.match(page, /data:\s*\{ roomId, sessionId, turnId, signalType:/);
});
