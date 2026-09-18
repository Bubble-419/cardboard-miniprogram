'use strict';

const {
  COMMAND_TYPES, MAX_SESSION_MESSAGES, MAX_SESSION_ARTIFACTS, MAX_PARTNER_TURNS
} = require('@cardboard/room-contracts');
const {
  clone, event, domainOk, fail, idOf, nowOf, ensureFacts, memberById, assertHost, assertParticipant,
  assertSession, assertTurn, transitionWorkflow, activeParticipantIds, activeParticipantsBySeat, isActiveParticipant,
  progressComplete, MODE, SESSION_STATUS, WORKFLOW_STEP, EVENT_TYPES, ERR
} = require('./model');

function partnerState(aggregate) {
  return aggregate.currentSession && aggregate.currentSession.modeState.partner;
}

// operationId 来自客户端 UI block key；编码后再作为文档内 Map key，避免点号被 CloudBase 当成字段路径。
function artifactFactKey(sessionId, operationId) {
  return `${sessionId}:OP:${encodeURIComponent(String(operationId)).replace(/\./g, '%2E')}`;
}

function orderedParticipantIds(aggregate, firstMemberId) {
  const ids = activeParticipantsBySeat(aggregate).map((member) => member.memberId);
  const index = ids.indexOf(firstMemberId);
  return index < 0 ? ids : ids.slice(index).concat(ids.slice(0, index));
}

function startPartnerFlow(aggregate, firstMemberId, deps) {
  const session = aggregate.currentSession;
  const order = orderedParticipantIds(aggregate, firstMemberId);
  session.modeState.partner = {
    roundNo: 1,
    turnOrdinal: 0,
    firstMemberId: order[0] || firstMemberId || null,
    roundRemainingMemberIds: order.slice(),
    activeTurn: null,
    closing: null
  };
  session.status = SESSION_STATUS.RUNNING;
  return startPartnerTurn(aggregate, order[0], deps, true);
}

function startPartnerTurn(aggregate, memberId, deps, countsForRound) {
  const session = aggregate.currentSession;
  const partner = partnerState(aggregate);
  const now = nowOf(deps);
  // 当前行动者立刻离开本轮剩余队列，避免归档漏删时下一次仍从同一人开始。
  partner.roundRemainingMemberIds = (partner.roundRemainingMemberIds || []).filter((id) => id !== memberId);
  partner.turnOrdinal += 1;
  const requiredMemberIds = activeParticipantIds(session).filter((id) => id !== memberId);
  const turn = {
    turnId: idOf(deps, 'turn'), ordinal: partner.turnOrdinal, roundNo: partner.roundNo,
    activeMemberId: memberId, countsForRound: countsForRound !== false, phase: 'PLAY',
    turnStartedAt: now, phaseStartedAt: now, specialUsed: null, masterMode: false,
    silentStartedAt: null, silentDeadlineAt: null,
    scoreProgress: { requiredMemberIds, submittedMemberIds: [] }
  };
  partner.activeTurn = turn;
  transitionWorkflow(session, WORKFLOW_STEP.PARTNER_TURN, deps, {
    roundNo: partner.roundNo,
    activeMemberId: memberId,
    turnId: turn.turnId
  });
  session.progress.scoreProgress = clone(turn.scoreProgress);
  session.updatedAt = now;
  return turn;
}

function scoreRowsForTurn(aggregate, turn) {
  const eligibleMemberIds = new Set((turn.scoreProgress && turn.scoreProgress.requiredMemberIds) || []);
  return Object.values(ensureFacts(aggregate).scores)
    .filter((row) => row.turnId === turn.turnId && eligibleMemberIds.has(row.memberId));
}

function archiveActiveTurn(aggregate, reason, statementResult, deps) {
  const facts = ensureFacts(aggregate);
  const session = aggregate.currentSession;
  const partner = partnerState(aggregate);
  const turn = partner.activeTurn;
  if (!turn) return null;
  // 离房者旧评分保留审计，但不能进入当前 Turn 的结算与排行榜。
  const scores = scoreRowsForTurn(aggregate, turn);
  const total = scores.reduce((sum, row) => sum + row.scoreHalfSteps / 2, 0);
  const summary = {
    sessionId: session.sessionId, turnId: turn.turnId, turnOrdinal: turn.ordinal, roundNo: turn.roundNo,
    activeMemberId: turn.activeMemberId, reason, statementResult: statementResult || null,
    avgScore: scores.length ? total / scores.length : null, scoredCount: scores.length,
    totalStars: total, startedAt: turn.turnStartedAt, completedAt: nowOf(deps)
  };
  facts.turns[turn.turnId] = summary;
  if (turn.countsForRound) {
    partner.roundRemainingMemberIds = partner.roundRemainingMemberIds.filter((id) => id !== turn.activeMemberId);
  }
  partner.activeTurn = null;
  session.workflow.turnId = null;
  session.workflow.activeMemberId = null;
  return summary;
}

