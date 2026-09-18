'use strict';

const { COMMAND_TYPES } = require('@cardboard/room-contracts');
const {
  event, domainOk, fail, idOf, nowOf, ensureFacts, assertHost, assertParticipant, assertSession,
  transitionWorkflow,
  activeParticipantIds, progressComplete, MODE, SESSION_STATUS, WORKFLOW_STEP, EVENT_TYPES, ERR
} = require('./model');

function reduceHalliCommand(aggregate, command, actorUserId, deps) {
  if (command.type === COMMAND_TYPES.END_HALLI_ACTIVITY) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertSession(aggregate, command.context, { mode: MODE.HALLI_GALLI, steps: [WORKFLOW_STEP.HALLI_ACTIVITY] });
    if (!check.ok) return check;
    transitionWorkflow(check.session, WORKFLOW_STEP.HALLI_CREATIVE, deps, {
      activeMemberId: null,
      turnId: null
    });
    check.session.progress.contributionProgress = { requiredMemberIds: activeParticipantIds(check.session), submittedMemberIds: [] };
    check.session.modeState.halli = { revisingMemberIds: [] };
    return domainOk(aggregate, [event(EVENT_TYPES.HALLI_CREATIVE_STARTED, { sessionId: check.session.sessionId })]);
  }

  if (command.type === COMMAND_TYPES.REOPEN_HALLI_IDEA) {
    const actor = assertParticipant(aggregate, actorUserId); if (!actor.ok) return actor;
    const check = assertSession(aggregate, command.context, { mode: MODE.HALLI_GALLI,
      steps: [WORKFLOW_STEP.HALLI_CREATIVE, WORKFLOW_STEP.HALLI_SUMMARY] });
    if (!check.ok) return check;
    if (check.session.status !== SESSION_STATUS.RUNNING) return fail(ERR.INVALID_TRANSITION);
    const key = `${check.session.sessionId}:HALLI_IDEA:${actor.member.memberId}`;
    if (!ensureFacts(aggregate).contributions[key]) {
      return fail(ERR.INVALID_TRANSITION, '请先提交创意');
    }
    const halli = check.session.modeState.halli || (check.session.modeState.halli = { revisingMemberIds: [] });
    if (halli.revisingMemberIds.includes(actor.member.memberId)) return fail(ERR.INVALID_TRANSITION);
    halli.revisingMemberIds.push(actor.member.memberId);
    return domainOk(aggregate, [event(EVENT_TYPES.HALLI_IDEA_REOPENED,
      { memberId: actor.member.memberId })]);
  }

  if (command.type === COMMAND_TYPES.SUBMIT_HALLI_IDEA) {
    const actor = assertParticipant(aggregate, actorUserId); if (!actor.ok) return actor;
    const check = assertSession(aggregate, command.context, { mode: MODE.HALLI_GALLI,
      steps: [WORKFLOW_STEP.HALLI_CREATIVE, WORKFLOW_STEP.HALLI_SUMMARY] });
    if (!check.ok) return check;
    if (check.session.status !== SESSION_STATUS.RUNNING) return fail(ERR.INVALID_TRANSITION);
    const facts = ensureFacts(aggregate);
    const key = `${check.session.sessionId}:HALLI_IDEA:${actor.member.memberId}`;
    const previous = facts.contributions[key];
    const halli = check.session.modeState.halli || (check.session.modeState.halli = { revisingMemberIds: [] });
    const revising = halli.revisingMemberIds.includes(actor.member.memberId);
    if ((previous && !revising) || (!previous && check.session.workflow.step !== WORKFLOW_STEP.HALLI_CREATIVE)) {
      return fail(ERR.INVALID_TRANSITION, '当前不能提交或修改创意');
    }
    facts.contributions[key] = {
      contributionId: previous ? previous.contributionId : idOf(deps, 'idea'), sessionId: check.session.sessionId,
      kind: 'HALLI_IDEA', memberId: actor.member.memberId, text: String(command.payload.text).trim(),
      entityVersion: previous ? previous.entityVersion + 1 : 1, createdAt: previous ? previous.createdAt : nowOf(deps), updatedAt: nowOf(deps)
    };
    halli.revisingMemberIds = halli.revisingMemberIds.filter((memberId) => memberId !== actor.member.memberId);
    const progress = check.session.progress.contributionProgress;
    if (!progress.submittedMemberIds.includes(actor.member.memberId)) progress.submittedMemberIds.push(actor.member.memberId);
    const events = [event(EVENT_TYPES.HALLI_IDEA_SUBMITTED, { memberId: actor.member.memberId,
      submittedCount: progress.submittedMemberIds.length, requiredCount: progress.requiredMemberIds.length })];
    if (check.session.workflow.step === WORKFLOW_STEP.HALLI_CREATIVE && progressComplete(progress)) {
      transitionWorkflow(check.session, WORKFLOW_STEP.HALLI_SUMMARY, deps, {
        activeMemberId: null,
        turnId: null
      });
      events.push(event(EVENT_TYPES.HALLI_SUMMARY_READY, { sessionId: check.session.sessionId }));
    }
    return domainOk(aggregate, events, { kind: 'ACCEPTED', contributionId: facts.contributions[key].contributionId },
      [{ kind: 'contributions', id: key }]);
  }

  if (command.type === COMMAND_TYPES.COMPLETE_HALLI_SESSION) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertSession(aggregate, command.context, { mode: MODE.HALLI_GALLI, steps: [WORKFLOW_STEP.HALLI_SUMMARY] });
    if (!check.ok) return check;
    const revisingMemberIds = check.session.modeState.halli
      && check.session.modeState.halli.revisingMemberIds || [];
    if (revisingMemberIds.length) return fail(ERR.INVALID_TRANSITION, '请等待成员完成创意修改');
    const ideas = Object.values(ensureFacts(aggregate).contributions)
      .filter((item) => item.sessionId === check.session.sessionId && item.kind === 'HALLI_IDEA');
    check.session.status = SESSION_STATUS.COMPLETED;
    check.session.completedAt = nowOf(deps);
    check.session.result = { mode: MODE.HALLI_GALLI, ideaCount: ideas.length };
    return domainOk(aggregate, [event(EVENT_TYPES.WORKSHOP_SESSION_COMPLETED,
      { sessionId: check.session.sessionId, mode: MODE.HALLI_GALLI })]);
  }

  return fail(ERR.INVALID_ARGUMENT, `未实现的 Halli 命令: ${command.type}`);
}

