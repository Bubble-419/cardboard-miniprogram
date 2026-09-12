'use strict';

const { COMMAND_TYPES } = require('@cardboard/room-contracts');
const model = require('./model');
const { reducePartnerCommand, startPartnerFlow, handlePartnerParticipantLeft } = require('./partner');
const { reduceHalliCommand, handleHalliParticipantLeft } = require('./halli');
const { reduceSpyCommand, handleSpyParticipantLeft } = require('./spy');

const {
  clone, event, domainOk, fail, idOf, nowOf, normalizeHalfStarScore, ensureFacts, sortedMembers,
  memberByUserId, memberById, isHost, activeParticipantIds, activeParticipantsBySeat, nextSeat,
  progressComplete,
  createMember, createRoomAggregate, assertRoom, assertMember, assertHost, assertParticipant, assertSession,
  newSession, normalizeScenario, markParticipantLeft, normalizeMode, LIFECYCLE, MODE, SESSION_STATUS,
  WORKFLOW_STEP, EVENT_TYPES, ERR, MAX_SEATS
} = model;

const PARTNER_COMMANDS = new Set([
  COMMAND_TYPES.APPEND_ARTIFACT, COMMAND_TYPES.UPDATE_ARTIFACT, COMMAND_TYPES.REMOVE_ARTIFACT,
  COMMAND_TYPES.SUBMIT_PARTNER_SCORE, COMMAND_TYPES.POST_PARTNER_MESSAGE,
  COMMAND_TYPES.START_PARTNER_STATEMENT, COMMAND_TYPES.ADVANCE_PARTNER_TURN,
  COMMAND_TYPES.USE_PARTNER_SPECIAL, COMMAND_TYPES.END_PARTNER_SILENT,
  COMMAND_TYPES.SUBMIT_PARTNER_CLOSING_VOTE, COMMAND_TYPES.ADVANCE_PARTNER_CLOSING,
  COMMAND_TYPES.COMPLETE_PARTNER_SESSION
]);
const HALLI_COMMANDS = new Set([
  COMMAND_TYPES.END_HALLI_ACTIVITY, COMMAND_TYPES.SUBMIT_HALLI_IDEA, COMMAND_TYPES.COMPLETE_HALLI_SESSION
]);
const SPY_COMMANDS = new Set([
  COMMAND_TYPES.START_SPY_GAME, COMMAND_TYPES.ADVANCE_SPY_SPEAKER, COMMAND_TYPES.OPEN_SPY_VOTE,
  COMMAND_TYPES.SUBMIT_SPY_VOTE, COMMAND_TYPES.START_NEXT_SPY_ROUND,
  COMMAND_TYPES.RESTART_SPY_GAME, COMMAND_TYPES.COMPLETE_SPY_SESSION
]);

function minimumPlayers(mode) { return mode === MODE.SPY ? 3 : 2; }

function createCommand(aggregate, command, actorUserId, deps) {
  if (aggregate) return fail(ERR.INVALID_TRANSITION, '房间已经存在');
  const roomId = command.roomId || (deps && deps.roomIdFactory && deps.roomIdFactory());
  if (!roomId) return fail(ERR.INTERNAL_ERROR, '无法生成房间号');
  const next = createRoomAggregate(roomId, actorUserId, command.payload, deps);
  return domainOk(next, [event(EVENT_TYPES.ROOM_CREATED, { roomId, hostMemberId: next.room.hostMemberId })],
    { kind: 'ROOM_CREATED', roomId, memberId: next.room.hostMemberId });
}

