'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');
const { ROUTES, describeRoute } = require('../../modules/room-navigation/index');
const { projectPageSnapshot } = require('../../modules/room-session/page-model');

const ROUTE_MATRIX = Object.freeze({
  addPlayer: ['/pages/main-pages/addPlayer/index', 'addPlayer'],
  modeIndex: ['/pages/main-pages/modeIndex/index', 'auth'],
  subAwait: ['/pages/sub-pages/subAwait/index', 'subAwait'],
  submitProblem: ['/pages/main-pages/submitProblem/index', 'submitProblem'],
  selectProblem: ['/pages/main-pages/selectProblem/index', 'selectProblem'],
  selectPlayer: ['/pages/main-pages/selectPlayer/index', 'selectPlayer'],
  confirmFirstPlayer: ['/pages/main-pages/partnerMode/confirmFirstPlayer/index', 'confirmFirstPlayer'],
  partnerGame: ['/pages/main-pages/partnerMode/gamepage/index', 'gamepage'],
  closingStatement: ['/pages/main-pages/partnerMode/closingStatement/index', 'closingStatement'],
  leaderboard: ['/pages/leaderboard/index', 'leaderboard'],
  halliGame: ['/pages/main-pages/halliGalli/gamepage/index', 'gamepage'],
  creativeInput: ['/pages/main-pages/creativeInput/index', 'creativeInput'],
  creativeSummary: ['/pages/main-pages/creativeSummary/index', 'creativeSummary'],
  spyIntro: ['/packageSpy/pages/modeIndex/index', 'spyModeIndex'],
  spySpeak: ['/packageSpy/pages/speak/index', 'spySpeak'],
  spyVote: ['/packageSpy/pages/vote/index', 'spyVote'],
  spyResult: ['/packageSpy/pages/result/index', 'spyResult'],
  spySettle: ['/packageSpy/pages/settle/index', 'spySettle']
});

async function runCommand(harness, userId, type, fields) {
  const result = await harness.command(userId, type, fields);
  assert.equal(result.ok, true, `${type}: ${result.errCode || ''} ${result.errMsg || ''}`);
  return result;
}

async function assertRoutes(harness, expectedByUser, label) {
  for (const [userId, expectedRoute] of Object.entries(expectedByUser)) {
    const snapshot = await harness.snapshot(userId);
    assert.equal(snapshot.ok, true, `${label}/${userId} Snapshot 应成功`);
    assert.equal(snapshot.view.route.name, expectedRoute, `${label}/${userId} route`);

    const [expectedPath, expectedPageKey] = ROUTE_MATRIX[expectedRoute];
    const descriptor = describeRoute(snapshot.view.route, snapshot.roomId);
    assert.equal(descriptor.path, expectedPath, `${label}/${userId} physical path`);

    const page = projectPageSnapshot(snapshot.view, {
      roomId: snapshot.roomId,
      seq: snapshot.seq,
      stateVersion: snapshot.stateVersion,
      serverNow: snapshot.serverTime,
      ephemeral: snapshot.ephemeral
    });
    assert.equal(page.roomState.currentPage, expectedPageKey, `${label}/${userId} Page Model key`);
  }
}

function userForMember(snapshot, memberId) {
  const member = snapshot.view.room.members.find((item) => item.memberId === memberId);
  assert.ok(member, `找不到成员 ${memberId}`);
  return member.seatNo === 1 ? 'host' : `u${member.seatNo}`;
}

function assertBack(snapshot, commandType, after = 'FOLLOW_ROUTE') {
  const back = snapshot.view.navigation.back;
  if (!commandType) {
    assert.deepEqual(back, { kind: 'NONE' });
    return;
  }
  assert.equal(back.kind, 'COMMAND');
  assert.equal(back.commandType, commandType);
  assert.equal(back.after, after);
  assert.equal(back.context.sessionId, snapshot.view.session.sessionId);
  if (commandType !== 'CANCEL_WORKSHOP_SESSION') {
    assert.equal(back.context.workflowRevision, snapshot.view.session.workflow.revision);
  }
}

