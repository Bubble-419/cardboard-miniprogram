'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');
const { applyProjectedEvent } = require('@cardboard/room-projection');
const { validateMemberView } = require('@cardboard/room-contracts');
const { projectPageSnapshot } = require('../../modules/room-session/page-model');
const { describeRoute } = require('../../modules/room-navigation/index');

const ALL_VIEWERS = Object.freeze(['host', 'u2', 'u3']);

async function executeAndReduce(harness, actorUserId, type, fields, viewerUserIds = ALL_VIEWERS) {
  const beforeByViewer = new Map();
  for (const viewerUserId of viewerUserIds) {
    beforeByViewer.set(viewerUserId, await harness.snapshot(viewerUserId));
  }
  const result = await harness.command(actorUserId, type, fields);
  assert.equal(result.ok, true, `${type}: ${result.errCode || ''} ${result.errMsg || ''}`);

  let primaryAfter = null;
  for (const viewerUserId of viewerUserIds) {
    const before = beforeByViewer.get(viewerUserId);
    const batch = await harness.app.sync('12345678', before.seq, { userId: viewerUserId });
    assert.equal(batch.ok, true);
    assert.equal(batch.delivery, 'EVENTS', `${type}/${viewerUserId} 应使用增量 Event`);
    let reduced = before.view;
    batch.events.forEach((event) => { reduced = applyProjectedEvent(reduced, event); });

    const after = await harness.snapshot(viewerUserId);
    assert.deepEqual(
      reduced,
      after.view,
      `${type}/${viewerUserId} 的 Event 结果必须与最新 Snapshot 完全一致`
    );
    assert.equal(
      validateMemberView(after.view, '12345678'),
      true,
      `${type}/${viewerUserId} 后必须生成完整 MemberView`
    );
    assert.ok(describeRoute(after.view.route, after.roomId), `${type}/${viewerUserId} 必须有可用路由`);
    const page = projectPageSnapshot(after.view, {
      roomId: after.roomId,
      seq: after.seq,
      stateVersion: after.stateVersion,
      serverNow: after.serverTime,
      ephemeral: after.ephemeral
    });
    assert.equal(page.ok, true, `${type}/${viewerUserId} 必须能完整还原 Page Model`);
    if (viewerUserId === viewerUserIds[0]) primaryAfter = after;
  }
  return { result, snapshot: primaryAfter };
}

function assertScreen(snapshot, workflowStep, routeName) {
  const session = snapshot.view.session;
  if (workflowStep) assert.equal(session.workflow.step, workflowStep);
  assert.equal(snapshot.view.route.name, routeName);
  const descriptor = describeRoute(snapshot.view.route, snapshot.roomId);
  assert.ok(descriptor, `${routeName} 必须有客户端路由描述`);
  const page = projectPageSnapshot(snapshot.view, {
    roomId: snapshot.roomId,
    seq: snapshot.seq,
    stateVersion: snapshot.stateVersion,
    serverNow: snapshot.serverTime,
    ephemeral: snapshot.ephemeral
  });
  assert.equal(page.ok, true);
  assert.equal(typeof page.roomState.currentPage, 'string');
  assert.notEqual(page.roomState.currentPage, '');
}

function userForMember(snapshot, memberId) {
  const member = snapshot.view.room.members.find((item) => item.memberId === memberId);
  assert.ok(member, `找不到成员 ${memberId}`);
  return member.seatNo === 1 ? 'host' : `u${member.seatNo}`;
}

test('E2E Halli Galli：情境 → 首位 → 线下活动 → 全员创意 → 汇总 → 完成', async () => {
  const h = createHarness();
  await h.seedMembers(3);

  let state = await executeAndReduce(h, 'host', 'START_WORKSHOP_SESSION', {
    payload: { mode: 'HALLI_GALLI' }
  });
  const sessionId = state.snapshot.view.session.sessionId;
  assertScreen(state.snapshot, 'CHOOSE_SCENARIO', 'modeIndex');

  state = await executeAndReduce(h, 'host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' },
    payload: {
      source: 'CUSTOM',
      scenario: { scene: '社区', user: '居民', function: '协作' }
    }
  });
  assertScreen(state.snapshot, 'SELECT_FIRST_PLAYER', 'selectPlayer');

  state = await executeAndReduce(h, 'host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: state.snapshot.view.actor.memberId }
  });
  assertScreen(state.snapshot, 'HALLI_ACTIVITY', 'halliGame');

  state = await executeAndReduce(h, 'host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  assertScreen(state.snapshot, 'HALLI_CREATIVE', 'creativeInput');

  state = await executeAndReduce(h, 'host', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '创意 A' }
  });
  assertScreen(state.snapshot, 'HALLI_CREATIVE', 'creativeSummary');
  await executeAndReduce(h, 'u2', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '创意 B' }
  });
  state = await executeAndReduce(h, 'u3', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '创意 C' }
  });
  assertScreen(state.snapshot, 'HALLI_SUMMARY', 'creativeSummary');
  assert.deepEqual(state.snapshot.view.session.publicModeState.ideas.map((item) => item.text), [
    '创意 A', '创意 B', '创意 C'
  ]);

  state = await executeAndReduce(h, 'host', 'COMPLETE_HALLI_SESSION', { context: { sessionId } });
  assert.equal(state.snapshot.view.session.status, 'COMPLETED');
  assertScreen(state.snapshot, 'HALLI_SUMMARY', 'creativeSummary');
});