function beginNextPartnerTurn(aggregate, deps) {
  const session = aggregate.currentSession;
  const partner = partnerState(aggregate);
  const valid = new Set(activeParticipantIds(session));
  partner.roundRemainingMemberIds = partner.roundRemainingMemberIds.filter((id) => valid.has(id));
  if (!partner.roundRemainingMemberIds.length) {
    beginNextPartnerRound(aggregate);
  }
  const nextMemberId = partner.roundRemainingMemberIds[0];
  return nextMemberId ? startPartnerTurn(aggregate, nextMemberId, deps, true) : null;
}

function beginNextPartnerRound(aggregate) {
  const partner = partnerState(aggregate);
  const valid = new Set(activeParticipantIds(aggregate.currentSession));
  partner.roundNo += 1;
  const firstMemberId = valid.has(partner.firstMemberId)
    ? partner.firstMemberId
    : (activeParticipantsBySeat(aggregate)[0] && activeParticipantsBySeat(aggregate)[0].memberId);
  partner.firstMemberId = firstMemberId || partner.firstMemberId || null;
  partner.roundRemainingMemberIds = orderedParticipantIds(aggregate, partner.firstMemberId);
  return partner.roundRemainingMemberIds;
}

function assertPartnerSession(aggregate, context, steps) {
  return assertSession(aggregate, context, { mode: MODE.PARTNER, steps });
}

function appendArtifact(aggregate, command, actor, deps) {
  const sessionCheck = assertPartnerSession(aggregate, command.context, [WORKFLOW_STEP.PARTNER_TURN, WORKFLOW_STEP.PARTNER_STATEMENT,
    WORKFLOW_STEP.PARTNER_CLOSING_RUNE, WORKFLOW_STEP.PARTNER_CLOSING_REVIEW]);
  if (!sessionCheck.ok) return sessionCheck;
  const partner = partnerState(aggregate);
  const turn = partner && partner.activeTurn;
  const closing = partner && partner.closing;
  const activeContext = !!(turn && turn.turnId === command.context.turnId);
  const closingContext = !!(closing && closing.sourceTurnId === command.context.turnId
    && [WORKFLOW_STEP.PARTNER_CLOSING_RUNE, WORKFLOW_STEP.PARTNER_CLOSING_REVIEW]
      .includes(sessionCheck.session.workflow.step));
  if (!activeContext && !closingContext) return fail(ERR.STALE_CONTEXT, '素材所属行动轮已经变化');
  const host = aggregate.room.hostMemberId === actor.memberId;
  if (!host && (!activeContext || turn.activeMemberId !== actor.memberId)) {
    return fail(ERR.INVALID_TRANSITION, '当前成员不能写入素材');
  }
  const facts = ensureFacts(aggregate);
  const operationId = String(command.payload.operationId || '').trim();
  if (!operationId) return fail(ERR.INVALID_ARGUMENT, 'operationId 必填');
  const stageByStep = {
    [WORKFLOW_STEP.PARTNER_TURN]: 'PLAY',
    [WORKFLOW_STEP.PARTNER_STATEMENT]: 'DISCUSSION',
    [WORKFLOW_STEP.PARTNER_CLOSING_RUNE]: 'CLOSING_RUNE',
    [WORKFLOW_STEP.PARTNER_CLOSING_REVIEW]: 'CLOSING_REVIEW'
  };
  const stage = stageByStep[aggregate.currentSession.workflow.step];
  const nonHostCanAppend = activeContext
    && aggregate.currentSession.workflow.step === WORKFLOW_STEP.PARTNER_TURN
    && turn.activeMemberId === actor.memberId;
  if (!host && !nonHostCanAppend) {
    return fail(ERR.INVALID_TRANSITION, '当前阶段仅房主可以新增素材');
  }
  const text = command.payload.text == null ? null : String(command.payload.text).trim();
  if (text && text.length > 500) return fail(ERR.LIMIT_EXCEEDED, '共享文本最多 500 字');
  if (!text && !command.payload.fileRef) return fail(ERR.INVALID_ARGUMENT, '素材内容不能为空');
  const fileRef = command.payload.fileRef || null;
  const kind = command.payload.kind || (fileRef ? 'IMAGE' : 'TEXT');
  const key = artifactFactKey(command.context.sessionId, operationId);
  const existing = facts.artifacts[key];
  if (existing) {
    const sameOperation = existing.turnId === command.context.turnId && existing.stage === stage
      && existing.kind === kind && existing.text === text && existing.fileRef === fileRef;
    if (!sameOperation) return fail(ERR.COMMAND_ID_CONFLICT, 'operationId 已用于其他素材');
    return domainOk(aggregate, [event(EVENT_TYPES.ARTIFACT_APPENDED, { operationId, duplicate: true })],
      { kind: 'ACCEPTED', operationId, artifactId: existing.artifactId });
  }
  if (Object.keys(facts.artifacts).length >= MAX_SESSION_ARTIFACTS) {
    return fail(ERR.LIMIT_EXCEEDED, `当前场次素材已达到 ${MAX_SESSION_ARTIFACTS} 条上限`);
  }
  const count = Object.values(facts.artifacts).filter((item) => item.turnId === command.context.turnId && item.stage === stage && !item.removed).length;
  if (count >= 200) return fail(ERR.LIMIT_EXCEEDED, '当前阶段素材已达到 200 条上限');
  const artifact = {
    artifactId: idOf(deps, 'artifact'), operationId, sessionId: command.context.sessionId,
    turnId: command.context.turnId, stage, kind,
    text, fileRef, authorMemberId: actor.memberId, entityVersion: 1,
    removed: false, createdAt: nowOf(deps), updatedAt: nowOf(deps)
  };
  facts.artifacts[key] = artifact;
  return domainOk(aggregate, [event(EVENT_TYPES.ARTIFACT_APPENDED, { artifactId: artifact.artifactId, operationId })],
    { kind: 'ACCEPTED', artifactId: artifact.artifactId }, [{ kind: 'artifacts', id: key }]);
}

