'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');

async function seedPartner() {
  const h = createHarness();
  let snapshot = await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  snapshot = await h.snapshot('host');
  let sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  snapshot = await h.snapshot('host');
  const hostMemberId = snapshot.view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId: hostMemberId }
  });
  await h.command('host', 'CONFIRM_FIRST_PLAYER', { context: { sessionId }, payload: { memberId: hostMemberId } });
  snapshot = await h.snapshot('host');
  return { h, sessionId, turnId: snapshot.view.session.activeTurn.turnId, hostMemberId,
    u2MemberId: (await h.snapshot('u2')).view.actor.memberId,
    u3MemberId: (await h.snapshot('u3')).view.actor.memberId };
}

test('Partner 完整评分、内容、表态、换轮并按整轮递增', async () => {
  const { h, sessionId, turnId } = await seedPartner();
  const self = await h.command('host', 'SUBMIT_PARTNER_SCORE', { context: { sessionId, turnId }, payload: { scoreHalfSteps: 7 } });
  assert.equal(self.errCode, 'SELF_SCORE');
  await h.command('u2', 'SUBMIT_PARTNER_SCORE', { context: { sessionId, turnId }, payload: { scoreHalfSteps: 7 } });
  await h.command('u3', 'SUBMIT_PARTNER_SCORE', { context: { sessionId, turnId }, payload: { scoreHalfSteps: 8 } });
  await h.command('u2', 'POST_PARTNER_MESSAGE', {
    context: { sessionId, turnId, workflowStep: 'PARTNER_TURN' }, payload: { text: '换个角度试试' }
  });
  const appended = await h.command('host', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId, workflowStep: 'PARTNER_TURN' },
    payload: { operationId: 'op-1', text: '第一张共享卡片' } });
  assert.equal(appended.ok, true);

  let snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.activeTurn.scoredCount, 2);
  assert.equal(snapshot.view.session.activeArtifacts.length, 1);
  assert.equal(snapshot.view.session.recentMessages[0].text, '换个角度试试');
  assert.equal(JSON.stringify(snapshot.view.session.recentMessages).includes('authorMemberId'), false);

  await h.command('host', 'START_PARTNER_STATEMENT', { context: { sessionId, turnId } });
  const staleArtifact = await h.command('host', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId, workflowStep: 'PARTNER_TURN' },
    payload: { operationId: 'late-play-op', text: '不应落入讨论阶段' }
  });
  assert.equal(staleArtifact.errCode, 'STALE_CONTEXT');
  await h.command('host', 'ADVANCE_PARTNER_TURN', { context: { sessionId, turnId }, payload: { statementResult: 'allPass' } });
  snapshot = await h.snapshot('host');
  assert.notEqual(snapshot.view.session.activeTurn.turnId, turnId);
  assert.equal(snapshot.view.session.activeTurn.roundNo, 1);
  const summary = h.repo.rooms.get('12345678').facts.turns[turnId];
  assert.equal(summary.totalStars, 7.5);
  assert.equal(summary.activeMemberId, snapshot.view.room.hostMemberId);
});

test('Partner Artifact 的 operationId 只可重放同一业务操作', async () => {
  const { h, sessionId, turnId } = await seedPartner();
  const fields = { context: { sessionId, turnId, workflowStep: 'PARTNER_TURN' },
    payload: { operationId: 'stable-op', text: '原内容' } };
  const first = await h.command('host', 'APPEND_ARTIFACT', fields);
  const replay = await h.command('host', 'APPEND_ARTIFACT', fields);
  const conflict = await h.command('host', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId, workflowStep: 'PARTNER_TURN' },
    payload: { operationId: 'stable-op', text: '其他内容' }
  });
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.outcome.artifactId, first.outcome.artifactId);
  assert.equal(conflict.errCode, 'COMMAND_ID_CONFLICT');
  assert.equal((await h.snapshot('host')).view.session.activeArtifacts.length, 1);
});