function handleHalliParticipantLeft(aggregate, memberId, deps) {
  const session = aggregate.currentSession;
  const events = [];
  if (!session || session.mode !== MODE.HALLI_GALLI) return { events, dirtyFacts: [] };
  if (session.workflow.step === WORKFLOW_STEP.HALLI_ACTIVITY
    && session.setup.proposedFirstMemberId === memberId) {
    const replacement = activeParticipantIds(session)[0] || null;
    session.setup.proposedFirstMemberId = replacement;
    transitionWorkflow(session, WORKFLOW_STEP.HALLI_ACTIVITY, deps, {
      activeMemberId: replacement,
      turnId: null
    });
    events.push(event(EVENT_TYPES.FIRST_PLAYER_SELECTED, {
      memberId: replacement,
      nextStep: WORKFLOW_STEP.HALLI_ACTIVITY,
      reason: 'MEMBER_LEFT'
    }));
  }
  const progress = session.progress && session.progress.contributionProgress;
  if (session.modeState.halli && Array.isArray(session.modeState.halli.revisingMemberIds)) {
    session.modeState.halli.revisingMemberIds = session.modeState.halli.revisingMemberIds
      .filter((id) => id !== memberId);
  }
  if (progress) {
    progress.requiredMemberIds = progress.requiredMemberIds.filter((id) => id !== memberId);
    progress.submittedMemberIds = progress.submittedMemberIds.filter((id) => id !== memberId);
    if (session.workflow.step === WORKFLOW_STEP.HALLI_CREATIVE
      && progressComplete(progress)) {
      transitionWorkflow(session, WORKFLOW_STEP.HALLI_SUMMARY, deps, {
        activeMemberId: null,
        turnId: null
      });
      events.push(event(EVENT_TYPES.HALLI_SUMMARY_READY, { sessionId: session.sessionId }));
    }
  }
  return { events, dirtyFacts: [] };
}

module.exports = { reduceHalliCommand, handleHalliParticipantLeft };