function updateArtifact(aggregate, command, actor, remove, deps) {
  const sessionCheck = assertPartnerSession(aggregate, command.context, [WORKFLOW_STEP.PARTNER_TURN,
    WORKFLOW_STEP.PARTNER_STATEMENT, WORKFLOW_STEP.PARTNER_CLOSING_RUNE, WORKFLOW_STEP.PARTNER_CLOSING_REVIEW]);
  if (!sessionCheck.ok) return sessionCheck;
  const facts = ensureFacts(aggregate);
  const operationId = String(command.payload.operationId || '').trim();
  const key = artifactFactKey(command.context.sessionId, operationId);
  const artifact = facts.artifacts[key];
  if (!artifact || artifact.turnId !== command.context.turnId) return fail(ERR.STALE_CONTEXT, '素材不存在或已换轮');
  if (Number(command.context.entityVersion) !== artifact.entityVersion) return fail(ERR.STALE_CONTEXT, '素材已经更新');
  const host = aggregate.room.hostMemberId === actor.memberId;
  if (!host && artifact.authorMemberId !== actor.memberId) return fail(ERR.INVALID_TRANSITION, '不能修改其他成员素材');
  const partner = partnerState(aggregate);
  const activeContext = partner.activeTurn && partner.activeTurn.turnId === artifact.turnId;
  const closingContext = partner.closing && partner.closing.sourceTurnId === artifact.turnId
    && ['CLOSING_RUNE', 'CLOSING_REVIEW'].includes(artifact.stage);
  if (!activeContext && !closingContext) return fail(ERR.STALE_CONTEXT, '素材所属行动轮已经归档');
  if (remove) artifact.removed = true;
  else {
    const text = String(command.payload.text || '').trim();
    if (!text) return fail(ERR.INVALID_ARGUMENT, '素材内容不能为空');
    if (text.length > 500) return fail(ERR.LIMIT_EXCEEDED, '共享文本最多 500 字');
    artifact.text = text;
    if (command.payload.fileRef !== undefined) artifact.fileRef = command.payload.fileRef || null;
  }
  artifact.entityVersion += 1;
  artifact.updatedAt = nowOf(deps);
  const type = remove ? EVENT_TYPES.ARTIFACT_REMOVED : EVENT_TYPES.ARTIFACT_UPDATED;
  return domainOk(aggregate, [event(type, { artifactId: artifact.artifactId, entityVersion: artifact.entityVersion })],
    { kind: 'ACCEPTED', artifactId: artifact.artifactId, entityVersion: artifact.entityVersion }, [{ kind: 'artifacts', id: key }]);
}