test('Partner 讨论阶段只有房主可以新增共享素材', async () => {
  const { h, sessionId, turnId } = await seedPartner();
  await h.command('u2', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId }, payload: { scoreHalfSteps: 7 }
  });
  await h.command('u3', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId }, payload: { scoreHalfSteps: 7 }
  });
  await h.command('host', 'START_PARTNER_STATEMENT', { context: { sessionId, turnId } });
  await h.command('host', 'ADVANCE_PARTNER_TURN', {
    context: { sessionId, turnId }, payload: { statementResult: 'allPass' }
  });
  const second = await h.snapshot('host');
  const secondTurnId = second.view.session.activeTurn.turnId;
  await h.command('host', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId: secondTurnId }, payload: { scoreHalfSteps: 8 }
  });
  await h.command('u3', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId: secondTurnId }, payload: { scoreHalfSteps: 8 }
  });
  await h.command('host', 'START_PARTNER_STATEMENT', {
    context: { sessionId, turnId: secondTurnId }
  });

  const actorAppend = await h.command('u2', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId: secondTurnId, workflowStep: 'PARTNER_STATEMENT' },
    payload: { operationId: 'actor-discussion-note', text: '不能绕过页面权限新增' }
  });
  assert.equal(actorAppend.errCode, 'INVALID_TRANSITION');
  assert.equal((await h.snapshot('u2')).view.actor.capabilities.APPEND_ARTIFACT.allowed, false);
  assert.equal((await h.command('host', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId: secondTurnId, workflowStep: 'PARTNER_STATEMENT' },
    payload: { operationId: 'host-discussion-note', text: '房主讨论纪要' }
  })).ok, true);
});

test('Partner 收尾 question 回到新 Turn；全 pass 进入 Rune/Review 并完成', async () => {
  const seeded = await seedPartner();
  const { h, sessionId, turnId, hostMemberId, u2MemberId, u3MemberId } = seeded;
  await h.command('host', 'USE_PARTNER_SPECIAL', { context: { sessionId, turnId }, payload: { kind: 'CLOSING' } });
  let snapshot = await h.snapshot('host');
  const vote1 = snapshot.view.session.publicModeState.closing.closingVoteSessionId;
  await h.command('u2', 'SUBMIT_PARTNER_CLOSING_VOTE', { context: { sessionId, closingVoteSessionId: vote1 }, payload: { vote: 'question' } });
  await h.command('u3', 'SUBMIT_PARTNER_CLOSING_VOTE', { context: { sessionId, closingVoteSessionId: vote1 }, payload: { vote: 'pass' } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'PARTNER_TURN');
  assert.equal(snapshot.view.session.activeTurn.activeMemberId, u2MemberId);

  const questionTurnId = snapshot.view.session.activeTurn.turnId;
  await h.command('u2', 'USE_PARTNER_SPECIAL', { context: { sessionId, turnId: questionTurnId }, payload: { kind: 'CLOSING' } });
  snapshot = await h.snapshot('host');
  const vote2 = snapshot.view.session.publicModeState.closing.closingVoteSessionId;
  await h.command('host', 'SUBMIT_PARTNER_CLOSING_VOTE', { context: { sessionId, closingVoteSessionId: vote2 }, payload: { vote: 'pass' } });
  await h.command('u3', 'SUBMIT_PARTNER_CLOSING_VOTE', { context: { sessionId, closingVoteSessionId: vote2 }, payload: { vote: 'pass' } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'PARTNER_CLOSING_RUNE');

  const staleClosingArtifact = await h.command('host', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId: questionTurnId, workflowStep: 'PARTNER_TURN' },
    payload: { operationId: 'late-turn-note', text: '不应落入收尾阶段' }
  });
  assert.equal(staleClosingArtifact.errCode, 'STALE_CONTEXT');

  await h.command('host', 'ADVANCE_PARTNER_CLOSING', { context: { sessionId } });
  const artifact = await h.command('host', 'APPEND_ARTIFACT', {
    context: { sessionId, turnId: questionTurnId, workflowStep: 'PARTNER_CLOSING_REVIEW' },
    payload: { operationId: 'closing-note', text: '收尾创意点' } });
  assert.equal(artifact.ok, true);
  snapshot = await h.snapshot('host');
  const row = snapshot.view.session.activeArtifacts.find((item) => item.operationId === 'closing-note');
  await h.command('host', 'UPDATE_ARTIFACT', {
    context: { sessionId, turnId: questionTurnId, workflowStep: 'PARTNER_CLOSING_REVIEW',
      entityVersion: row.entityVersion },
    payload: { operationId: 'closing-note', text: '修改后的创意点' } });
  await h.command('host', 'COMPLETE_PARTNER_SESSION', { context: { sessionId } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.status, 'COMPLETED');
  assert.equal(snapshot.view.route.name, 'leaderboard');
  assert.equal(snapshot.view.session.result.turns, undefined, 'Session 结果不重复保存无限增长的 Turn 数组');
  assert.equal(snapshot.view.session.result.turnCount, 2);
  assert.equal(snapshot.view.session.turnSummaries.some((item) => item.activeMemberId === hostMemberId), true);
  assert.equal(snapshot.view.session.turnSummaries.some((item) => item.activeMemberId === u2MemberId), true);
  assert.equal(snapshot.view.session.result.leaderboard.length, 3);
  assert.equal(snapshot.view.session.result.leaderboard.some((item) => item.memberId === u3MemberId
    && item.totalStars === 0), true);

  const leaderboard = await h.app.readLeaderboard('12345678', sessionId, { userId: 'host' });
  assert.equal(leaderboard.ok, true);
  assert.equal(leaderboard.leaderboard.length, 3);
});

test('离开的当前行动者原子归档 ABANDONED 并推进下一位', async () => {
  const { h, sessionId, turnId } = await seedPartner();
  const left = await h.command('u2', 'LEAVE_ROOM');
  assert.equal(left.ok, true);
  const aggregate = h.repo.rooms.get('12345678');
  // 首位仍是 host，离开非行动者只缩减必需评分集合。
  assert.equal(aggregate.currentSession.modeState.partner.activeTurn.scoreProgress.requiredMemberIds.length, 1);
  await h.command('u3', 'SUBMIT_PARTNER_SCORE', { context: { sessionId, turnId }, payload: { scoreHalfSteps: 6 } });
  await h.command('host', 'START_PARTNER_STATEMENT', { context: { sessionId, turnId } });
  await h.command('host', 'ADVANCE_PARTNER_TURN', {
    context: { sessionId, turnId }, payload: { statementResult: 'allPass' }
  });
  const next = await h.snapshot('host');
  const activeUser = next.view.room.members.find((item) => item.memberId === next.view.session.activeTurn.activeMemberId);
  assert.equal(activeUser.nickName, '玩家3');
});

test('已评分成员离开后从进度集合移除，不会提前开始表态', async () => {
  const h = createHarness();
  let snapshot = await h.seedMembers(4);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  snapshot = await h.snapshot('host');
  const hostMemberId = snapshot.view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId: hostMemberId }
  });
  await h.command('host', 'CONFIRM_FIRST_PLAYER', { context: { sessionId }, payload: { memberId: hostMemberId } });
  snapshot = await h.snapshot('host');
  const turnId = snapshot.view.session.activeTurn.turnId;

  await h.command('u2', 'SUBMIT_PARTNER_SCORE', { context: { sessionId, turnId }, payload: { scoreHalfSteps: 8 } });
  await h.command('u2', 'LEAVE_ROOM');
  await h.command('u3', 'SUBMIT_PARTNER_SCORE', { context: { sessionId, turnId }, payload: { scoreHalfSteps: 7 } });
  const early = await h.command('host', 'START_PARTNER_STATEMENT', { context: { sessionId, turnId } });
  assert.equal(early.errCode, 'INVALID_TRANSITION');
  await h.command('u4', 'SUBMIT_PARTNER_SCORE', { context: { sessionId, turnId }, payload: { scoreHalfSteps: 6 } });
  assert.equal((await h.command('host', 'START_PARTNER_STATEMENT', { context: { sessionId, turnId } })).ok, true);
});

