'use strict';

const {
  COMMAND_TYPES, MODE, SESSION_STATUS, WORKFLOW_STEP, WORKFLOW_GROUPS, LIFECYCLE
} = require('../room-contracts/index');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function activeParticipants(session) {
  return ((session && session.participants) || []).filter((item) => item.status === 'ACTIVE');
}

function findMember(aggregate, userId) {
  return (aggregate.room.members || []).find((member) => String(member.userId) === String(userId)) || null;
}

function findParticipant(session, memberId) {
  return ((session && session.participants) || []).find((item) => item.memberId === memberId) || null;
}

function currentPartner(aggregate) {
  return aggregate.currentSession && aggregate.currentSession.modeState
    ? aggregate.currentSession.modeState.partner || null
    : null;
}

function currentSpy(aggregate) {
  return aggregate.currentSession && aggregate.currentSession.modeState
    ? aggregate.currentSession.modeState.spy || null
    : null;
}

function projectPublicView(aggregate) {
  if (!aggregate || !aggregate.room) return null;
  const room = aggregate.room;
  const session = aggregate.currentSession;
  const facts = aggregate.facts || {};
  const publicView = {
    room: {
      roomId: room.roomId,
      lifecycle: room.lifecycle,
      workshopName: room.workshopName,
      createdAt: room.createdAt,
      hostMemberId: room.hostMemberId,
      members: (room.members || []).slice().sort((a, b) => a.seatNo - b.seatNo).map((member) => ({
        memberId: member.memberId,
        seatNo: member.seatNo,
        nickName: member.profile.nickName,
        avatarRef: member.profile.avatarRef || null,
        avatarIndex: member.profile.avatarIndex == null ? null : member.profile.avatarIndex,
        color: member.profile.color,
        joinedAt: member.joinedAt
      }))
    },
    session: null
  };
  if (!session) return publicView;

  const contributions = Object.values(facts.contributions || {}).filter((item) => item.sessionId === session.sessionId);
  const selectedProblem = contributions.find((item) => item.contributionId === session.setup.selectedProblemId) || null;
  const problemRevealSteps = [WORKFLOW_STEP.SELECT_DESIGN_PROBLEM,
    WORKFLOW_STEP.SELECT_FIRST_PLAYER, WORKFLOW_STEP.CONFIRM_FIRST_PLAYER];
  const participantView = (session.participants || []).map((item) => ({
    memberId: item.memberId,
    seatNoAtStart: item.seatNoAtStart,
    status: item.status,
    nickName: item.nickName,
    avatarRef: item.avatarRef || null,
    avatarIndex: item.avatarIndex == null ? null : item.avatarIndex,
    color: item.color
  }));
  const rawProgress = session.progress || {};
  const progress = {};
  if (rawProgress.contributionProgress) {
    progress.contributionProgress = {
      submittedCount: rawProgress.contributionProgress.submittedMemberIds.length,
      requiredCount: rawProgress.contributionProgress.requiredMemberIds.length
    };
  }
  if (rawProgress.scoreProgress) {
    progress.scoreProgress = {
      submittedCount: rawProgress.scoreProgress.submittedMemberIds.length,
      requiredCount: rawProgress.scoreProgress.requiredMemberIds.length
    };
  }
  const view = {
    sessionId: session.sessionId,
    ordinal: session.ordinal,
    status: session.status,
    mode: session.mode,
    participants: participantView,
    setup: {
      scenarioSource: session.setup.scenarioSource || null,
      scenario: clone(session.setup.scenario || null),
      proposedFirstMemberId: session.setup.proposedFirstMemberId || null,
      selectedProblem: selectedProblem ? {
        contributionId: selectedProblem.contributionId,
        memberId: selectedProblem.memberId,
        text: selectedProblem.text,
        entityVersion: selectedProblem.entityVersion
      } : null,
      // 问题在收集完成前互不可见；进入选择阶段后持续投影，确保配置页返回时可完整还原。
      designProblems: problemRevealSteps.includes(session.workflow.step)
        ? contributions.filter((item) => item.kind === 'DESIGN_PROBLEM').map((item) => ({
          contributionId: item.contributionId,
          memberId: item.memberId,
          text: item.text,
          entityVersion: item.entityVersion
        }))
        : []
    },
    workflow: clone(session.workflow),
    progress,
    publicModeState: {},
    activeTurn: null,
    activeArtifacts: [],
    recentMessages: [],
    turnSummaries: [],
    result: clone(session.result || null)
  };

  if (session.mode === MODE.PARTNER) {
    const partner = currentPartner(aggregate) || {};
    const turn = partner.activeTurn || null;
    view.publicModeState = {
      roundNo: partner.roundNo || 1,
      turnOrdinal: partner.turnOrdinal || 0,
      closing: partner.closing ? {
        closingVoteSessionId: partner.closing.closingVoteSessionId,
        initiatorMemberId: partner.closing.initiatorMemberId,
        votedCount: partner.closing.submittedMemberIds.length,
        requiredCount: partner.closing.requiredMemberIds.length,
        stage: partner.closing.stage,
        sourceTurnId: partner.closing.sourceTurnId
      } : null
    };
    if (turn) {
      view.activeTurn = {
        turnId: turn.turnId,
        ordinal: turn.ordinal,
        roundNo: turn.roundNo,
        activeMemberId: turn.activeMemberId,
        phase: turn.phase,
        turnStartedAt: turn.turnStartedAt,
        phaseStartedAt: turn.phaseStartedAt,
        specialUsed: turn.specialUsed,
        masterMode: turn.masterMode,
        silentStartedAt: turn.silentStartedAt,
        silentDeadlineAt: turn.silentDeadlineAt,
        scoredCount: turn.scoreProgress.submittedMemberIds.length,
        requiredScoreCount: turn.scoreProgress.requiredMemberIds.length
      };
    }
    const relevantTurnId = turn ? turn.turnId : (partner.closing && partner.closing.sourceTurnId);
    view.activeArtifacts = Object.values(facts.artifacts || {})
      .filter((item) => item.sessionId === session.sessionId && item.turnId === relevantTurnId && !item.removed)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((item) => ({ artifactId: item.artifactId, operationId: item.operationId,
        turnId: item.turnId, stage: item.stage, kind: item.kind, text: item.text,
        fileRef: item.fileRef || null, authorMemberId: item.authorMemberId,
        entityVersion: item.entityVersion, createdAt: item.createdAt, updatedAt: item.updatedAt }));
    view.recentMessages = (facts.messages || []).filter((item) => item.sessionId === session.sessionId)
      .slice(-40).map((item) => ({ messageId: item.messageId, turnId: item.turnId,
        turnOrdinal: item.turnOrdinal, roundNo: item.roundNo, phase: item.phase,
        text: item.text, anonKey: item.anonKey, createdAt: item.createdAt }));
    const publicArtifact = (artifact) => ({
      artifactId: artifact.artifactId,
      operationId: artifact.operationId,
      turnId: artifact.turnId,
      stage: artifact.stage,
      kind: artifact.kind,
      text: artifact.text,
      fileRef: artifact.fileRef || null,
      authorMemberId: artifact.authorMemberId,
      entityVersion: artifact.entityVersion,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt
    });
    const allArtifacts = Object.values(facts.artifacts || {});
    view.turnSummaries = Object.values(facts.turns || {}).filter((item) => item.sessionId === session.sessionId)
      .sort((a, b) => a.turnOrdinal - b.turnOrdinal).map((item) => ({
        sessionId: item.sessionId,
        turnId: item.turnId,
        turnOrdinal: item.turnOrdinal,
        roundNo: item.roundNo,
        activeMemberId: item.activeMemberId,
        reason: item.reason,
        statementResult: item.statementResult,
        avgScore: item.avgScore,
        scoredCount: item.scoredCount,
        totalStars: item.totalStars,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        artifacts: allArtifacts.filter((artifact) => (
          artifact.sessionId === session.sessionId
          && artifact.turnId === item.turnId
          && !artifact.removed
        )).sort((a, b) => a.createdAt - b.createdAt).map(publicArtifact)
      }));
  } else if (session.mode === MODE.HALLI_GALLI) {
    const ideas = contributions.filter((item) => item.kind === 'HALLI_IDEA');
    const reveal = session.workflow.step === WORKFLOW_STEP.HALLI_SUMMARY || session.status === SESSION_STATUS.COMPLETED;
    view.publicModeState = {
      firstMemberId: session.setup.proposedFirstMemberId || null,
      submittedMemberIds: ideas.map((item) => item.memberId),
      ideas: reveal ? ideas.map((item) => ({ memberId: item.memberId, text: item.text })) : []
    };
  } else if (session.mode === MODE.SPY) {
    const spy = currentSpy(aggregate) || {};
    view.publicModeState = {
      gameId: spy.gameId || null,
      roundNo: spy.roundNo || 1,
      players: clone(spy.players || []),
      speakOrder: clone(spy.speakOrder || []),
      currentSpeakerIndex: spy.currentSpeakerIndex || 0,
      speakerTurnId: spy.speakerTurnId || null,
      speakRoundStartedAt: spy.speakRoundStartedAt == null ? null : spy.speakRoundStartedAt,
      speakTurnStartedAt: spy.speakTurnStartedAt == null ? null : spy.speakTurnStartedAt,
      currentSpeakerMemberId: spy.speakOrder && spy.currentSpeakerIndex < spy.speakOrder.length
        ? spy.speakOrder[spy.currentSpeakerIndex]
        : null,
      voteSessionId: spy.voteProgress && spy.voteProgress.voteSessionId,
      votedCount: spy.voteProgress ? spy.voteProgress.submittedMemberIds.length : 0,
      requiredVoteCount: spy.voteProgress ? spy.voteProgress.requiredMemberIds.length : 0,
      voteStartedAt: spy.voteStartedAt == null ? null : spy.voteStartedAt,
      tieBreak: spy.tieBreak === true,
      lastResult: clone(spy.lastResult || null),
      winnerSide: spy.winnerSide || null,
      reveal: session.workflow.step === WORKFLOW_STEP.SPY_SETTLED ? clone(spy.reveal || []) : []
    };
  }
  publicView.session = view;
  return publicView;
}

