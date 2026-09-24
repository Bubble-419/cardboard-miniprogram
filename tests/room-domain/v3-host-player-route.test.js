'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');
const { describeRoute } = require('../../modules/room-navigation/index');
const { projectPageSnapshot } = require('../../modules/room-session/page-model');

async function startPartnerTurn(firstUserId) {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  const host = await h.snapshot('host');
  const sessionId = host.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' },
    payload: { source: 'OFFLINE' }
  });
  const firstMemberId = (await h.snapshot(firstUserId)).view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: firstMemberId }
  });
  await h.command('host', 'CONFIRM_FIRST_PLAYER', {
    context: { sessionId },
    payload: { memberId: firstMemberId }
  });
  return { h, sessionId };
}

test('Partner 出牌阶段主屏和副屏落到同一条 gamepage 路由和座位', async () => {
  const { h } = await startPartnerTurn('u2');
  const hostSnap = await h.snapshot('host');
  const playerSnap = await h.snapshot('u2');

  assert.equal(hostSnap.view.route.name, 'partnerGame');
  assert.equal(playerSnap.view.route.name, 'partnerGame');
  assert.equal(
    hostSnap.view.route.params.currentPlayerIndex,
    playerSnap.view.route.params.currentPlayerIndex
  );
  assert.equal(hostSnap.view.route.params.currentPlayerIndex, 2);

  const hostNav = describeRoute(hostSnap.view.route, '12345678');
  const playerNav = describeRoute(playerSnap.view.route, '12345678');
  assert.equal(hostNav.path, playerNav.path);
  assert.match(hostNav.url, /currentPlayerIndex=2/);
  assert.equal(hostNav.url, playerNav.url);

  const hostPage = projectPageSnapshot(hostSnap.view, { seq: hostSnap.seq });
  const playerPage = projectPageSnapshot(playerSnap.view, { seq: playerSnap.seq });
  assert.equal(hostPage.roomState.currentPlayerIndex, playerPage.roomState.currentPlayerIndex);
  assert.equal(hostPage.roomState.scoredCount, playerPage.roomState.scoredCount);
});

test('有人打分后主屏和副屏看到同一份评分人数', async () => {
  const { h, sessionId } = await startPartnerTurn('host');
  const turnId = (await h.snapshot('host')).view.session.activeTurn.turnId;
  await h.command('u2', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId },
    payload: { scoreHalfSteps: 7 }
  });

  const hostPage = projectPageSnapshot((await h.snapshot('host')).view);
  const playerPage = projectPageSnapshot((await h.snapshot('u3')).view);
  const scorerPage = projectPageSnapshot((await h.snapshot('u2')).view);

  assert.equal(hostPage.roomState.scoredCount, 1);
  assert.equal(playerPage.roomState.scoredCount, 1);
  assert.equal(scorerPage.roomState.scoredCount, 1);
  assert.equal(hostPage.roomState.progress.turnId, turnId);
  assert.notEqual(hostPage.roomState.progress.turnId, `turn_r${hostPage.roomState.currentRound}_s${hostPage.roomState.currentPlayerIndex}`);
});

test('Master 特殊行动后所有非当前玩家仍在 gamepage 并保持打分能力', async () => {
  const { h, sessionId } = await startPartnerTurn('u2');
  const actorSnapshot = await h.snapshot('u2');
  const turnId = actorSnapshot.view.session.activeTurn.turnId;

  const used = await h.command('u2', 'USE_PARTNER_SPECIAL', {
    context: { sessionId, turnId },
    payload: { kind: 'MASTER' }
  });
  assert.equal(used.ok, true);

  for (const userId of ['host', 'u2', 'u3']) {
    const snapshot = await h.snapshot(userId);
    const page = projectPageSnapshot(snapshot.view, { seq: snapshot.seq });
    assert.equal(snapshot.view.route.name, 'partnerGame');
    assert.equal(page.roomState.partnerMasterMode, true);

    const canScore = snapshot.view.actor.capabilities.SUBMIT_PARTNER_SCORE.allowed;
    if (userId === 'u2') {
      assert.equal(canScore, false, '当前行动者不能给自己打分');
    } else {
      assert.equal(canScore, true, `${userId} 应继续看到并可使用打分界面`);
      assert.equal(page.roomState.myScore, null);
    }
  }

  await h.command('host', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId },
    payload: { scoreHalfSteps: 7 }
  });
  await h.command('u3', 'SUBMIT_PARTNER_SCORE', {
    context: { sessionId, turnId },
    payload: { scoreHalfSteps: 8 }
  });

  const completed = await h.snapshot('u2');
  assert.equal(completed.view.session.activeTurn.scoredCount, 2);
  assert.equal(completed.view.session.activeTurn.requiredScoreCount, 2);
  assert.equal(completed.view.actor.capabilities.START_PARTNER_STATEMENT.allowed, false,
    '非房主行动者不能代替房主开始表态');
  assert.equal((await h.snapshot('host')).view.actor.capabilities.START_PARTNER_STATEMENT.allowed, true);
});
