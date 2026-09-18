'use strict';

const {
  PROTOCOL_VERSION, SCHEMA_VERSION, MAX_SEATS, LIFECYCLE, SESSION_STATUS, MODE, WORKFLOW_STEP,
  EVENT_TYPES, ERR, fail, okResult, normalizeMode, isNonEmptyString
} = require('@cardboard/room-contracts');

const AVATAR_COLORS = ['#5EC159', '#4A90E2', '#E24A4A', '#E2B84A', '#9B59B6', '#1ABC9C'];

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function event(type, payload) { return { type, payload: clone(payload || {}) }; }
function domainOk(next, events, outcome, dirtyFacts) {
  return okResult({ aggregate: next, events: events || [], outcome: outcome || { kind: 'ACCEPTED' }, dirtyFacts: dirtyFacts || [] });
}
function idOf(deps, prefix) {
  if (deps && typeof deps.idFactory === 'function') return deps.idFactory(prefix);
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
function nowOf(deps) {
  const value = Number(deps && deps.now);
  return Number.isFinite(value) ? value : Date.now();
}
function normalizeHalfStarScore(raw, halfSteps) {
  if (halfSteps != null && halfSteps !== '') {
    const steps = Number(halfSteps);
    return Number.isInteger(steps) && steps >= 0 && steps <= 10 ? steps / 2 : null;
  }
  if (raw == null || raw === '') return null;
  const score = Number(raw);
  if (!Number.isFinite(score)) return null;
  const steps = Math.round(score * 2);
  return steps >= 0 && steps <= 10 ? steps / 2 : null;
}
function emptyFacts() {
  return { turns: {}, scores: {}, votes: {}, contributions: {}, artifacts: {}, messages: [], secrets: {} };
}
function ensureFacts(aggregate) {
  aggregate.facts = aggregate.facts || {};
  ['turns', 'scores', 'votes', 'contributions', 'artifacts', 'secrets'].forEach((key) => {
    aggregate.facts[key] = aggregate.facts[key] || {};
  });
  aggregate.facts.messages = Array.isArray(aggregate.facts.messages) ? aggregate.facts.messages : [];
  return aggregate.facts;
}
function sortedMembers(room) { return (room.members || []).slice().sort((a, b) => a.seatNo - b.seatNo); }
function memberByUserId(room, userId) { return (room.members || []).find((item) => String(item.userId) === String(userId)) || null; }
function memberById(room, memberId) { return (room.members || []).find((item) => item.memberId === memberId) || null; }
function isHost(room, member) { return !!(member && room.hostMemberId === member.memberId); }
function participantById(session, memberId) { return ((session && session.participants) || []).find((item) => item.memberId === memberId) || null; }
function isActiveParticipant(session, memberId) {
  const participant = participantById(session, memberId);
  return !!(participant && participant.status === 'ACTIVE');
}
function activeParticipants(session) { return (session.participants || []).filter((item) => item.status === 'ACTIVE'); }
function activeParticipantIds(session) { return activeParticipants(session).map((item) => item.memberId); }
function progressComplete(progress) {
  const submitted = new Set((progress && progress.submittedMemberIds) || []);
  return ((progress && progress.requiredMemberIds) || []).every((memberId) => submitted.has(memberId));
}
function designProblemNudgeDeniedReason(session, memberId) {
  if (!session || !session.workflow || session.workflow.step !== WORKFLOW_STEP.COLLECT_DESIGN_PROBLEMS) {
    return { errCode: ERR.INVALID_TRANSITION, errMsg: '当前不能催促提交设计问题' };
  }
  if (!isActiveParticipant(session, memberId)) {
    return { errCode: ERR.NOT_PARTICIPANT, errMsg: '非本场参与者' };
  }
  const progress = session.progress && session.progress.contributionProgress;
  if (!progress || !(progress.submittedMemberIds || []).includes(memberId)) {
    return { errCode: ERR.INVALID_TRANSITION, errMsg: '提交后才能催促其他人' };
  }
  if (progressComplete(progress)) {
    return { errCode: ERR.INVALID_TRANSITION, errMsg: '没有尚未提交的玩家' };
  }
  return null;
}
function designProblemEditingDeniedReason(session, hostMemberId, memberId, contributionId, facts) {
  if (!session || !session.workflow || session.workflow.step !== WORKFLOW_STEP.SELECT_DESIGN_PROBLEM) {
    return { errCode: ERR.INVALID_TRANSITION, errMsg: '当前不能同步设计问题编辑态' };
  }
  if (!hostMemberId || hostMemberId !== memberId) {
    return { errCode: ERR.HOST_REQUIRED, errMsg: '仅房主可同步设计问题编辑态' };
  }
  if (!isActiveParticipant(session, memberId)) {
    return { errCode: ERR.NOT_PARTICIPANT, errMsg: '非本场参与者' };
  }
  const id = String(contributionId || '').trim();
  if (!id) return null;
  const found = Object.values((facts && facts.contributions) || {}).some((item) => item
    && item.sessionId === session.sessionId
    && item.kind === 'DESIGN_PROBLEM'
    && item.contributionId === id);
  if (!found) return { errCode: ERR.STALE_CONTEXT, errMsg: '设计问题不存在' };
  return null;
}
function activeParticipantsBySeat(aggregate) {
  const ids = new Set(activeParticipantIds(aggregate.currentSession));
  return sortedMembers(aggregate.room).filter((member) => ids.has(member.memberId));
}
function nextSeat(room) {
  const used = new Set((room.members || []).map((item) => item.seatNo));
  for (let seatNo = 1; seatNo <= MAX_SEATS; seatNo += 1) if (!used.has(seatNo)) return seatNo;
  return null;
}
function nextColor(room) {
  const used = new Set((room.members || []).map((item) => item.profile && item.profile.color));
  return AVATAR_COLORS.find((color) => !used.has(color)) || AVATAR_COLORS[0];
}
function createMember(room, userId, payload, memberId, seatNo, joinedAt, role) {
  return {
    memberId,
    userId,
    seatNo,
    role,
    profile: {
      nickName: String(payload.nickName || `玩家${seatNo}`).trim().slice(0, 20) || `玩家${seatNo}`,
      avatarRef: payload.avatarRef || null,
      avatarIndex: payload.avatarIndex == null ? null : Number(payload.avatarIndex),
      color: payload.color || nextColor(room)
    },
    joinedAt
  };
}
function createRoomAggregate(roomId, actorUserId, payload, deps) {
  const now = nowOf(deps);
  const memberId = idOf(deps, 'member');
  const room = {
    roomId,
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: SCHEMA_VERSION,
    lifecycle: LIFECYCLE.OPEN,
    stateVersion: 0,
    eventSeq: 0,
    hostMemberId: memberId,
    workshopName: String(payload.workshopName || '脑暴工作坊').trim().slice(0, 20) || '脑暴工作坊',
    members: [],
    currentSessionId: null,
    sessionOrdinal: 0,
    createdAt: now,
    updatedAt: now
  };
  room.members.push(createMember(room, actorUserId, payload, memberId, 1, now, 'HOST'));
  return { room, currentSession: null, facts: emptyFacts() };
}
function assertRoom(aggregate) {
  if (!aggregate || !aggregate.room) return fail(ERR.ROOM_NOT_FOUND);
  if (aggregate.room.lifecycle === LIFECYCLE.DISSOLVED) return fail(ERR.ROOM_DISSOLVED);
  return okResult();
}
function assertMember(aggregate, actorUserId) {
  const base = assertRoom(aggregate);
  if (!base.ok) return base;
  const member = memberByUserId(aggregate.room, actorUserId);
  return member ? okResult({ member }) : fail(ERR.NOT_MEMBER);
}
function assertHost(aggregate, actorUserId) {
  const auth = assertMember(aggregate, actorUserId);
  if (!auth.ok) return auth;
  return isHost(aggregate.room, auth.member) ? auth : fail(ERR.HOST_REQUIRED);
}
function assertParticipant(aggregate, actorUserId) {
  const auth = assertMember(aggregate, actorUserId);
  if (!auth.ok) return auth;
  return isActiveParticipant(aggregate.currentSession, auth.member.memberId) ? auth : fail(ERR.NOT_PARTICIPANT);
}
function assertSession(aggregate, context, options) {
  const session = aggregate.currentSession;
  if (!session || !context || context.sessionId !== session.sessionId) return fail(ERR.STALE_CONTEXT, '场次已经变化');
  if (context.workflowStep && context.workflowStep !== session.workflow.step) {
    return fail(ERR.STALE_CONTEXT, '工作流步骤已经变化');
  }
  if (context.workflowRevision != null
    && Number(context.workflowRevision) !== Number(session.workflow.revision)) {
    return fail(ERR.STALE_CONTEXT, '工作流阶段已经变化');
  }
  if (options && options.mode && session.mode !== options.mode) return fail(ERR.INVALID_TRANSITION, '当前模式不匹配');
  if (options && options.steps && !options.steps.includes(session.workflow.step)) return fail(ERR.INVALID_TRANSITION);
  return okResult({ session });
}

/**
 * 所有业务阶段切换都经过此处，revision 作为同一 step 再次进入时的 ABA 防护令牌。
 * patch 只描述新阶段的游标字段；未提供的字段沿用上一阶段。
 */
function transitionWorkflow(session, step, deps, patch) {
  const previous = session.workflow || {};
  session.workflow = {
    ...previous,
    ...(patch || {}),
    step,
    revision: Math.max(0, Number(previous.revision) || 0) + 1,
    phaseStartedAt: nowOf(deps)
  };
  return session.workflow;
}
function assertTurn(aggregate, context, steps) {
  const check = assertSession(aggregate, context, { mode: MODE.PARTNER, steps });
  if (!check.ok) return check;
  const partner = check.session.modeState.partner;
  if (!partner || !partner.activeTurn || partner.activeTurn.turnId !== context.turnId) return fail(ERR.STALE_CONTEXT, '行动轮已经变化');
  return okResult({ session: check.session, partner, turn: partner.activeTurn });
}
function newSession(aggregate, mode, copiedSetup, deps) {
  const now = nowOf(deps);
  const ordinal = (aggregate.room.sessionOrdinal || 0) + 1;
  const participants = sortedMembers(aggregate.room).map((member) => ({
    memberId: member.memberId,
    // 仅服务端用于已离房成员读取自己的归档场次；Public/Member View 永不投影该字段。
    userId: member.userId,
    seatNoAtStart: member.seatNo,
    status: 'ACTIVE',
    // 场次内展示使用冻结资料，成员中途离房后 Snapshot 仍可完整还原回合与榜单。
    nickName: member.profile.nickName,
    avatarRef: member.profile.avatarRef || null,
    avatarIndex: member.profile.avatarIndex == null ? null : member.profile.avatarIndex,
    color: member.profile.color
  }));
  const step = mode === MODE.SPY ? WORKFLOW_STEP.SPY_INTRO : WORKFLOW_STEP.CHOOSE_SCENARIO;
  const session = {
    sessionId: idOf(deps, 'session'), ordinal, status: SESSION_STATUS.CONFIGURING, mode, participants,
    setup: { scenarioSource: null, scenario: null, selectedProblemId: null, proposedFirstMemberId: null, ...(clone(copiedSetup) || {}) },
    workflow: { step, revision: 1, roundNo: null, activeMemberId: null, turnId: null, phaseStartedAt: now },
    progress: {}, modeState: {}, result: null, startedAt: now, completedAt: null, updatedAt: now
  };
  aggregate.room.sessionOrdinal = ordinal;
  aggregate.room.currentSessionId = session.sessionId;
  aggregate.currentSession = session;
  return session;
}
function normalizeScenario(payload, mode) {
  const source = String(payload.source || '').toUpperCase();
  if (!['OFFLINE', 'CASE', 'HISTORY', 'CUSTOM'].includes(source)) return fail(ERR.INVALID_ARGUMENT, '未知情境来源');
  if (source === 'OFFLINE') return okResult({ source, scenario: null });
  const input = payload.scenario;
  const scenario = {
    scene: String(input.scene || '').trim().slice(0, 100),
    user: String(input.user || '').trim().slice(0, 100),
    function: String(input.function || '').trim().slice(0, 100)
  };
  if (mode === MODE.PARTNER) scenario.platform = String(input.platform || '').trim().slice(0, 100);
  if (!scenario.scene || !scenario.user || !scenario.function || (mode === MODE.PARTNER && !scenario.platform)) {
    return fail(ERR.INVALID_ARGUMENT, '情境字段不完整');
  }
  return okResult({ source, scenario });
}
function markParticipantLeft(aggregate, memberId) {
  const session = aggregate.currentSession;
  if (!session) return;
  const participant = participantById(session, memberId);
  if (participant) participant.status = 'LEFT';
  ['contributionProgress'].forEach((key) => {
    const progress = session.progress && session.progress[key];
    if (progress) {
      progress.requiredMemberIds = progress.requiredMemberIds.filter((id) => id !== memberId);
      progress.submittedMemberIds = progress.submittedMemberIds.filter((id) => id !== memberId);
    }
  });
}

module.exports = {
  clone, event, domainOk, fail, okResult, idOf, nowOf, normalizeHalfStarScore, emptyFacts, ensureFacts, sortedMembers,
  memberByUserId, memberById, isHost, participantById, isActiveParticipant, activeParticipants,
  activeParticipantIds, activeParticipantsBySeat, progressComplete, designProblemNudgeDeniedReason,
  designProblemEditingDeniedReason,
  nextSeat, nextColor, createMember, createRoomAggregate,
  assertRoom, assertMember, assertHost, assertParticipant, assertSession, assertTurn, transitionWorkflow, newSession,
  normalizeScenario, markParticipantLeft, isNonEmptyString, MODE, SESSION_STATUS, WORKFLOW_STEP, EVENT_TYPES, ERR, MAX_SEATS,
  normalizeMode, LIFECYCLE
};