function capability(allowed, reason) {
  return { allowed: !!allowed, reason: allowed ? null : reason };
}

function progressComplete(progress) {
  const submitted = new Set((progress && progress.submittedMemberIds) || []);
  return ((progress && progress.requiredMemberIds) || []).every((memberId) => submitted.has(memberId));
}

function projectCapabilities(aggregate, actor) {
  const session = aggregate.currentSession;
  const step = session && session.workflow.step;
  const participant = actor && session ? findParticipant(session, actor.memberId) : null;
  const isParticipant = !!(participant && participant.status === 'ACTIVE');
  const isHost = !!(actor && actor.memberId === aggregate.room.hostMemberId);
  const partner = currentPartner(aggregate);
  const turn = partner && partner.activeTurn;
  const isActorTurn = !!(turn && actor && turn.activeMemberId === actor.memberId);
  const caps = {};
  Object.values(COMMAND_TYPES).forEach((type) => { caps[type] = capability(false, 'INVALID_TRANSITION'); });
  const liveActor = !!(actor && (aggregate.room.members || []).some((member) => member.memberId === actor.memberId));
  // 历史投影和已解散房间严格只读，不能把归档 Session 误当成当前 Session 给出操作能力。
  if (aggregate.room.lifecycle !== LIFECYCLE.OPEN
    || !liveActor
    || (session && aggregate.room.currentSessionId !== session.sessionId)) return caps;
  caps[COMMAND_TYPES.UPDATE_ROOM_PROFILE] = capability(isHost, 'HOST_REQUIRED');
  caps[COMMAND_TYPES.UPDATE_MEMBER_PROFILE] = capability(liveActor, 'NOT_MEMBER');
  caps[COMMAND_TYPES.REORDER_SEATS] = capability(isHost && !session, isHost ? 'INVALID_TRANSITION' : 'HOST_REQUIRED');
  caps[COMMAND_TYPES.LEAVE_ROOM] = capability(!!actor && !isHost, isHost ? 'HOST_CANNOT_LEAVE' : 'NOT_MEMBER');
  caps[COMMAND_TYPES.KICK_MEMBER] = capability(isHost, 'HOST_REQUIRED');
  caps[COMMAND_TYPES.DISSOLVE_ROOM] = capability(isHost, 'HOST_REQUIRED');
  caps[COMMAND_TYPES.START_WORKSHOP_SESSION] = capability(isHost && !session, isHost ? 'INVALID_TRANSITION' : 'HOST_REQUIRED');
  caps[COMMAND_TYPES.SET_SCENARIO] = capability(
    isHost && WORKFLOW_GROUPS.SCENARIO_CONFIG.includes(step),
    'INVALID_TRANSITION'
  );
  caps[COMMAND_TYPES.SUBMIT_DESIGN_PROBLEM] = capability(isParticipant && step === WORKFLOW_STEP.COLLECT_DESIGN_PROBLEMS, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.UPDATE_DESIGN_PROBLEM] = capability(
    isHost && WORKFLOW_GROUPS.PROBLEM_SELECTION.includes(step),
    'INVALID_TRANSITION'
  );
  caps[COMMAND_TYPES.SELECT_DESIGN_PROBLEM] = capability(
    isHost && WORKFLOW_GROUPS.PROBLEM_SELECTION.includes(step),
    'INVALID_TRANSITION'
  );
  caps[COMMAND_TYPES.SELECT_FIRST_PLAYER] = capability(isHost
    && WORKFLOW_GROUPS.FIRST_PLAYER_SELECTION.includes(step), 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.CONFIRM_FIRST_PLAYER] = capability(isHost && step === WORKFLOW_STEP.CONFIRM_FIRST_PLAYER, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.CANCEL_WORKSHOP_SESSION] = capability(isHost && !!session && ![SESSION_STATUS.COMPLETED, SESSION_STATUS.CANCELLED].includes(session.status), 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.RETURN_TO_LOBBY] = capability(isHost && !!session && session.status === SESSION_STATUS.COMPLETED, 'INVALID_TRANSITION');
  const replayMinimum = session && session.mode === MODE.SPY ? 3 : 2;
  caps[COMMAND_TYPES.REPLAY_WORKSHOP_SESSION] = capability(
    isHost && !!session && session.status === SESSION_STATUS.COMPLETED
      && aggregate.room.members.length >= replayMinimum,
    'INVALID_TRANSITION'
  );
  const activeArtifactStage = !!turn
    && [WORKFLOW_STEP.PARTNER_TURN, WORKFLOW_STEP.PARTNER_STATEMENT].includes(step)
    && (isActorTurn || isHost);
  const activeArtifactAppendStage = !!turn && (
    (step === WORKFLOW_STEP.PARTNER_TURN && (isActorTurn || isHost))
    || (step === WORKFLOW_STEP.PARTNER_STATEMENT && isHost)
  );
  const closingArtifactStage = isHost && !!(partner && partner.closing)
    && [WORKFLOW_STEP.PARTNER_CLOSING_RUNE, WORKFLOW_STEP.PARTNER_CLOSING_REVIEW].includes(step);
  const canMutateArtifact = activeArtifactStage || closingArtifactStage;
  caps[COMMAND_TYPES.APPEND_ARTIFACT] = capability(activeArtifactAppendStage || closingArtifactStage, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.UPDATE_ARTIFACT] = capability(canMutateArtifact, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.REMOVE_ARTIFACT] = capability(canMutateArtifact, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.SUBMIT_PARTNER_SCORE] = capability(isParticipant && !!turn && !isActorTurn && step === WORKFLOW_STEP.PARTNER_TURN, isActorTurn ? 'SELF_SCORE' : 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.POST_PARTNER_MESSAGE] = capability(isParticipant && !!turn && ((step === WORKFLOW_STEP.PARTNER_TURN && !isActorTurn) || step === WORKFLOW_STEP.PARTNER_STATEMENT), 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.START_PARTNER_STATEMENT] = capability(isHost && step === WORKFLOW_STEP.PARTNER_TURN
    && !!turn && progressComplete(turn.scoreProgress),
  'INVALID_TRANSITION');
  caps[COMMAND_TYPES.ADVANCE_PARTNER_TURN] = capability(isHost && step === WORKFLOW_STEP.PARTNER_STATEMENT, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.USE_PARTNER_SPECIAL] = capability(isActorTurn && step === WORKFLOW_STEP.PARTNER_TURN && !turn.specialUsed, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.END_PARTNER_SILENT] = capability(step === WORKFLOW_STEP.PARTNER_TURN
    && !!turn && (isActorTurn || isHost) && !!turn.silentDeadlineAt, 'INVALID_TRANSITION');
  const canClosingVote = isParticipant && !!partner && !!partner.closing
    && step === WORKFLOW_STEP.PARTNER_CLOSING_VOTE
    && partner.closing.initiatorMemberId !== actor.memberId
    && partner.closing.requiredMemberIds.includes(actor.memberId)
    && !partner.closing.submittedMemberIds.includes(actor.memberId);
  caps[COMMAND_TYPES.SUBMIT_PARTNER_CLOSING_VOTE] = capability(canClosingVote, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.ADVANCE_PARTNER_CLOSING] = capability(isHost && step === WORKFLOW_STEP.PARTNER_CLOSING_RUNE, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.COMPLETE_PARTNER_SESSION] = capability(isHost && step === WORKFLOW_STEP.PARTNER_CLOSING_REVIEW, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.END_HALLI_ACTIVITY] = capability(isHost && step === WORKFLOW_STEP.HALLI_ACTIVITY, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.SUBMIT_HALLI_IDEA] = capability(isParticipant && step === WORKFLOW_STEP.HALLI_CREATIVE, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.COMPLETE_HALLI_SESSION] = capability(isHost && step === WORKFLOW_STEP.HALLI_SUMMARY, 'INVALID_TRANSITION');
  const spy = currentSpy(aggregate);
  const alive = !!(spy && actor && (spy.players || []).find((item) => item.memberId === actor.memberId && item.alive));
  caps[COMMAND_TYPES.START_SPY_GAME] = capability(isHost && step === WORKFLOW_STEP.SPY_INTRO, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.ADVANCE_SPY_SPEAKER] = capability(alive && spy
    && [WORKFLOW_STEP.SPY_SPEAK, WORKFLOW_STEP.SPY_TIE_SPEAK].includes(step)
    && spy.speakOrder[spy.currentSpeakerIndex] === actor.memberId, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.OPEN_SPY_VOTE] = capability(isHost && [WORKFLOW_STEP.SPY_SPEAK, WORKFLOW_STEP.SPY_TIE_SPEAK].includes(step), 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.SUBMIT_SPY_VOTE] = capability(
    alive && step === WORKFLOW_STEP.SPY_VOTE && !(actor.voteStatus && actor.voteStatus.submitted),
    'INVALID_TRANSITION'
  );
  caps[COMMAND_TYPES.START_NEXT_SPY_ROUND] = capability(isParticipant && step === WORKFLOW_STEP.SPY_RESULT, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.RESTART_SPY_GAME] = capability(isHost && step === WORKFLOW_STEP.SPY_SETTLED, 'INVALID_TRANSITION');
  caps[COMMAND_TYPES.COMPLETE_SPY_SESSION] = capability(isHost && step === WORKFLOW_STEP.SPY_SETTLED, 'INVALID_TRANSITION');
  return caps;
}