test('E2E Partner：完整配置、行动、评分、表态、收尾、回顾与排行榜', async () => {
  const h = createHarness();
  await h.seedMembers(3);

  let state = await executeAndReduce(h, 'host', 'START_WORKSHOP_SESSION', {
    payload: { mode: 'PARTNER' }
  });
  const sessionId = state.snapshot.view.session.sessionId;
  assertScreen(state.snapshot, 'CHOOSE_SCENARIO', 'modeIndex');

  state = await executeAndReduce(h, 'host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' },
    payload: {
      source: 'CUSTOM',
      scenario: { scene: '课堂', user: '学生', platform: '小程序', function: '协作' }
    }
  });
  assertScreen(state.snapshot, 'COLLECT_DESIGN_PROBLEMS', 'submitProblem');

  await executeAndReduce(h, 'host', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '如何让协作更顺畅？' }
  });
  await executeAndReduce(h, 'u2', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '如何降低沟通成本？' }
  });
  state = await executeAndReduce(h, 'u3', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '如何快速达成共识？' }
  });
  assertScreen(state.snapshot, 'SELECT_DESIGN_PROBLEM', 'selectProblem');
  const selectingPlayer = await h.snapshot('u2');
  assert.equal(selectingPlayer.view.route.name, 'selectProblem');
  assert.equal(selectingPlayer.view.session.setup.designProblems.length, 3);

  const problemId = state.snapshot.view.session.setup.designProblems[0].contributionId;
  state = await executeAndReduce(h, 'host', 'SELECT_DESIGN_PROBLEM', {
    context: { sessionId, workflowStep: 'SELECT_DESIGN_PROBLEM' },
    payload: { contributionId: problemId }
  });
  assertScreen(state.snapshot, 'SELECT_FIRST_PLAYER', 'selectPlayer');

  const hostMemberId = state.snapshot.view.actor.memberId;
  state = await executeAndReduce(h, 'host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: hostMemberId }
  });
  assertScreen(state.snapshot, 'CONFIRM_FIRST_PLAYER', 'confirmFirstPlayer');
  const waitingPlayer = await h.snapshot('u2');
  assert.equal(waitingPlayer.view.route.name, 'subAwait');
  assert.equal(waitingPlayer.view.route.params.scene, 'confirmFirstPlayer');

  state = await executeAndReduce(h, 'host', 'CONFIRM_FIRST_PLAYER', {
    context: { sessionId }, payload: { memberId: hostMemberId }
  });
  assertScreen(state.snapshot, 'PARTNER_TURN', 'partnerGame');
  const firstTurnId = state.snapshot.view.session.activeTurn.turnId;

  await executeAndReduce(h, 'host', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId: firstTurnId, workflowStep: 'PARTNER_TURN' },
    payload: { operationId: 'e2e-card-1', text: '共享创意卡' }
  });
  await executeAndReduce(h, 'u2', 'POST_PARTNER_MESSAGE', {
    context: { sessionId, turnId: firstTurnId, workflowStep: 'PARTNER_TURN' },
    payload: { text: '可以换个角度' }
  });
  await executeAndReduce(h, 'u2', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId: firstTurnId }, payload: { scoreHalfSteps: 7 }
  });
  await executeAndReduce(h, 'u3', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId: firstTurnId }, payload: { scoreHalfSteps: 8 }
  });
  state = await executeAndReduce(h, 'host', 'START_PARTNER_STATEMENT', {
    context: { sessionId, turnId: firstTurnId }
  });
  assertScreen(state.snapshot, 'PARTNER_STATEMENT', 'partnerGame');

  state = await executeAndReduce(h, 'host', 'ADVANCE_PARTNER_TURN', {
    context: { sessionId, turnId: firstTurnId }, payload: { statementResult: 'allPass' }
  });
  assertScreen(state.snapshot, 'PARTNER_TURN', 'partnerGame');
  const closingTurnId = state.snapshot.view.session.activeTurn.turnId;
  const closingActor = userForMember(state.snapshot, state.snapshot.view.session.activeTurn.activeMemberId);

  state = await executeAndReduce(h, closingActor, 'USE_PARTNER_SPECIAL', {
    context: { sessionId, turnId: closingTurnId }, payload: { kind: 'CLOSING' }
  });
  assertScreen(state.snapshot, 'PARTNER_CLOSING_VOTE', 'closingStatement');
  const closingVoteSessionId = state.snapshot.view.session.publicModeState.closing.closingVoteSessionId;
  const voters = ['host', 'u2', 'u3'].filter((userId) => userId !== closingActor);
  await executeAndReduce(h, voters[0], 'SUBMIT_PARTNER_CLOSING_VOTE', {
    context: { sessionId, closingVoteSessionId }, payload: { vote: 'pass' }
  });
  state = await executeAndReduce(h, voters[1], 'SUBMIT_PARTNER_CLOSING_VOTE', {
    context: { sessionId, closingVoteSessionId }, payload: { vote: 'pass' }
  });
  assertScreen(state.snapshot, 'PARTNER_CLOSING_RUNE', 'partnerGame');

  state = await executeAndReduce(h, 'host', 'ADVANCE_PARTNER_CLOSING', { context: { sessionId } });
  assertScreen(state.snapshot, 'PARTNER_CLOSING_REVIEW', 'partnerGame');
  await executeAndReduce(h, 'host', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId: closingTurnId, workflowStep: 'PARTNER_CLOSING_REVIEW' },
    payload: { operationId: 'e2e-closing-card', text: '最终创意点' }
  });
  state = await executeAndReduce(h, 'host', 'COMPLETE_PARTNER_SESSION', { context: { sessionId } });
  assert.equal(state.snapshot.view.session.status, 'COMPLETED');
  assertScreen(state.snapshot, 'PARTNER_CLOSING_REVIEW', 'leaderboard');
  assert.equal(state.snapshot.view.session.result.leaderboard.length, 3);
});