test('权威 route 注册表与业务文档中的物理页面一一对应', () => {
  assert.deepEqual(Object.keys(ROUTES).sort(), Object.keys(ROUTE_MATRIX).sort());
  Object.entries(ROUTE_MATRIX).forEach(([routeName, [path]]) => {
    assert.equal(ROUTES[routeName].path, path, routeName);
  });
});

test('Halli：角色分流、本人提交分流和完成态都能投影到正确页面', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await assertRoutes(h, { host: 'addPlayer', u2: 'addPlayer', u3: 'addPlayer' }, '大厅');
  assertBack(await h.snapshot('host'), null);

  await runCommand(h, 'host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  let host = await h.snapshot('host');
  const sessionId = host.view.session.sessionId;
  assert.equal(host.view.route.params.modeId, 'halliGalli', 'Halli 情境页必须显式携带 modeId');
  assertBack(host, 'CANCEL_WORKSHOP_SESSION', 'OPEN_MODE_PICKER');
  assertBack(await h.snapshot('u2'), null);
  await assertRoutes(h, { host: 'modeIndex', u2: 'subAwait', u3: 'subAwait' }, '选择情境');

  // 场次开始后加入者不是本场 Participant，始终停留在大厅旁观。
  await runCommand(h, 'u4', 'JOIN_ROOM', { payload: { nickName: '旁观成员' } });
  let observer = await h.snapshot('u4');
  assert.equal(observer.view.actor.isParticipant, false);
  assert.deepEqual(observer.view.route, { name: 'addPlayer', params: { observing: true } });

  await runCommand(h, 'host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' },
    payload: { source: 'CUSTOM', scenario: { scene: '社区', user: '居民', function: '协作' } }
  });
  await assertRoutes(h, { host: 'selectPlayer', u2: 'subAwait', u3: 'subAwait', u4: 'addPlayer' }, '选择首位');

  host = await h.snapshot('host');
  assertBack(host, 'RESET_SCENARIO');
  await runCommand(h, 'host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: host.view.actor.memberId }
  });
  await assertRoutes(h, { host: 'halliGame', u2: 'halliGame', u3: 'halliGame', u4: 'addPlayer' }, '线下活动');
  assertBack(await h.snapshot('host'), null);

  await runCommand(h, 'host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await assertRoutes(h, { host: 'creativeInput', u2: 'creativeInput', u3: 'creativeInput' }, '填写创意');

  await runCommand(h, 'host', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '创意 A' }
  });
  await assertRoutes(h, { host: 'creativeSummary', u2: 'creativeInput', u3: 'creativeInput' }, '房主已提交');

  await runCommand(h, 'u2', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '创意 B' }
  });
  await assertRoutes(h, { host: 'creativeSummary', u2: 'creativeSummary', u3: 'creativeInput' }, '两人已提交');

  await runCommand(h, 'u3', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '创意 C' }
  });
  await assertRoutes(h, { host: 'creativeSummary', u2: 'creativeSummary', u3: 'creativeSummary' }, '创意汇总');

  await runCommand(h, 'host', 'COMPLETE_HALLI_SESSION', { context: { sessionId } });
  await assertRoutes(h, { host: 'creativeSummary', u2: 'creativeSummary', u3: 'creativeSummary', u4: 'addPlayer' }, 'Halli 完成');
});