function joinCommand(aggregate, command, actorUserId, deps) {
  const check = assertRoom(aggregate); if (!check.ok) return check;
  const existing = memberByUserId(aggregate.room, actorUserId);
  if (existing) {
    const profile = existing.profile;
    let changed = false;
    const assign = (key, value) => {
      if (profile[key] === value) return;
      profile[key] = value;
      changed = true;
    };
    if (command.payload.nickName != null) assign('nickName', String(command.payload.nickName).trim());
    if (command.payload.avatarRef !== undefined) assign('avatarRef', command.payload.avatarRef || null);
    if (command.payload.avatarIndex !== undefined) {
      assign('avatarIndex', command.payload.avatarIndex == null ? null : Number(command.payload.avatarIndex));
    }
    if (command.payload.color != null) assign('color', String(command.payload.color));
    const events = changed
      ? [event(EVENT_TYPES.MEMBER_PROFILE_UPDATED, { memberId: existing.memberId, profile: clone(profile) })]
      : [event(EVENT_TYPES.MEMBER_JOINED, { memberId: existing.memberId, duplicate: true })];
    return domainOk(aggregate, events,
      { kind: 'ROOM_JOINED', roomId: aggregate.room.roomId, memberId: existing.memberId });
  }
  if (aggregate.room.members.length >= MAX_SEATS) return fail(ERR.ROOM_FULL);
  const seatNo = nextSeat(aggregate.room);
  const member = createMember(aggregate.room, actorUserId, command.payload, idOf(deps, 'member'), seatNo, nowOf(deps), 'PLAYER');
  aggregate.room.members.push(member);
  return domainOk(aggregate, [event(EVENT_TYPES.MEMBER_JOINED, { memberId: member.memberId, seatNo })],
    { kind: 'ROOM_JOINED', roomId: aggregate.room.roomId, memberId: member.memberId });
}

function updateRoomProfile(aggregate, command, actorUserId) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const name = String(command.payload.workshopName || '').trim() || '脑暴工作坊';
  if (name.length > 20) return fail(ERR.LIMIT_EXCEEDED, '房间名称最多 20 字');
  aggregate.room.workshopName = name;
  return domainOk(aggregate, [event(EVENT_TYPES.ROOM_PROFILE_UPDATED, { workshopName: name })]);
}

function updateMemberProfile(aggregate, command, actorUserId) {
  const auth = assertMember(aggregate, actorUserId); if (!auth.ok) return auth;
  const profile = auth.member.profile;
  if (command.payload.nickName != null) {
    const name = String(command.payload.nickName).trim();
    if (!name || name.length > 20) return fail(ERR.INVALID_ARGUMENT, '昵称必须是 1～20 字');
    profile.nickName = name;
  }
  if (command.payload.avatarRef !== undefined) {
    profile.avatarRef = command.payload.avatarRef || null;
  }
  if (command.payload.avatarIndex !== undefined) profile.avatarIndex = command.payload.avatarIndex == null ? null : Number(command.payload.avatarIndex);
  if (command.payload.color) profile.color = String(command.payload.color);
  return domainOk(aggregate, [event(EVENT_TYPES.MEMBER_PROFILE_UPDATED, { memberId: auth.member.memberId, profile: clone(profile) })]);
}

function reorderSeats(aggregate, command, actorUserId) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const session = aggregate.currentSession;
  if (session && [SESSION_STATUS.CONFIGURING, SESSION_STATUS.RUNNING].includes(session.status)) return fail(ERR.INVALID_TRANSITION, '场次进行中不能调整席位');
  const order = Array.isArray(command.payload.orderedMemberIds) ? command.payload.orderedMemberIds.map(String) : [];
  const current = (aggregate.room.members || []).map((member) => member.memberId).sort();
  if (order.length !== current.length || order.slice().sort().join('|') !== current.join('|')) return fail(ERR.STALE_CONTEXT, '成员集合已经变化');
  order.forEach((memberId, index) => { memberById(aggregate.room, memberId).seatNo = index + 1; });
  aggregate.room.members.sort((a, b) => a.seatNo - b.seatNo);
  return domainOk(aggregate, [event(EVENT_TYPES.SEATS_REORDERED, { orderedMemberIds: order })]);
}

function cancelCurrentSession(aggregate, reason, deps, events) {
  const session = aggregate.currentSession;
  if (!session) return;
  session.status = SESSION_STATUS.CANCELLED; session.completedAt = nowOf(deps); session.result = { cancelledReason: reason };
  aggregate.archivedSession = clone(session);
  aggregate.currentSession = null; aggregate.room.currentSessionId = null;
  events.push(event(EVENT_TYPES.WORKSHOP_SESSION_CANCELLED, { sessionId: session.sessionId, reason }));
}