test('E2E Spy：分牌、逐人发言、投票、结算与完成', async () => {
  const h = createHarness({
    wordPairPicker: () => ({
      id: 'e2e-pair', civilianWord: '苹果', civilianBlurb: '水果',
      spyWord: '梨', spyBlurb: '另一种水果'
    })
  });
  await h.seedMembers(3);

  let state = await executeAndReduce(h, 'host', 'START_WORKSHOP_SESSION', {
    payload: { mode: 'SPY' }
  });
  const sessionId = state.snapshot.view.session.sessionId;
  assertScreen(state.snapshot, 'SPY_INTRO', 'spyIntro');

  state = await executeAndReduce(h, 'host', 'START_SPY_GAME', { context: { sessionId } });
  assertScreen(state.snapshot, 'SPY_SPEAK', 'spySpeak');
  const gameId = state.snapshot.view.session.publicModeState.gameId;

  while (state.snapshot.view.session.workflow.step !== 'SPY_VOTE') {
    const spyState = state.snapshot.view.session.publicModeState;
    const speaker = userForMember(state.snapshot, spyState.currentSpeakerMemberId);
    state = await executeAndReduce(h, speaker, 'ADVANCE_SPY_SPEAKER', {
      context: { sessionId, gameId, speakerTurnId: spyState.speakerTurnId }
    });
  }
  assertScreen(state.snapshot, 'SPY_VOTE', 'spyVote');

  const cards = {};
  for (const userId of ['host', 'u2', 'u3']) {
    cards[userId] = (await h.snapshot(userId)).view.actor.privateModeState;
  }
  const spyUser = Object.keys(cards).find((userId) => cards[userId].role === 'spy');
  const spyMemberId = (await h.snapshot(spyUser)).view.actor.memberId;
  const voteSessionId = state.snapshot.view.session.publicModeState.voteSessionId;
  for (const userId of ['host', 'u2', 'u3']) {
    state = await executeAndReduce(h, userId, 'SUBMIT_SPY_VOTE', {
      context: { sessionId, gameId, voteSessionId },
      payload: userId === spyUser ? { abstain: true } : { targetMemberId: spyMemberId }
    });
  }
  assertScreen(state.snapshot, 'SPY_SETTLED', 'spySettle');
  assert.equal(state.snapshot.view.session.publicModeState.winnerSide, 'civilian');
  assert.equal(state.snapshot.view.session.publicModeState.reveal.length, 3);

  state = await executeAndReduce(h, 'host', 'COMPLETE_SPY_SESSION', {
    context: { sessionId, gameId }
  });
  assert.equal(state.snapshot.view.session.status, 'COMPLETED');
  assertScreen(state.snapshot, 'SPY_SETTLED', 'spySettle');
});