function resolveClosing(aggregate, deps) {
  const session = aggregate.currentSession;
  const partner = partnerState(aggregate);
  const closing = partner.closing;
  const facts = ensureFacts(aggregate);
  const requiredVoters = new Set(closing.requiredMemberIds);
  const rows = Object.values(facts.votes).filter((row) => row.voteSessionId === closing.closingVoteSessionId
    && requiredVoters.has(row.memberId));
  const seats = new Map((session.participants || []).map((item) => [item.memberId, item.seatNoAtStart]));
  // V2 约定多人质疑时由冻结座次最小者接棒，提交网络时序不能改变下一行动者。
  const question = rows.filter((row) => row.vote === 'question').sort((a, b) =>
    (seats.get(a.memberId) || Number.MAX_SAFE_INTEGER)
      - (seats.get(b.memberId) || Number.MAX_SAFE_INTEGER)
      || a.createdAt - b.createdAt)[0];
  const summary = archiveActiveTurn(aggregate, question ? 'CLOSING_QUESTIONED' : 'CLOSING_ACCEPTED', null, deps);
  const dirty = summary ? [{ kind: 'turns', id: summary.turnId }] : [];
  if (question) {
    closing.stage = 'QUESTIONED';
    // 若整轮已结束且首位玩家被质疑，这次回答就是新轮的首个行动。
    // 否则回答完成后再从首位开始新轮，会让同一成员连续行动两次。
    if (!partner.roundRemainingMemberIds.length) {
      const nextRoundOrder = orderedParticipantIds(aggregate,
        activeParticipantIds(session).includes(partner.firstMemberId)
          ? partner.firstMemberId
          : (activeParticipantsBySeat(aggregate)[0] && activeParticipantsBySeat(aggregate)[0].memberId));
      if (nextRoundOrder[0] === question.memberId) beginNextPartnerRound(aggregate);
    }
    let countsForRound = partner.roundRemainingMemberIds.includes(question.memberId);
    if (countsForRound) {
      partner.roundRemainingMemberIds = [question.memberId].concat(partner.roundRemainingMemberIds.filter((id) => id !== question.memberId));
    }
    const turn = startPartnerTurn(aggregate, question.memberId, deps, countsForRound);
    partner.closing = null;
    return { events: [event(EVENT_TYPES.PARTNER_TURN_COMPLETED, { turnId: summary.turnId, reason: summary.reason }),
      event(EVENT_TYPES.PARTNER_CLOSING_QUESTIONED, { memberId: question.memberId }),
      event(EVENT_TYPES.PARTNER_TURN_STARTED, { turnId: turn.turnId, memberId: question.memberId, roundNo: turn.roundNo })], dirty };
  }
  closing.stage = 'RUNE';
  transitionWorkflow(session, WORKFLOW_STEP.PARTNER_CLOSING_RUNE, deps, {
    roundNo: partner.roundNo,
    activeMemberId: null,
    turnId: closing.sourceTurnId
  });
  return { events: [event(EVENT_TYPES.PARTNER_TURN_COMPLETED, { turnId: summary.turnId, reason: summary.reason }),
    event(EVENT_TYPES.PARTNER_CLOSING_ACCEPTED, { closingVoteSessionId: closing.closingVoteSessionId })], dirty };
}