test('Partner：配置、行动、收尾和排行榜均投影到正确角色页面', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await runCommand(h, 'host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  let host = await h.snapshot('host');
  const sessionId = host.view.session.sessionId;
  assert.equal(host.view.route.params.modeId, 'partner', 'Partner 情境页必须显式携带 modeId');
  assertBack(host, 'CANCEL_WORKSHOP_SESSION', 'OPEN_MODE_PICKER');
  await assertRoutes(h, { host: 'modeIndex', u2: 'subAwait', u3: 'subAwait' }, 'Partner 选择情境');
  assert.equal((await h.snapshot('u2')).view.route.params.scene, 'bg');

  await runCommand(h, 'host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' },
    payload: { source: 'CUSTOM', scenario: { scene: '课堂', user: '学生', platform: '小程序', function: '协作' } }
  });
  await assertRoutes(h, { host: 'submitProblem', u2: 'submitProblem', u3: 'submitProblem' }, '收集问题');

  await runCommand(h, 'host', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '问题 A' }
  });
  await runCommand(h, 'u2', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '问题 B' }
  });
  await runCommand(h, 'u3', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '问题 C' }
  });
  await assertRoutes(h, { host: 'selectProblem', u2: 'selectProblem', u3: 'selectProblem' }, '选择问题');
  assertBack(await h.snapshot('host'), 'RESET_SCENARIO');
  assert.equal((await h.snapshot('u2')).view.navigation.back.kind, 'NONE');

  host = await h.snapshot('host');
  const problemId = host.view.session.setup.designProblems[0].contributionId;
  await runCommand(h, 'host', 'SELECT_DESIGN_PROBLEM', {
    context: { sessionId, workflowStep: 'SELECT_DESIGN_PROBLEM' },
    payload: { contributionId: problemId }
  });
  await assertRoutes(h, { host: 'selectPlayer', u2: 'subAwait', u3: 'subAwait' }, 'Partner 选择首位');
  assert.equal((await h.snapshot('u2')).view.route.params.scene, 'player');
  assert.equal((await h.snapshot('host')).view.actor.capabilities.RESET_DESIGN_PROBLEM.allowed, true);
  assertBack(await h.snapshot('host'), 'RESET_DESIGN_PROBLEM');

  await runCommand(h, 'host', 'RESET_DESIGN_PROBLEM', { context: { sessionId } });
  await assertRoutes(h, { host: 'selectProblem', u2: 'selectProblem', u3: 'selectProblem' }, '从选首位返回重选问题');
  assert.equal((await h.snapshot('host')).view.actor.capabilities.RESET_DESIGN_PROBLEM.allowed, false);

  await runCommand(h, 'host', 'SELECT_DESIGN_PROBLEM', {
    context: { sessionId, workflowStep: 'SELECT_DESIGN_PROBLEM' },
    payload: { contributionId: problemId }
  });
  await assertRoutes(h, { host: 'selectPlayer', u2: 'subAwait', u3: 'subAwait' }, '再次选择首位');

  host = await h.snapshot('host');
  const hostMemberId = host.view.actor.memberId;
  await runCommand(h, 'host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId: hostMemberId }
  });
  await assertRoutes(h, { host: 'confirmFirstPlayer', u2: 'subAwait', u3: 'subAwait' }, '确认首位');
  assert.equal((await h.snapshot('u2')).view.route.params.scene, 'confirmFirstPlayer');
  assertBack(await h.snapshot('host'), 'RESET_FIRST_PLAYER');
  assertBack(await h.snapshot('u2'), null);

  await runCommand(h, 'host', 'RESET_FIRST_PLAYER', { context: { sessionId } });
  await assertRoutes(h, { host: 'selectPlayer', u2: 'subAwait', u3: 'subAwait' }, '取消确认首位');
  assert.equal((await h.snapshot('u2')).view.route.params.scene, 'player');
  assert.equal((await h.snapshot('host')).view.actor.capabilities.RESET_FIRST_PLAYER.allowed, false);

  await runCommand(h, 'host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId: hostMemberId }
  });
  await assertRoutes(h, { host: 'confirmFirstPlayer', u2: 'subAwait', u3: 'subAwait' }, '再次确认首位');
  assert.equal((await h.snapshot('u2')).view.route.params.scene, 'confirmFirstPlayer');

  await runCommand(h, 'host', 'CONFIRM_FIRST_PLAYER', {
    context: { sessionId }, payload: { memberId: hostMemberId }
  });
  await assertRoutes(h, { host: 'partnerGame', u2: 'partnerGame', u3: 'partnerGame' }, 'Partner 行动');
  assertBack(await h.snapshot('host'), null);

  host = await h.snapshot('host');
  const firstTurnId = host.view.session.activeTurn.turnId;
  await runCommand(h, 'u2', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId: firstTurnId }, payload: { scoreHalfSteps: 8 }
  });
  await runCommand(h, 'u3', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId: firstTurnId }, payload: { scoreHalfSteps: 9 }
  });
  await runCommand(h, 'host', 'START_PARTNER_STATEMENT', { context: { sessionId, turnId: firstTurnId } });
  await assertRoutes(h, { host: 'partnerGame', u2: 'partnerGame', u3: 'partnerGame' }, 'Partner 表态');

  await runCommand(h, 'host', 'ADVANCE_PARTNER_TURN', {
    context: { sessionId, turnId: firstTurnId }, payload: { statementResult: 'allPass' }
  });
  host = await h.snapshot('host');
  const closingTurnId = host.view.session.activeTurn.turnId;
  const closingActor = userForMember(host, host.view.session.activeTurn.activeMemberId);
  await runCommand(h, closingActor, 'USE_PARTNER_SPECIAL', {
    context: { sessionId, turnId: closingTurnId }, payload: { kind: 'CLOSING' }
  });
  await assertRoutes(h, { host: 'closingStatement', u2: 'closingStatement', u3: 'closingStatement' }, '收尾投票');

  host = await h.snapshot('host');
  const closingVoteSessionId = host.view.session.publicModeState.closing.closingVoteSessionId;
  const voters = ['host', 'u2', 'u3'].filter((userId) => userId !== closingActor);
  for (const voter of voters) {
    await runCommand(h, voter, 'SUBMIT_PARTNER_CLOSING_VOTE', {
      context: { sessionId, closingVoteSessionId }, payload: { vote: 'pass' }
    });
  }
  await assertRoutes(h, { host: 'partnerGame', u2: 'partnerGame', u3: 'partnerGame' }, '补全符文');
  assert.equal(projectPageSnapshot((await h.snapshot('host')).view).roomState.partnerClosingStep, 'rune');

  await runCommand(h, 'host', 'ADVANCE_PARTNER_CLOSING', { context: { sessionId } });
  await assertRoutes(h, { host: 'partnerGame', u2: 'partnerGame', u3: 'partnerGame' }, '创意点复盘');
  assert.equal(projectPageSnapshot((await h.snapshot('host')).view).roomState.partnerClosingStep, 'review');

  await runCommand(h, 'host', 'COMPLETE_PARTNER_SESSION', { context: { sessionId } });
  await assertRoutes(h, { host: 'leaderboard', u2: 'leaderboard', u3: 'leaderboard' }, 'Partner 完成');
  const hostCompleted = await h.snapshot('host');
  const playerCompleted = await h.snapshot('u2');
  assert.deepEqual(hostCompleted.view.route.params, { from: 'closingEnd' });
  assert.deepEqual(playerCompleted.view.route.params, { from: 'closingEnd', isSubScreen: 1 });
  assert.match(describeRoute(hostCompleted.view.route, hostCompleted.roomId).url, /from=closingEnd/);
  assert.doesNotMatch(describeRoute(hostCompleted.view.route, hostCompleted.roomId).url, /isSubScreen/);
  assert.match(describeRoute(playerCompleted.view.route, playerCompleted.roomId).url, /isSubScreen=1/);
});