test('Partner 离房成员已经提交的 question 不再参与收尾裁决', async () => {
  const h = createHarness();
  let snapshot = await h.seedMembers(4);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  const hostMemberId = (await h.snapshot('host')).view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId: hostMemberId }
  });
  await h.command('host', 'CONFIRM_FIRST_PLAYER', { context: { sessionId }, payload: { memberId: hostMemberId } });
  snapshot = await h.snapshot('host');
  const turnId = snapshot.view.session.activeTurn.turnId;
  await h.command('host', 'USE_PARTNER_SPECIAL', { context: { sessionId, turnId }, payload: { kind: 'CLOSING' } });
  snapshot = await h.snapshot('host');
  const closingVoteSessionId = snapshot.view.session.publicModeState.closing.closingVoteSessionId;

  await h.command('u2', 'SUBMIT_PARTNER_CLOSING_VOTE', {
    context: { sessionId, closingVoteSessionId }, payload: { vote: 'question' }
  });
  await h.command('u2', 'LEAVE_ROOM');
  for (const userId of ['u3', 'u4']) {
    await h.command(userId, 'SUBMIT_PARTNER_CLOSING_VOTE', {
      context: { sessionId, closingVoteSessionId }, payload: { vote: 'pass' }
    });
  }
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'PARTNER_CLOSING_RUNE');
});