function projectRoute(aggregate, actorView) {
  const session = aggregate.currentSession;
  if (!session) return { name: 'addPlayer', params: {} };
  if (!actorView.isParticipant) return { name: 'addPlayer', params: { observing: true } };
  const step = session.workflow.step;
  const host = actorView.role === 'HOST';
  const routes = {
    [WORKFLOW_STEP.CHOOSE_SCENARIO]: host ? 'modeIndex' : 'subAwait',
    [WORKFLOW_STEP.COLLECT_DESIGN_PROBLEMS]: 'submitProblem',
    [WORKFLOW_STEP.SELECT_DESIGN_PROBLEM]: host ? 'selectProblem' : 'subAwait',
    [WORKFLOW_STEP.SELECT_FIRST_PLAYER]: host ? 'selectPlayer' : 'subAwait',
    [WORKFLOW_STEP.CONFIRM_FIRST_PLAYER]: 'confirmFirstPlayer',
    [WORKFLOW_STEP.PARTNER_TURN]: 'partnerGame', [WORKFLOW_STEP.PARTNER_STATEMENT]: 'partnerGame',
    [WORKFLOW_STEP.PARTNER_CLOSING_VOTE]: 'closingStatement',
    [WORKFLOW_STEP.PARTNER_CLOSING_RUNE]: 'partnerGame', [WORKFLOW_STEP.PARTNER_CLOSING_REVIEW]: 'partnerGame',
    [WORKFLOW_STEP.HALLI_ACTIVITY]: 'halliGame', [WORKFLOW_STEP.HALLI_CREATIVE]: 'creativeInput',
    [WORKFLOW_STEP.HALLI_SUMMARY]: 'creativeSummary', [WORKFLOW_STEP.SPY_INTRO]: 'spyIntro',
    [WORKFLOW_STEP.SPY_SPEAK]: 'spySpeak', [WORKFLOW_STEP.SPY_TIE_SPEAK]: 'spySpeak',
    [WORKFLOW_STEP.SPY_VOTE]: 'spyVote', [WORKFLOW_STEP.SPY_RESULT]: 'spyResult',
    [WORKFLOW_STEP.SPY_SETTLED]: 'spySettle'
  };
  if (session.status === SESSION_STATUS.COMPLETED) {
    if (session.mode === MODE.PARTNER) return { name: 'leaderboard', params: {} };
    if (session.mode === MODE.HALLI_GALLI) return { name: 'creativeSummary', params: {} };
    return { name: 'spySettle', params: {} };
  }
  if (step === WORKFLOW_STEP.HALLI_CREATIVE && actorView.contributionStatus.submitted) {
    return { name: 'creativeSummary', params: {} };
  }
  return { name: routes[step] || 'addPlayer', params: { phase: step } };
}