function reducePartnerCommand(aggregate, command, actorUserId, deps) {
  const type = command.type;
  const actorCheck = assertParticipant(aggregate, actorUserId);
  const memberCheck = type === COMMAND_TYPES.COMPLETE_PARTNER_SESSION || type === COMMAND_TYPES.ADVANCE_PARTNER_CLOSING
    ? assertHost(aggregate, actorUserId) : actorCheck;
  if (!memberCheck.ok) return memberCheck;
  const actor = memberCheck.member;

  if (type === COMMAND_TYPES.APPEND_ARTIFACT) return appendArtifact(aggregate, command, actor, deps);
  if (type === COMMAND_TYPES.UPDATE_ARTIFACT) return updateArtifact(aggregate, command, actor, false, deps);
  if (type === COMMAND_TYPES.REMOVE_ARTIFACT) return updateArtifact(aggregate, command, actor, true, deps);

  if (type === COMMAND_TYPES.SUBMIT_PARTNER_SCORE) {
    const check = assertTurn(aggregate, command.context, [WORKFLOW_STEP.PARTNER_TURN]);
    if (!check.ok) return check;
    if (check.turn.activeMemberId === actor.memberId) return fail(ERR.SELF_SCORE);
    if (!check.turn.scoreProgress.requiredMemberIds.includes(actor.memberId)) return fail(ERR.NOT_PARTICIPANT);
    const facts = ensureFacts(aggregate);
    const key = `${check.turn.turnId}:${actor.memberId}`;
    facts.scores[key] = { sessionId: check.session.sessionId, turnId: check.turn.turnId, memberId: actor.memberId,
      scoreHalfSteps: Number(command.payload.scoreHalfSteps), updatedAt: nowOf(deps) };
    if (!check.turn.scoreProgress.submittedMemberIds.includes(actor.memberId)) check.turn.scoreProgress.submittedMemberIds.push(actor.memberId);
    check.session.progress.scoreProgress = clone(check.turn.scoreProgress);
    return domainOk(aggregate, [event(EVENT_TYPES.PARTNER_SCORE_RECORDED, { turnId: check.turn.turnId,
      scoredCount: check.turn.scoreProgress.submittedMemberIds.length, requiredCount: check.turn.scoreProgress.requiredMemberIds.length })],
    { kind: 'ACCEPTED' }, [{ kind: 'scores', id: key }]);
  }

  if (type === COMMAND_TYPES.POST_PARTNER_MESSAGE) {
    const check = assertTurn(aggregate, command.context, [WORKFLOW_STEP.PARTNER_TURN, WORKFLOW_STEP.PARTNER_STATEMENT]);
    if (!check.ok) return check;
    if (check.session.workflow.step === WORKFLOW_STEP.PARTNER_TURN && check.turn.activeMemberId === actor.memberId) return fail(ERR.INVALID_TRANSITION, '当前行动者不能发送匿名表达');
    const facts = ensureFacts(aggregate);
    if (facts.messages.length >= MAX_SESSION_MESSAGES) {
      return fail(ERR.LIMIT_EXCEEDED, `当前场次匿名表达已达到 ${MAX_SESSION_MESSAGES} 条上限`);
    }
    const text = String(command.payload.text || '').trim();
    if (!text) return fail(ERR.INVALID_ARGUMENT, '表达内容不能为空');
    if (text.length > 40) return fail(ERR.LIMIT_EXCEEDED, '表达内容最多 40 字');
    const message = { messageId: idOf(deps, 'message'), sessionId: check.session.sessionId, turnId: check.turn.turnId,
      turnOrdinal: check.turn.ordinal, roundNo: check.turn.roundNo,
      phase: check.session.workflow.step === WORKFLOW_STEP.PARTNER_STATEMENT ? 'discussion' : 'play',
      text, anonKey: `anon_${actor.memberId.slice(-6)}`, authorMemberId: actor.memberId, createdAt: nowOf(deps) };
    facts.messages.push(message);
    return domainOk(aggregate, [event(EVENT_TYPES.PARTNER_MESSAGE_POSTED, { messageId: message.messageId })],
      { kind: 'ACCEPTED', messageId: message.messageId }, [{ kind: 'messages', id: message.messageId }]);
  }

  if (type === COMMAND_TYPES.START_PARTNER_STATEMENT) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertTurn(aggregate, command.context, [WORKFLOW_STEP.PARTNER_TURN]); if (!check.ok) return check;
    if (!progressComplete(check.turn.scoreProgress)) return fail(ERR.INVALID_TRANSITION, '评分尚未完成');
    if (check.turn.ordinal >= MAX_PARTNER_TURNS) {
      return fail(ERR.LIMIT_EXCEEDED, `当前场次已达到 ${MAX_PARTNER_TURNS} 个行动轮，请使用收尾行动`);
    }
    if (command.payload.statementResult === 'allPass') {
      const summary = archiveActiveTurn(aggregate, 'COMPLETED', 'allPass', deps);
      const turn = beginNextPartnerTurn(aggregate, deps);
      if (!turn) return fail(ERR.INVALID_TRANSITION, '没有可用的下一位参与者');
      return domainOk(aggregate, [event(EVENT_TYPES.PARTNER_TURN_COMPLETED, { turnId: summary.turnId, summary }),
        event(EVENT_TYPES.PARTNER_TURN_STARTED, { turnId: turn.turnId, memberId: turn.activeMemberId, roundNo: turn.roundNo })],
      { kind: 'ACCEPTED', turnId: turn.turnId }, [{ kind: 'turns', id: summary.turnId }]);
    }
    check.turn.phase = 'STATEMENT'; check.turn.statementResult = command.payload.statementResult;
    check.turn.phaseStartedAt = nowOf(deps); check.turn.masterMode = false;
    check.turn.silentStartedAt = null; check.turn.silentDeadlineAt = null;
    transitionWorkflow(check.session, WORKFLOW_STEP.PARTNER_STATEMENT, deps, {
      roundNo: check.turn.roundNo,
      activeMemberId: check.turn.activeMemberId,
      turnId: check.turn.turnId
    });
    return domainOk(aggregate, [event(EVENT_TYPES.PARTNER_STATEMENT_STARTED, { turnId: check.turn.turnId })]);
  }

  if (type === COMMAND_TYPES.ADVANCE_PARTNER_TURN) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertTurn(aggregate, command.context, [WORKFLOW_STEP.PARTNER_STATEMENT]); if (!check.ok) return check;
    const summary = archiveActiveTurn(aggregate, 'COMPLETED', check.turn.statementResult, deps);
    const turn = beginNextPartnerTurn(aggregate, deps);
    if (!turn) return fail(ERR.INVALID_TRANSITION, '没有可用的下一位参与者');
    return domainOk(aggregate, [event(EVENT_TYPES.PARTNER_TURN_COMPLETED, { turnId: summary.turnId, summary }),
      event(EVENT_TYPES.PARTNER_TURN_STARTED, { turnId: turn.turnId, memberId: turn.activeMemberId, roundNo: turn.roundNo })],
    { kind: 'ACCEPTED', turnId: turn.turnId }, [{ kind: 'turns', id: summary.turnId }]);
  }

  if (type === COMMAND_TYPES.USE_PARTNER_SPECIAL) {
    const check = assertTurn(aggregate, command.context, [WORKFLOW_STEP.PARTNER_TURN]); if (!check.ok) return check;
    if (check.turn.activeMemberId !== actor.memberId) return fail(ERR.INVALID_TRANSITION, '仅当前行动者可使用');
    if (check.turn.specialUsed) return fail(ERR.INVALID_TRANSITION, '本行动轮已经使用特殊行动');
    const kind = command.payload.kind;
    if (check.turn.ordinal >= MAX_PARTNER_TURNS && kind !== 'CLOSING') {
      return fail(ERR.LIMIT_EXCEEDED, `当前场次已达到 ${MAX_PARTNER_TURNS} 个行动轮，请使用收尾行动`);
    }
    check.turn.specialUsed = kind;
    const events = [event(EVENT_TYPES.PARTNER_SPECIAL_USED, { turnId: check.turn.turnId, kind })];
    if (kind === 'MASTER') check.turn.masterMode = true;
    if (kind === 'SILENT') {
      check.turn.silentStartedAt = nowOf(deps); check.turn.silentDeadlineAt = nowOf(deps) + 5 * 60 * 1000;
    }
    if (kind === 'CLOSING') {
      const voteSessionId = idOf(deps, 'closing');
      const requiredMemberIds = activeParticipantIds(check.session).filter((id) => id !== actor.memberId);
      partnerState(aggregate).closing = { closingVoteSessionId: voteSessionId, sourceTurnId: check.turn.turnId,
        initiatorMemberId: actor.memberId, requiredMemberIds, submittedMemberIds: [], stage: 'VOTE', createdAt: nowOf(deps) };
      transitionWorkflow(check.session, WORKFLOW_STEP.PARTNER_CLOSING_VOTE, deps, {
        roundNo: check.turn.roundNo,
        activeMemberId: check.turn.activeMemberId,
        turnId: check.turn.turnId
      });
      events.push(event(EVENT_TYPES.PARTNER_CLOSING_VOTE_STARTED, { closingVoteSessionId: voteSessionId, initiatorMemberId: actor.memberId }));
    }
    return domainOk(aggregate, events);
  }

  if (type === COMMAND_TYPES.END_PARTNER_SILENT) {
    const check = assertTurn(aggregate, command.context, [WORKFLOW_STEP.PARTNER_TURN]); if (!check.ok) return check;
    if (check.turn.activeMemberId !== actor.memberId) {
      return fail(ERR.INVALID_TRANSITION, '仅当前特殊行动玩家可以结束静默');
    }
    if (!check.turn.silentDeadlineAt) return fail(ERR.INVALID_TRANSITION, '静默行动未开启');
    check.turn.silentDeadlineAt = null; check.turn.silentStartedAt = null;
    return domainOk(aggregate, [event(EVENT_TYPES.PARTNER_SILENT_ENDED, { turnId: check.turn.turnId })]);
  }

  if (type === COMMAND_TYPES.SUBMIT_PARTNER_CLOSING_VOTE) {
    const check = assertPartnerSession(aggregate, command.context, [WORKFLOW_STEP.PARTNER_CLOSING_VOTE]); if (!check.ok) return check;
    const closing = partnerState(aggregate).closing;
    if (!closing || closing.closingVoteSessionId !== command.context.closingVoteSessionId) return fail(ERR.STALE_CONTEXT, '收尾投票已经变化');
    if (closing.initiatorMemberId === actor.memberId) return fail(ERR.ALREADY_VOTED, '发起者已经自动通过');
    if (!closing.requiredMemberIds.includes(actor.memberId)) return fail(ERR.NOT_PARTICIPANT);
    if (closing.submittedMemberIds.includes(actor.memberId)) return fail(ERR.ALREADY_VOTED);
    const activeTurn = partnerState(aggregate).activeTurn;
    if (command.payload.vote === 'question' && activeTurn && activeTurn.ordinal >= MAX_PARTNER_TURNS) {
      return fail(ERR.LIMIT_EXCEEDED, `当前场次已达到 ${MAX_PARTNER_TURNS} 个行动轮，请选择通过`);
    }
    const facts = ensureFacts(aggregate); const key = `${closing.closingVoteSessionId}:${actor.memberId}`;
    facts.votes[key] = { sessionId: check.session.sessionId, voteSessionId: closing.closingVoteSessionId,
      memberId: actor.memberId, vote: command.payload.vote, createdAt: nowOf(deps) };
    closing.submittedMemberIds.push(actor.memberId);
    const events = [event(EVENT_TYPES.PARTNER_CLOSING_VOTE_RECORDED, { closingVoteSessionId: closing.closingVoteSessionId,
      votedCount: closing.submittedMemberIds.length, requiredCount: closing.requiredMemberIds.length })];
    const dirty = [{ kind: 'votes', id: key }];
    if (progressComplete(closing)) {
      const resolved = resolveClosing(aggregate, deps); events.push(...resolved.events); dirty.push(...resolved.dirty);
    }
    return domainOk(aggregate, events, { kind: 'ACCEPTED' }, dirty);
  }

  if (type === COMMAND_TYPES.ADVANCE_PARTNER_CLOSING) {
    const check = assertPartnerSession(aggregate, command.context, [WORKFLOW_STEP.PARTNER_CLOSING_RUNE]); if (!check.ok) return check;
    const partner = partnerState(aggregate); partner.closing.stage = 'REVIEW';
    transitionWorkflow(check.session, WORKFLOW_STEP.PARTNER_CLOSING_REVIEW, deps, {
      activeMemberId: null,
      turnId: partner.closing.sourceTurnId
    });
    return domainOk(aggregate, [event(EVENT_TYPES.PARTNER_CLOSING_REVIEW_STARTED, { sourceTurnId: partner.closing.sourceTurnId })]);
  }

  if (type === COMMAND_TYPES.COMPLETE_PARTNER_SESSION) {
    const check = assertPartnerSession(aggregate, command.context, [WORKFLOW_STEP.PARTNER_CLOSING_REVIEW]); if (!check.ok) return check;
    const turns = Object.values(ensureFacts(aggregate).turns).filter((row) => row.sessionId === check.session.sessionId);
    const totals = {};
    (check.session.participants || []).forEach((participant) => { totals[participant.memberId] = 0; });
    turns.forEach((row) => { totals[row.activeMemberId] = (totals[row.activeMemberId] || 0) + (row.totalStars || 0); });
    check.session.status = SESSION_STATUS.COMPLETED; check.session.completedAt = nowOf(deps);
    check.session.result = { mode: MODE.PARTNER,
      leaderboard: Object.keys(totals).map((memberId) => ({ memberId, totalStars: totals[memberId] })).sort((a, b) => b.totalStars - a.totalStars),
      // 完整 Turn 保留在独立事实表；Session 只保存有界汇总，避免文档随游戏时长无限增长。
      turnCount: turns.length };
    return domainOk(aggregate, [event(EVENT_TYPES.WORKSHOP_SESSION_COMPLETED, { sessionId: check.session.sessionId, mode: MODE.PARTNER })]);
  }

  return fail(ERR.INVALID_ARGUMENT, `未实现的 Partner 命令: ${type}`);
}