test('Spy：发言、投票、平票、轮次结果、下一轮和结算均投影到正确页面', async () => {
  const h = createHarness({
    wordPairPicker: () => ({
      id: 'route-pair', civilianWord: '苹果', civilianBlurb: '水果',
      spyWord: '梨', spyBlurb: '另一种水果'
    })
  });
  await h.seedMembers(3);
  await runCommand(h, 'host', 'START_WORKSHOP_SESSION', { payload: { mode: 'SPY' } });
  let host = await h.snapshot('host');
  const sessionId = host.view.session.sessionId;
  await assertRoutes(h, { host: 'spyIntro', u2: 'spyIntro', u3: 'spyIntro' }, 'Spy 规则页');
  assertBack(host, 'CANCEL_WORKSHOP_SESSION', 'OPEN_MODE_PICKER');
  assertBack(await h.snapshot('u2'), null);

  await runCommand(h, 'host', 'START_SPY_GAME', { context: { sessionId } });
  await assertRoutes(h, { host: 'spySpeak', u2: 'spySpeak', u3: 'spySpeak' }, 'Spy 发言');
  assertBack(await h.snapshot('host'), null);

  host = await h.snapshot('host');
  const gameId = host.view.session.publicModeState.gameId;
  await runCommand(h, 'host', 'OPEN_SPY_VOTE', {
    context: { sessionId, gameId, speakerTurnId: host.view.session.publicModeState.speakerTurnId }
  });
  await assertRoutes(h, { host: 'spyVote', u2: 'spyVote', u3: 'spyVote' }, 'Spy 投票');

  host = await h.snapshot('host');
  let voteSessionId = host.view.session.publicModeState.voteSessionId;
  const hostMemberId = host.view.actor.memberId;
  const u2MemberId = (await h.snapshot('u2')).view.actor.memberId;
  await runCommand(h, 'host', 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId }, payload: { targetMemberId: u2MemberId }
  });
  await runCommand(h, 'u2', 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId }, payload: { targetMemberId: hostMemberId }
  });
  await runCommand(h, 'u3', 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId }, payload: { abstain: true }
  });
  await assertRoutes(h, { host: 'spySpeak', u2: 'spySpeak', u3: 'spySpeak' }, 'Spy 平票加时');
  assert.equal((await h.snapshot('host')).view.session.workflow.step, 'SPY_TIE_SPEAK');

  while ((await h.snapshot('host')).view.session.workflow.step === 'SPY_TIE_SPEAK') {
    host = await h.snapshot('host');
    const state = host.view.session.publicModeState;
    await runCommand(h, userForMember(host, state.currentSpeakerMemberId), 'ADVANCE_SPY_SPEAKER', {
      context: { sessionId, gameId, speakerTurnId: state.speakerTurnId }
    });
  }
  await assertRoutes(h, { host: 'spyVote', u2: 'spyVote', u3: 'spyVote' }, 'Spy 平票重投');

  host = await h.snapshot('host');
  voteSessionId = host.view.session.publicModeState.voteSessionId;
  for (const userId of ['host', 'u2', 'u3']) {
    await runCommand(h, userId, 'SUBMIT_SPY_VOTE', {
      context: { sessionId, gameId, voteSessionId }, payload: { abstain: true }
    });
  }
  await assertRoutes(h, { host: 'spyResult', u2: 'spyResult', u3: 'spyResult' }, 'Spy 轮次结果');

  host = await h.snapshot('host');
  await runCommand(h, 'host', 'START_NEXT_SPY_ROUND', {
    context: { sessionId, gameId, roundNo: host.view.session.publicModeState.roundNo }
  });
  await assertRoutes(h, { host: 'spySpeak', u2: 'spySpeak', u3: 'spySpeak' }, 'Spy 下一轮');

  host = await h.snapshot('host');
  await runCommand(h, 'host', 'OPEN_SPY_VOTE', {
    context: { sessionId, gameId, speakerTurnId: host.view.session.publicModeState.speakerTurnId }
  });
  const cards = {};
  for (const userId of ['host', 'u2', 'u3']) {
    cards[userId] = (await h.snapshot(userId)).view.actor.privateModeState;
  }
  const spyUser = Object.keys(cards).find((userId) => cards[userId].role === 'spy');
  const spyMemberId = (await h.snapshot(spyUser)).view.actor.memberId;
  voteSessionId = (await h.snapshot('host')).view.session.publicModeState.voteSessionId;
  for (const userId of ['host', 'u2', 'u3']) {
    await runCommand(h, userId, 'SUBMIT_SPY_VOTE', {
      context: { sessionId, gameId, voteSessionId },
      payload: userId === spyUser ? { abstain: true } : { targetMemberId: spyMemberId }
    });
  }
  await assertRoutes(h, { host: 'spySettle', u2: 'spySettle', u3: 'spySettle' }, 'Spy 结算');

  await runCommand(h, 'host', 'COMPLETE_SPY_SESSION', { context: { sessionId, gameId } });
  await assertRoutes(h, { host: 'spySettle', u2: 'spySettle', u3: 'spySettle' }, 'Spy 完成');
});