function removeMember(aggregate, target, kicked, deps) {
  const events = [event(kicked ? EVENT_TYPES.MEMBER_KICKED : EVENT_TYPES.MEMBER_LEFT,
    { memberId: target.memberId, seatNo: target.seatNo })];
  const dirtyFacts = [];
  const session = aggregate.currentSession;
  if (session && [SESSION_STATUS.CONFIGURING, SESSION_STATUS.RUNNING].includes(session.status)) {
    // 已完成场次必须保持不可变；只有仍在进行的场次才记录 Participant 离开。
    markParticipantLeft(aggregate, target.memberId);
    if (session.status === SESSION_STATUS.CONFIGURING && activeParticipantIds(session).length < minimumPlayers(session.mode)) {
      cancelCurrentSession(aggregate, 'NOT_ENOUGH_PLAYERS', deps, events);
    } else if ((session.mode === MODE.PARTNER || session.mode === MODE.HALLI_GALLI) && activeParticipantIds(session).length <= 1) {
      cancelCurrentSession(aggregate, 'NOT_ENOUGH_PLAYERS', deps, events);
    } else if (session.mode === MODE.PARTNER) {
      const side = handlePartnerParticipantLeft(aggregate, target.memberId, deps); events.push(...side.events); dirtyFacts.push(...side.dirtyFacts);
    } else if (session.mode === MODE.HALLI_GALLI) {
      const side = handleHalliParticipantLeft(aggregate, target.memberId, deps); events.push(...side.events); dirtyFacts.push(...side.dirtyFacts);
    } else if (session.mode === MODE.SPY) {
      const side = handleSpyParticipantLeft(aggregate, target.memberId, deps); events.push(...side.events); dirtyFacts.push(...side.dirtyFacts);
    }
  }
  aggregate.room.members = aggregate.room.members.filter((member) => member.memberId !== target.memberId);
  return domainOk(aggregate, events, { kind: kicked ? 'MEMBER_KICKED' : 'LEFT_ROOM', memberId: target.memberId }, dirtyFacts);
}

function leaveRoom(aggregate, actorUserId, deps) {
  const auth = assertMember(aggregate, actorUserId); if (!auth.ok) return auth;
  if (isHost(aggregate.room, auth.member)) return fail(ERR.HOST_CANNOT_LEAVE);
  return removeMember(aggregate, auth.member, false, deps);
}

function kickMember(aggregate, command, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const target = memberById(aggregate.room, String(command.payload.memberId || ''));
  if (!target) return fail(ERR.STALE_CONTEXT, '目标成员已经离开');
  if (isHost(aggregate.room, target)) return fail(ERR.INVALID_ARGUMENT, '不能移除房主');
  return removeMember(aggregate, target, true, deps);
}

function dissolveRoom(aggregate, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  if (aggregate.currentSession && ![SESSION_STATUS.COMPLETED, SESSION_STATUS.CANCELLED].includes(aggregate.currentSession.status)) {
    aggregate.currentSession.status = SESSION_STATUS.CANCELLED;
    aggregate.currentSession.completedAt = nowOf(deps);
    aggregate.currentSession.result = { cancelledReason: 'ROOM_DISSOLVED' };
    aggregate.archivedSession = clone(aggregate.currentSession);
  }
  aggregate.room.lifecycle = LIFECYCLE.DISSOLVED;
  aggregate.room.currentSessionId = null;
  aggregate.dissolvedMemberUserIds = aggregate.room.members.map((member) => member.userId);
  aggregate.currentSession = null;
  return domainOk(aggregate, [event(EVENT_TYPES.ROOM_DISSOLVED, { roomId: aggregate.room.roomId })],
    { kind: 'ROOM_DISSOLVED', roomId: aggregate.room.roomId });
}

function startSession(aggregate, command, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  if (aggregate.currentSession) return fail(ERR.INVALID_TRANSITION, '请先结束当前场次');
  const mode = normalizeMode(command.payload.mode);
  if (!mode) return fail(ERR.INVALID_ARGUMENT, '未知模式');
  if (aggregate.room.members.length < minimumPlayers(mode)) return fail(ERR.NOT_ENOUGH_PLAYERS, `${mode} 人数不足`);
  const session = newSession(aggregate, mode, null, deps);
  return domainOk(aggregate, [event(EVENT_TYPES.WORKSHOP_SESSION_STARTED, { sessionId: session.sessionId, mode })],
    { kind: 'SESSION_STARTED', sessionId: session.sessionId });
}