function projectActorView(aggregate, actorUserId) {
  const session = aggregate.currentSession;
  let member = findMember(aggregate, actorUserId);
  if (!member && session && [SESSION_STATUS.COMPLETED, SESSION_STATUS.CANCELLED].includes(session.status)) {
    const historical = (session.participants || []).find((item) => String(item.userId) === String(actorUserId));
    if (historical) {
      member = { memberId: historical.memberId, seatNo: historical.seatNoAtStart };
    }
  }
  if (!member) return null;
  const participant = session ? findParticipant(session, member.memberId) : null;
  const facts = aggregate.facts || {};
  const turn = currentPartner(aggregate) && currentPartner(aggregate).activeTurn;
  const contribution = session ? Object.values(facts.contributions || {}).find((item) => item.sessionId === session.sessionId && item.memberId === member.memberId) : null;
  const score = turn ? facts.scores && facts.scores[`${turn.turnId}:${member.memberId}`] : null;
  const closing = currentPartner(aggregate) && currentPartner(aggregate).closing;
  const spy = currentSpy(aggregate);
  const voteSessionId = closing ? closing.closingVoteSessionId : (spy && spy.voteProgress && spy.voteProgress.voteSessionId);
  const vote = voteSessionId ? facts.votes && facts.votes[`${voteSessionId}:${member.memberId}`] : null;
  const secret = spy ? facts.secrets && facts.secrets[`${spy.gameId}:${member.memberId}`] : null;
  const actor = {
    memberId: member.memberId,
    role: member.memberId === aggregate.room.hostMemberId ? 'HOST' : 'PLAYER',
    seatNo: participant ? participant.seatNoAtStart : member.seatNo,
    isParticipant: !!(participant && participant.status === 'ACTIVE'),
    contributionStatus: contribution ? { submitted: true, contributionId: contribution.contributionId, text: contribution.text, entityVersion: contribution.entityVersion } : { submitted: false },
    scoreStatus: score ? { submitted: true, scoreHalfSteps: score.scoreHalfSteps } : { submitted: false },
    voteStatus: vote ? { submitted: true, vote: vote.vote, targetMemberId: vote.targetMemberId || null } : { submitted: false },
    privateModeState: secret ? { gameId: secret.gameId, role: secret.role, word: secret.word, blurb: secret.blurb } : null
  };
  actor.capabilities = projectCapabilities(aggregate, actor);
  return actor;
}