function handlePartnerParticipantLeft(aggregate, memberId, deps) {
  const session = aggregate.currentSession; const partner = partnerState(aggregate); const events = []; const dirtyFacts = [];
  if (!partner) {
    const contribution = session && session.progress && session.progress.contributionProgress;
    if (session && session.workflow.step === WORKFLOW_STEP.COLLECT_DESIGN_PROBLEMS
      && contribution && progressComplete(contribution)) {
      transitionWorkflow(session, WORKFLOW_STEP.SELECT_DESIGN_PROBLEM, deps, {
        activeMemberId: null,
        turnId: null
      });
      events.push(event(EVENT_TYPES.PROBLEM_COLLECTION_COMPLETED, { sessionId: session.sessionId }));
    }
    if (session && session.workflow.step === WORKFLOW_STEP.CONFIRM_FIRST_PLAYER
      && session.setup.proposedFirstMemberId === memberId) {
      session.setup.proposedFirstMemberId = null;
      transitionWorkflow(session, WORKFLOW_STEP.SELECT_FIRST_PLAYER, deps, {
        activeMemberId: null,
        turnId: null
      });
      events.push(event(EVENT_TYPES.FIRST_PLAYER_SELECTION_RESET, { memberId }));
    }
    return { events, dirtyFacts };
  }
  partner.roundRemainingMemberIds = partner.roundRemainingMemberIds.filter((id) => id !== memberId);
  if (partner.firstMemberId === memberId) {
    partner.firstMemberId = partner.roundRemainingMemberIds[0]
      || (activeParticipantsBySeat(aggregate)[0] && activeParticipantsBySeat(aggregate)[0].memberId)
      || null;
  }
  if (partner.activeTurn) {
    partner.activeTurn.scoreProgress.requiredMemberIds = partner.activeTurn.scoreProgress.requiredMemberIds.filter((id) => id !== memberId);
    partner.activeTurn.scoreProgress.submittedMemberIds = partner.activeTurn.scoreProgress.submittedMemberIds.filter((id) => id !== memberId);
    session.progress.scoreProgress = clone(partner.activeTurn.scoreProgress);
  }
  if (partner.closing) {
    partner.closing.requiredMemberIds = partner.closing.requiredMemberIds.filter((id) => id !== memberId);
    partner.closing.submittedMemberIds = partner.closing.submittedMemberIds.filter((id) => id !== memberId);
    if (partner.closing.initiatorMemberId === memberId) {
      const summary = archiveActiveTurn(aggregate, 'ABANDONED', null, deps);
      if (summary) { dirtyFacts.push({ kind: 'turns', id: summary.turnId }); events.push(event(EVENT_TYPES.PARTNER_TURN_ABANDONED, { turnId: summary.turnId })); }
      partner.closing = null;
      const next = beginNextPartnerTurn(aggregate, deps);
      if (next) events.push(event(EVENT_TYPES.PARTNER_TURN_STARTED, { turnId: next.turnId, memberId: next.activeMemberId, roundNo: next.roundNo }));
      return { events, dirtyFacts };
    }
    if (progressComplete(partner.closing)) {
      const resolved = resolveClosing(aggregate, deps); events.push(...resolved.events); dirtyFacts.push(...resolved.dirty);
    }
  }
  if (partner.activeTurn && partner.activeTurn.activeMemberId === memberId) {
    const summary = archiveActiveTurn(aggregate, 'ABANDONED', null, deps);
    dirtyFacts.push({ kind: 'turns', id: summary.turnId });
    events.push(event(EVENT_TYPES.PARTNER_TURN_ABANDONED, { turnId: summary.turnId }));
    const next = beginNextPartnerTurn(aggregate, deps);
    if (next) events.push(event(EVENT_TYPES.PARTNER_TURN_STARTED, { turnId: next.turnId, memberId: next.activeMemberId, roundNo: next.roundNo }));
  }
  return { events, dirtyFacts };
}

module.exports = { reducePartnerCommand, startPartnerFlow, startPartnerTurn, handlePartnerParticipantLeft, archiveActiveTurn };