function setScenario(aggregate, command, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const check = assertSession(aggregate, command.context, { steps: [
    WORKFLOW_STEP.CHOOSE_SCENARIO, WORKFLOW_STEP.COLLECT_DESIGN_PROBLEMS,
    WORKFLOW_STEP.SELECT_DESIGN_PROBLEM, WORKFLOW_STEP.SELECT_FIRST_PLAYER,
    WORKFLOW_STEP.CONFIRM_FIRST_PLAYER
  ] }); if (!check.ok) return check;
  if (check.session.mode === MODE.SPY) return fail(ERR.INVALID_TRANSITION);
  const normalized = normalizeScenario(command.payload, check.session.mode); if (!normalized.ok) return normalized;
  const dirtyFacts = [];
  // 配置页允许显式返回修改情境；旧问题必须原子清除，不能与新情境混用。
  Object.entries(ensureFacts(aggregate).contributions).forEach(([key, row]) => {
    if (row.sessionId !== check.session.sessionId) return;
    delete aggregate.facts.contributions[key];
    dirtyFacts.push({ kind: 'contributions', id: key, remove: true });
  });
  check.session.setup.scenarioSource = normalized.source; check.session.setup.scenario = normalized.scenario;
  check.session.setup.selectedProblemId = null;
  check.session.setup.proposedFirstMemberId = null;
  check.session.progress = {};
  if (check.session.mode === MODE.PARTNER && normalized.source !== 'OFFLINE') {
    check.session.workflow.step = WORKFLOW_STEP.COLLECT_DESIGN_PROBLEMS;
    check.session.progress.contributionProgress = { requiredMemberIds: activeParticipantIds(check.session), submittedMemberIds: [] };
  } else check.session.workflow.step = WORKFLOW_STEP.SELECT_FIRST_PLAYER;
  check.session.workflow.phaseStartedAt = nowOf(deps);
  return domainOk(aggregate, [event(EVENT_TYPES.SCENARIO_SET, {
    source: normalized.source, nextStep: check.session.workflow.step
  })], { kind: 'ACCEPTED' }, dirtyFacts);
}

function submitDesignProblem(aggregate, command, actorUserId, deps) {
  const auth = assertParticipant(aggregate, actorUserId); if (!auth.ok) return auth;
  const check = assertSession(aggregate, command.context, { mode: MODE.PARTNER, steps: [WORKFLOW_STEP.COLLECT_DESIGN_PROBLEMS] }); if (!check.ok) return check;
  const facts = ensureFacts(aggregate); const key = `${check.session.sessionId}:DESIGN_PROBLEM:${auth.member.memberId}`;
  const previous = facts.contributions[key];
  facts.contributions[key] = { contributionId: previous ? previous.contributionId : idOf(deps, 'problem'),
    sessionId: check.session.sessionId, kind: 'DESIGN_PROBLEM', memberId: auth.member.memberId,
    text: String(command.payload.text).trim(), entityVersion: previous ? previous.entityVersion + 1 : 1,
    createdAt: previous ? previous.createdAt : nowOf(deps), updatedAt: nowOf(deps) };
  const progress = check.session.progress.contributionProgress;
  if (!progress.submittedMemberIds.includes(auth.member.memberId)) progress.submittedMemberIds.push(auth.member.memberId);
  const events = [event(EVENT_TYPES.DESIGN_PROBLEM_SUBMITTED, { memberId: auth.member.memberId,
    submittedCount: progress.submittedMemberIds.length, requiredCount: progress.requiredMemberIds.length })];
  if (progressComplete(progress)) {
    check.session.workflow.step = WORKFLOW_STEP.SELECT_DESIGN_PROBLEM; check.session.workflow.phaseStartedAt = nowOf(deps);
    events.push(event(EVENT_TYPES.PROBLEM_COLLECTION_COMPLETED, { sessionId: check.session.sessionId }));
  }
  return domainOk(aggregate, events, { kind: 'ACCEPTED', contributionId: facts.contributions[key].contributionId },
    [{ kind: 'contributions', id: key }]);
}