function projectMemberView(aggregate, actorUserId) {
  const publicView = projectPublicView(aggregate);
  const actor = projectActorView(aggregate, actorUserId);
  if (!publicView || !actor) return null;
  return { ...publicView, actor, route: projectRoute(aggregate, actor) };
}

function createPublicPatch(before, after) {
  const set = {};
  const remove = [];
  function walk(left, right, path) {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    const bothObjects = left && right && typeof left === 'object' && typeof right === 'object'
      && !Array.isArray(left) && !Array.isArray(right);
    if (!bothObjects) { set[path || '$'] = clone(right); return; }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    keys.forEach((key) => {
      const nextPath = path ? `${path}.${key}` : key;
      if (!Object.prototype.hasOwnProperty.call(right, key)) remove.push(nextPath);
      else if (!Object.prototype.hasOwnProperty.call(left, key)) set[nextPath] = clone(right[key]);
      else walk(left[key], right[key], nextPath);
    });
  }
  walk(before, after, '');
  return { set, remove };
}

function setPath(target, path, value) {
  if (path === '$') return clone(value);
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = clone(value);
  return target;
}

function removePath(target, path) {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = cursor[parts[i]];
  }
  if (cursor && typeof cursor === 'object') delete cursor[parts[parts.length - 1]];
}

function applyPublicPatch(view, patch) {
  let next = clone(view || {});
  Object.keys((patch && patch.set) || {}).sort((a, b) => a.split('.').length - b.split('.').length)
    .forEach((path) => { next = setPath(next, path, patch.set[path]); });
  ((patch && patch.remove) || []).forEach((path) => removePath(next, path));
  return next;
}

function applyEventGroup(view, events) {
  if (!Array.isArray(events) || !events.length) return clone(view);
  const count = events[0].commandEventCount;
  if (events.length !== count || events.some((event, index) => event.commandEventIndex !== index + 1 || event.commandEventCount !== count)) {
    const error = new Error('incomplete event group');
    error.code = 'SNAPSHOT_REQUIRED';
    throw error;
  }
  let publicPart = clone(view || {});
  delete publicPart.actor;
  delete publicPart.route;
  events.forEach((event) => {
    if (event.payload && event.payload.publicPatch) publicPart = applyPublicPatch(publicPart, event.payload.publicPatch);
  });
  return { ...publicPart, actor: view && view.actor, route: view && view.route };
}

module.exports = { clone, projectPublicView, projectActorView, projectMemberView, projectCapabilities, projectRoute,
  createPublicPatch, applyPublicPatch, applyEventGroup };
