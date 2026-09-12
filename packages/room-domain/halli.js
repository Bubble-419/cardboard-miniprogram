'use strict';

const { COMMAND_TYPES } = require('@cardboard/room-contracts');
const {
  event, domainOk, fail, idOf, nowOf, ensureFacts, assertHost, assertParticipant, assertSession,
  activeParticipantIds, MODE, SESSION_STATUS, WORKFLOW_STEP, EVENT_TYPES, ERR
} = require('./model');

function reduceHalliCommand(aggregate, command, actorUserId, deps) {
  if (command.type === COMMAND_TYPES.END_HALLI_ACTIVITY) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertSession(aggregate, command.context, { mode: MODE.HALLI_GALLI, steps: [WORKFLOW_STEP.HALLI_ACTIVITY] });
    if (!check.ok) return check;
    check.session.workflow.step = WORKFLOW_STEP.HALLI_CREATIVE;
    check.session.workflow.phaseStartedAt = nowOf(deps);
    check.session.progress.contributionProgress = { requiredMemberIds: activeParticipantIds(check.session), submittedMemberIds: [] };
    return domainOk(aggregate, [event(EVENT_TYPES.HALLI_CREATIVE_STARTED, { sessionId: check.session.sessionId })]);
  }

  if (command.type === COMMAND_TYPES.SUBMIT_HALLI_IDEA) {
    const actor = assertParticipant(aggregate, actorUserId); if (!actor.ok) return actor;
    const check = assertSession(aggregate, command.context, { mode: MODE.HALLI_GALLI, steps: [WORKFLOW_STEP.HALLI_CREATIVE] });
    if (!check.ok) return check;
    const facts = ensureFacts(aggregate);
    const key = `${check.session.sessionId}:HALLI_IDEA:${actor.member.memberId}`;
    const previous = facts.contributions[key];
    facts.contributions[key] = {
      contributionId: previous ? previous.contributionId : idOf(deps, 'idea'), sessionId: check.session.sessionId,
      kind: 'HALLI_IDEA', memberId: actor.member.memberId, text: String(command.payload.text).trim(),
      entityVersion: previous ? previous.entityVersion + 1 : 1, createdAt: previous ? previous.createdAt : nowOf(deps), updatedAt: nowOf(deps)
    };
    const progress = check.session.progress.contributionProgress;
    if (!progress.submittedMemberIds.includes(actor.member.memberId)) progress.submittedMemberIds.push(actor.member.memberId);
    const events = [event(EVENT_TYPES.HALLI_IDEA_SUBMITTED, { memberId: actor.member.memberId,
      submittedCount: progress.submittedMemberIds.length, requiredCount: progress.requiredMemberIds.length })];
    if (progress.submittedMemberIds.length === progress.requiredMemberIds.length) {
      check.session.workflow.step = WORKFLOW_STEP.HALLI_SUMMARY;
      check.session.workflow.phaseStartedAt = nowOf(deps);
      events.push(event(EVENT_TYPES.HALLI_SUMMARY_READY, { sessionId: check.session.sessionId }));
    }
    return domainOk(aggregate, events, { kind: 'ACCEPTED', contributionId: facts.contributions[key].contributionId },
      [{ kind: 'contributions', id: key }]);
  }

  if (command.type === COMMAND_TYPES.COMPLETE_HALLI_SESSION) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertSession(aggregate, command.context, { mode: MODE.HALLI_GALLI, steps: [WORKFLOW_STEP.HALLI_SUMMARY] });
    if (!check.ok) return check;
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

function handleHalliParticipantLeft(aggregate, memberId) {
  const session = aggregate.currentSession;
  const events = [];
  if (!session || session.mode !== MODE.HALLI_GALLI) return { events, dirtyFacts: [] };
  const progress = session.progress && session.progress.contributionProgress;
  if (progress) {
    progress.requiredMemberIds = progress.requiredMemberIds.filter((id) => id !== memberId);
    if (session.workflow.step === WORKFLOW_STEP.HALLI_CREATIVE
      && progress.requiredMemberIds.every((id) => progress.submittedMemberIds.includes(id))) {
      session.workflow.step = WORKFLOW_STEP.HALLI_SUMMARY;
      events.push(event(EVENT_TYPES.HALLI_SUMMARY_READY, { sessionId: session.sessionId }));
    }
  }
  return { events, dirtyFacts: [] };
}

module.exports = { reduceHalliCommand, handleHalliParticipantLeft };