function updateDesignProblem(aggregate, command, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const check = assertSession(aggregate, command.context, { mode: MODE.PARTNER, steps: [
    WORKFLOW_STEP.SELECT_DESIGN_PROBLEM, WORKFLOW_STEP.SELECT_FIRST_PLAYER,
    WORKFLOW_STEP.CONFIRM_FIRST_PLAYER
  ] }); if (!check.ok) return check;
  const contributionId = String(command.payload.contributionId || '');
  const entry = Object.entries(ensureFacts(aggregate).contributions).find(([, row]) => row.sessionId === check.session.sessionId && row.contributionId === contributionId);
  if (!entry) return fail(ERR.STALE_CONTEXT, '设计问题不存在');
  const [key, problem] = entry;
  if (problem.entityVersion !== Number(command.context.entityVersion)) return fail(ERR.STALE_CONTEXT, '设计问题已经更新');
  const text = String(command.payload.text || '').trim(); if (!text || text.length > 50) return fail(ERR.LIMIT_EXCEEDED, '设计问题必须是 1～50 字');
  problem.text = text; problem.entityVersion += 1; problem.updatedAt = nowOf(deps);
  return domainOk(aggregate, [event(EVENT_TYPES.DESIGN_PROBLEM_UPDATED, { contributionId, entityVersion: problem.entityVersion })],
    { kind: 'ACCEPTED', entityVersion: problem.entityVersion }, [{ kind: 'contributions', id: key }]);
}

function selectDesignProblem(aggregate, command, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const check = assertSession(aggregate, command.context, { mode: MODE.PARTNER, steps: [
    WORKFLOW_STEP.SELECT_DESIGN_PROBLEM, WORKFLOW_STEP.SELECT_FIRST_PLAYER,
    WORKFLOW_STEP.CONFIRM_FIRST_PLAYER
  ] }); if (!check.ok) return check;
  const contributionId = String(command.payload.contributionId || '');
  const problem = Object.values(ensureFacts(aggregate).contributions).find((row) => row.sessionId === check.session.sessionId && row.contributionId === contributionId);
  if (!problem) return fail(ERR.STALE_CONTEXT, '设计问题不存在');
  check.session.setup.selectedProblemId = contributionId;
  check.session.setup.proposedFirstMemberId = null;
  check.session.workflow.step = WORKFLOW_STEP.SELECT_FIRST_PLAYER;
  check.session.workflow.activeMemberId = null;
  check.session.workflow.turnId = null;
  check.session.workflow.phaseStartedAt = nowOf(deps);
  return domainOk(aggregate, [event(EVENT_TYPES.DESIGN_PROBLEM_SELECTED, { contributionId })]);
}

function selectFirstPlayer(aggregate, command, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const check = assertSession(aggregate, command.context, {
    steps: [WORKFLOW_STEP.SELECT_FIRST_PLAYER, WORKFLOW_STEP.CONFIRM_FIRST_PLAYER]
  }); if (!check.ok) return check;
  const memberId = String(command.payload.memberId || '');
  if (!activeParticipantIds(check.session).includes(memberId)) return fail(ERR.STALE_CONTEXT, '首位成员不可用');
  check.session.setup.proposedFirstMemberId = memberId;
  if (check.session.mode === MODE.PARTNER) check.session.workflow.step = WORKFLOW_STEP.CONFIRM_FIRST_PLAYER;
  else if (check.session.mode === MODE.HALLI_GALLI) {
    check.session.status = SESSION_STATUS.RUNNING; check.session.workflow.step = WORKFLOW_STEP.HALLI_ACTIVITY;
    check.session.workflow.activeMemberId = memberId;
  } else return fail(ERR.INVALID_TRANSITION);
  check.session.workflow.phaseStartedAt = nowOf(deps);
  return domainOk(aggregate, [event(EVENT_TYPES.FIRST_PLAYER_SELECTED, { memberId, nextStep: check.session.workflow.step })]);
}

function confirmFirstPlayer(aggregate, command, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const check = assertSession(aggregate, command.context, { mode: MODE.PARTNER, steps: [WORKFLOW_STEP.CONFIRM_FIRST_PLAYER] }); if (!check.ok) return check;
  const memberId = String(command.payload.memberId || check.session.setup.proposedFirstMemberId || '');
  if (memberId !== check.session.setup.proposedFirstMemberId || !activeParticipantIds(check.session).includes(memberId)) return fail(ERR.STALE_CONTEXT, '首位成员已经变化');
  const turn = startPartnerFlow(aggregate, memberId, deps);
  return domainOk(aggregate, [event(EVENT_TYPES.PARTNER_TURN_STARTED,
    { turnId: turn.turnId, memberId, roundNo: turn.roundNo })], { kind: 'ACCEPTED', turnId: turn.turnId });
}

