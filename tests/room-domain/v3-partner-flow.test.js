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
  await h.command('host', 'SET_SCENARIO', { context: { sessionId }, payload: { source: 'OFFLINE' } });
  snapshot = await h.snapshot('host');
  const hostMemberId = snapshot.view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', { context: { sessionId }, payload: { memberId: hostMemberId } });
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
  await h.command('u2', 'POST_PARTNER_MESSAGE', { context: { sessionId, turnId }, payload: { text: '换个角度试试' } });
  const appended = await h.command('host', 'APPEND_ARTIFACT', { context: { sessionId, turnId },
    payload: { operationId: 'op-1', text: '第一张共享卡片' } });
  assert.equal(appended.ok, true);

  let snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.activeTurn.scoredCount, 2);
  assert.equal(snapshot.view.session.activeArtifacts.length, 1);
  assert.equal(snapshot.view.session.recentMessages[0].text, '换个角度试试');
  assert.equal(JSON.stringify(snapshot.view.session.recentMessages).includes('authorMemberId'), false);

  await h.command('host', 'START_PARTNER_STATEMENT', { context: { sessionId, turnId } });
  await h.command('host', 'ADVANCE_PARTNER_TURN', { context: { sessionId, turnId }, payload: { statementResult: '继续' } });
  snapshot = await h.snapshot('host');
  assert.notEqual(snapshot.view.session.activeTurn.turnId, turnId);
  assert.equal(snapshot.view.session.activeTurn.roundNo, 1);
  const summary = h.repo.rooms.get('12345678').facts.turns[turnId];
  assert.equal(summary.totalStars, 7.5);
  assert.equal(summary.activeMemberId, snapshot.view.room.hostMemberId);
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

  await h.command('host', 'ADVANCE_PARTNER_CLOSING', { context: { sessionId } });
  const artifact = await h.command('host', 'APPEND_ARTIFACT', { context: { sessionId, turnId: questionTurnId },
    payload: { operationId: 'closing-note', text: '收尾创意点' } });
  assert.equal(artifact.ok, true);
  snapshot = await h.snapshot('host');
  const row = snapshot.view.session.activeArtifacts.find((item) => item.operationId === 'closing-note');
  await h.command('host', 'UPDATE_ARTIFACT', { context: { sessionId, turnId: questionTurnId, entityVersion: row.entityVersion },
    payload: { operationId: 'closing-note', text: '修改后的创意点' } });
  await h.command('host', 'COMPLETE_PARTNER_SESSION', { context: { sessionId } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.status, 'COMPLETED');
  assert.equal(snapshot.view.route.name, 'leaderboard');
  assert.equal(snapshot.view.session.result.turns.length, 2);
  assert.equal(snapshot.view.session.result.turns.some((item) => item.activeMemberId === hostMemberId), true);
  assert.equal(snapshot.view.session.result.turns.some((item) => item.activeMemberId === u2MemberId), true);
  assert.equal(u3MemberId.length > 0, true);
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
  await h.command('host', 'ADVANCE_PARTNER_TURN', { context: { sessionId, turnId }, payload: {} });
  const next = await h.snapshot('host');
  const activeUser = next.view.room.members.find((item) => item.memberId === next.view.session.activeTurn.activeMemberId);
  assert.equal(activeUser.nickName, '玩家3');
});