function cancelSession(aggregate, command, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const check = assertSession(aggregate, command.context); if (!check.ok) return check;
  if ([SESSION_STATUS.COMPLETED, SESSION_STATUS.CANCELLED].includes(check.session.status)) return fail(ERR.INVALID_TRANSITION);
  const events = []; cancelCurrentSession(aggregate, 'HOST_CANCELLED', deps, events);
  return domainOk(aggregate, events, { kind: 'SESSION_CANCELLED' });
}

function returnToLobby(aggregate, command, actorUserId) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const check = assertSession(aggregate, command.context); if (!check.ok) return check;
  if (check.session.status !== SESSION_STATUS.COMPLETED) return fail(ERR.INVALID_TRANSITION, '场次尚未完成');
  aggregate.archivedSession = clone(check.session); aggregate.currentSession = null; aggregate.room.currentSessionId = null;
  return domainOk(aggregate, [event(EVENT_TYPES.ROOM_RETURNED_TO_LOBBY, { sessionId: check.session.sessionId })], { kind: 'LOBBY' });
}

function replaySession(aggregate, command, actorUserId, deps) {
  const auth = assertHost(aggregate, actorUserId); if (!auth.ok) return auth;
  const check = assertSession(aggregate, command.context); if (!check.ok) return check;
  if (check.session.status !== SESSION_STATUS.COMPLETED) return fail(ERR.INVALID_TRANSITION, '场次尚未完成');
  const old = clone(check.session);
  if (aggregate.room.members.length < minimumPlayers(old.mode)) {
    return fail(ERR.NOT_ENOUGH_PLAYERS, `${old.mode} 人数不足`);
  }
  const oldSelectedProblem = old.setup.selectedProblemId
    ? Object.values(ensureFacts(aggregate).contributions).find((row) => row.sessionId === old.sessionId
      && row.contributionId === old.setup.selectedProblemId)
    : null;
  const setup = { scenarioSource: old.setup.scenarioSource, scenario: old.setup.scenario,
    selectedProblemId: old.setup.selectedProblemId, proposedFirstMemberId: old.setup.proposedFirstMemberId };
  aggregate.archivedSession = old;
  const session = newSession(aggregate, old.mode, setup, deps);
  const dirtyFacts = [];
  if (session.mode === MODE.PARTNER && oldSelectedProblem) {
    const copied = { ...clone(oldSelectedProblem), contributionId: idOf(deps, 'problem'),
      sessionId: session.sessionId, entityVersion: 1, createdAt: nowOf(deps), updatedAt: nowOf(deps) };
    const key = `${session.sessionId}:DESIGN_PROBLEM:${copied.memberId}`;
    ensureFacts(aggregate).contributions[key] = copied;
    session.setup.selectedProblemId = copied.contributionId;
    dirtyFacts.push({ kind: 'contributions', id: key });
  }
  const events = [event(EVENT_TYPES.WORKSHOP_SESSION_REPLAYED, { previousSessionId: old.sessionId, sessionId: session.sessionId, mode: session.mode })];
  if (session.mode === MODE.PARTNER) {
    const validFirst = activeParticipantIds(session).includes(setup.proposedFirstMemberId)
      ? setup.proposedFirstMemberId : activeParticipantsBySeat(aggregate)[0].memberId;
    session.setup.proposedFirstMemberId = validFirst;
    const turn = startPartnerFlow(aggregate, validFirst, deps);
    events.push(event(EVENT_TYPES.PARTNER_TURN_STARTED, { turnId: turn.turnId, memberId: validFirst, roundNo: 1 }));
  } else if (session.mode === MODE.HALLI_GALLI) session.workflow.step = WORKFLOW_STEP.SELECT_FIRST_PLAYER;
  return domainOk(aggregate, events, { kind: 'SESSION_REPLAYED', sessionId: session.sessionId }, dirtyFacts);
}

function reduceCommand(input) {
  const command = input.command; const deps = input.deps || {}; const actorUserId = input.actorUserId;
  let aggregate = clone(input.aggregate);
  if (command.type === COMMAND_TYPES.CREATE_ROOM) return createCommand(aggregate, command, actorUserId, deps);
  if (!aggregate) return fail(ERR.ROOM_NOT_FOUND);
  ensureFacts(aggregate);
  let result;
  switch (command.type) {
    case COMMAND_TYPES.JOIN_ROOM: result = joinCommand(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.UPDATE_ROOM_PROFILE: result = updateRoomProfile(aggregate, command, actorUserId); break;
    case COMMAND_TYPES.UPDATE_MEMBER_PROFILE: result = updateMemberProfile(aggregate, command, actorUserId); break;
    case COMMAND_TYPES.REORDER_SEATS: result = reorderSeats(aggregate, command, actorUserId); break;
    case COMMAND_TYPES.LEAVE_ROOM: result = leaveRoom(aggregate, actorUserId, deps); break;
    case COMMAND_TYPES.KICK_MEMBER: result = kickMember(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.DISSOLVE_ROOM: result = dissolveRoom(aggregate, actorUserId, deps); break;
    case COMMAND_TYPES.START_WORKSHOP_SESSION: result = startSession(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.SET_SCENARIO: result = setScenario(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.SUBMIT_DESIGN_PROBLEM: result = submitDesignProblem(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.UPDATE_DESIGN_PROBLEM: result = updateDesignProblem(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.SELECT_DESIGN_PROBLEM: result = selectDesignProblem(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.SELECT_FIRST_PLAYER: result = selectFirstPlayer(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.CONFIRM_FIRST_PLAYER: result = confirmFirstPlayer(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.CANCEL_WORKSHOP_SESSION: result = cancelSession(aggregate, command, actorUserId, deps); break;
    case COMMAND_TYPES.RETURN_TO_LOBBY: result = returnToLobby(aggregate, command, actorUserId); break;
    case COMMAND_TYPES.REPLAY_WORKSHOP_SESSION: result = replaySession(aggregate, command, actorUserId, deps); break;
    default:
      if (PARTNER_COMMANDS.has(command.type)) result = reducePartnerCommand(aggregate, command, actorUserId, deps);
      else if (HALLI_COMMANDS.has(command.type)) result = reduceHalliCommand(aggregate, command, actorUserId, deps);
      else if (SPY_COMMANDS.has(command.type)) result = reduceSpyCommand(aggregate, command, actorUserId, deps);
      else result = fail(ERR.INVALID_ARGUMENT, `未实现的命令: ${command.type}`);
  }
  if (result.ok && result.aggregate && result.aggregate.room) {
    result.aggregate.room.updatedAt = nowOf(deps);
    if (result.aggregate.currentSession) result.aggregate.currentSession.updatedAt = nowOf(deps);
  }
  return result;
}

function authorizeRoomRead(aggregate, actorUserId) {
  const auth = assertMember(aggregate, actorUserId);
  return auth.ok ? { ok: true, aggregate, member: auth.member } : auth;
}

/** 归档场次允许已离房参与者回看；身份绑定只存在服务端 Session 文档中。 */
function authorizeSessionRead(aggregate, actorUserId) {
  if (!aggregate || !aggregate.room || !aggregate.currentSession) return fail(ERR.ROOM_NOT_FOUND);
  const liveMember = memberByUserId(aggregate.room, actorUserId);
  if (liveMember) return { ok: true, aggregate, member: liveMember };
  const session = aggregate.currentSession;
  if (![SESSION_STATUS.COMPLETED, SESSION_STATUS.CANCELLED].includes(session.status)) {
    return fail(ERR.NOT_MEMBER);
  }
  const participant = (session.participants || []).find((item) => String(item.userId) === String(actorUserId));
  if (!participant) return fail(ERR.NOT_MEMBER);
  return { ok: true, aggregate, member: {
    memberId: participant.memberId,
    userId: actorUserId,
    seatNo: participant.seatNoAtStart,
    profile: {
      nickName: participant.nickName,
      avatarRef: participant.avatarRef || null,
      avatarIndex: participant.avatarIndex == null ? null : participant.avatarIndex,
      color: participant.color
    }
  } };
}

module.exports = {
  reduceCommand, authorizeRoomRead, authorizeSessionRead, createRoomAggregate, normalizeHalfStarScore,
  memberByUserId, memberById, sortedMembers, minimumPlayers,
  ...require('./spy')
};
