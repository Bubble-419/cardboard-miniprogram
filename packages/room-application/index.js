'use strict';

const crypto = require('crypto');
const {
  PROTOCOL_VERSION, VIEW_SCHEMA_VERSION, EVENT_SCHEMA_VERSION, COMMAND_TYPES, EVENT_TYPES, ERR,
  fail, okResult, validateCommandEnvelope, stableStringify, isNonEmptyString,
  validatePublicViewPatch, validateActorViewPatch, MAX_SESSION_DOCUMENT_BYTES,
  MAX_SYNC_RESPONSE_BYTES, MAX_INCREMENTAL_SYNC_EVENTS, SIGNAL_TYPES
} = require('@cardboard/room-contracts');
const { reduceCommand, authorizeRoomRead, authorizeSessionRead, memberByUserId } = require('@cardboard/room-domain');
const {
  clone, projectPublicView, projectMemberView, createPublicPatch, projectActorPatches
} = require('@cardboard/room-projection');

const DEFAULT_SYNC_LIMIT = 100;
const PRESENCE_TTL_MS = 15000;

function isRoomId(value) {
  return typeof value === 'string' && /^\d{8}$/.test(value);
}

function isOpaqueId(value) {
  return isNonEmptyString(value) && value.length <= 128;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function deriveCommandSeed(serverSecret, roomId, commandId, purpose) {
  if (!isNonEmptyString(serverSecret)) {
    const error = new Error('ROOM_PROTOCOL_SERVER_SECRET 未配置');
    error.code = ERR.INTERNAL_ERROR;
    throw error;
  }
  return crypto.createHmac('sha256', serverSecret)
    .update(`${roomId}:${commandId}:${purpose || 'domain'}`)
    .digest('hex');
}

function deterministicRandom(seed) {
  let counter = 0;
  return () => {
    const bytes = crypto.createHash('sha256').update(`${seed}:${counter++}`).digest();
    return bytes.readUInt32BE(0) / 0x100000000;
  };
}

function deterministicIds(seed) {
  let counter = 0;
  return (prefix) => `${prefix}_${hash(`${seed}:${prefix}:${counter++}`).slice(0, 20)}`;
}

function requestHash(envelope) {
  return hash(stableStringify({ type: envelope.type, context: envelope.context, payload: envelope.payload }));
}

function markCommittedFacts(aggregate, dirtyFacts, commitSeq) {
  const facts = aggregate && aggregate.facts;
  if (!facts) return;
  (dirtyFacts || []).forEach(({ kind, id }) => {
    if (kind === 'messages') {
      const row = (facts.messages || []).find((item) => item.messageId === id);
      if (row) row.commitSeq = commitSeq;
      return;
    }
    const bucket = facts[kind];
    if (bucket && bucket[id]) bucket[id].commitSeq = commitSeq;
  });
}

function buildEventGroup(envelope, domainEvents, room, beforeAggregate, afterAggregate, beforePublic, afterPublic, occurredAt) {
  const events = domainEvents && domainEvents.length ? domainEvents : [];
  if (!events.length) throw new Error('accepted command must produce at least one event');
  return {
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    viewSchemaVersion: VIEW_SCHEMA_VERSION,
    roomId: room.roomId,
    seq: room.eventSeq + 1,
    stateVersion: room.stateVersion + 1,
    commandId: envelope.commandId,
    sessionId: envelope.context.sessionId || (afterPublic && afterPublic.session ? afterPublic.session.sessionId : null),
    rawEvents: clone(events),
    // 公共事件只承担语义提示；客户端状态完全由投影补丁恢复，避免领域 payload 意外泄密。
    publicEvents: events.map((item) => ({ type: item.type })),
    publicPatch: createPublicPatch(beforePublic, afterPublic),
    actorProjections: projectActorPatches(beforeAggregate, afterAggregate),
    occurredAt
  };
}

const KNOWN_EVENT_TYPES = new Set(Object.values(EVENT_TYPES));

function validEventGroup(eventGroup) {
  const projections = eventGroup && eventGroup.actorProjections;
  const recipients = Array.isArray(projections)
    ? projections.map((item) => item && item.recipientMemberId)
    : [];
  return !!eventGroup
    && eventGroup.eventSchemaVersion === EVENT_SCHEMA_VERSION
    && eventGroup.viewSchemaVersion === VIEW_SCHEMA_VERSION
    && Number.isInteger(eventGroup.seq)
    && Number.isInteger(eventGroup.stateVersion)
    && isNonEmptyString(eventGroup.commandId)
    && Array.isArray(eventGroup.publicEvents)
    && eventGroup.publicEvents.length > 0
    && eventGroup.publicEvents.length <= 32
    && eventGroup.publicEvents.every((item) => item && Object.keys(item).length === 1
      && KNOWN_EVENT_TYPES.has(item.type))
    && validatePublicViewPatch(eventGroup.publicPatch)
    && Array.isArray(projections)
    && projections.length <= 6
    && projections.every((item) => item && isOpaqueId(item.recipientMemberId)
      && validateActorViewPatch(item.actorPatch))
    && new Set(recipients).size === recipients.length;
}

function projectEventGroupForMember(eventGroup, memberId) {
  const actorProjection = (eventGroup.actorProjections || [])
    .find((item) => item && item.recipientMemberId === memberId);
  // 显式白名单构造传输事件，绝不把 rawEvents 或其他成员投影返回客户端。
  return {
    eventSchemaVersion: eventGroup.eventSchemaVersion,
    viewSchemaVersion: eventGroup.viewSchemaVersion,
    roomId: eventGroup.roomId,
    seq: eventGroup.seq,
    stateVersion: eventGroup.stateVersion,
    commandId: eventGroup.commandId,
    sessionId: eventGroup.sessionId || null,
    publicEvents: clone(eventGroup.publicEvents),
    publicPatch: clone(eventGroup.publicPatch),
    actorPatch: actorProjection ? clone(actorProjection.actorPatch) : null,
    occurredAt: eventGroup.occurredAt
  };
}

/** 应用层只编排事务、投影与同步；所有业务裁决留在领域 Reducer。 */
function createRoomApplication(repo, options) {
  if (!repo || typeof repo.transactCommand !== 'function') throw new Error('RoomRepository required');
  const appOptions = options || {};
  const now = () => Number(typeof appOptions.now === 'function' ? appOptions.now() : (appOptions.now || Date.now()));
  const requestedSessionLimit = Number(appOptions.maxSessionDocumentBytes);
  const sessionDocumentByteLimit = Number.isFinite(requestedSessionLimit) && requestedSessionLimit > 0
    ? Math.min(MAX_SESSION_DOCUMENT_BYTES, requestedSessionLimit)
    : MAX_SESSION_DOCUMENT_BYTES;

  function validateSessionDocumentSize(aggregate) {
    const documents = [];
    if (aggregate && aggregate.currentSession) {
      documents.push({ ...aggregate.currentSession, roomId: aggregate.room.roomId,
        facts: aggregate.facts || {} });
    }
    if (aggregate && aggregate.archivedSession) {
      documents.push({ ...aggregate.archivedSession, roomId: aggregate.room.roomId,
        facts: aggregate.archivedFacts || {} });
    }
    for (const document of documents) {
      let bytes;
      try {
        bytes = Buffer.byteLength(JSON.stringify(document), 'utf8');
      } catch (error) {
        return fail(ERR.INTERNAL_ERROR, '场次数据无法序列化');
      }
      if (bytes > sessionDocumentByteLimit) {
        return fail(ERR.LIMIT_EXCEEDED, '当前场次数据已达到存储上限，请结束场次');
      }
    }
    return null;
  }

  async function touchActivity(roomId, memberId, actorContext) {
    if (!actorContext || actorContext.touchPresence !== true || !isOpaqueId(actorContext.deviceSessionId)
      || !isRoomId(roomId) || !isOpaqueId(memberId) || typeof repo.upsertPresence !== 'function') return null;
    try {
      return await repo.upsertPresence({ roomId, memberId, deviceSessionId: actorContext.deviceSessionId,
        lastSeenAt: now() });
    } catch (error) {
      // Presence 是可丢失的租约，失败不得破坏主业务协议。
      return null;
    }
  }

  function signalScopeFromSession(aggregate) {
    if (!aggregate || !aggregate.room || !aggregate.currentSession) return null;
    const session = aggregate.currentSession;
    const turn = session.modeState && session.modeState.partner && session.modeState.partner.activeTurn;
    if (session.mode !== 'PARTNER' || !turn || !turn.silentDeadlineAt) return null;
    return { sessionId: session.sessionId, turnId: turn.turnId,
      memberId: aggregate.room.hostMemberId, deadlineAt: turn.silentDeadlineAt };
  }

  function signalScope(aggregate) {
    return signalScopeFromSession(aggregate)
      || (aggregate && !aggregate.currentSession && aggregate.room && aggregate.room.signalScope)
      || null;
  }

  async function ephemeral(roomId, aggregate) {
    const [presenceResult, signalResult] = await Promise.allSettled([
      typeof repo.listPresence === 'function' ? repo.listPresence(roomId) : Promise.resolve([]),
      typeof repo.listSignals === 'function' ? repo.listSignals(roomId) : Promise.resolve([])
    ]);
    const rows = presenceResult.status === 'fulfilled' ? presenceResult.value : [];
    const signalRows = signalResult.status === 'fulfilled' ? signalResult.value : [];
    const cutoff = now() - (appOptions.presenceTtlMs || PRESENCE_TTL_MS);
    const currentMemberIds = new Set((aggregate && aggregate.room && aggregate.room.members || [])
      .map((member) => member.memberId));
    const byMemberId = {};
    (rows || []).filter((row) => Number(row.lastSeenAt) >= cutoff && currentMemberIds.has(row.memberId)).forEach((row) => {
      if (!byMemberId[row.memberId] || byMemberId[row.memberId].lastSeenAt < row.lastSeenAt) {
        byMemberId[row.memberId] = { online: true, lastSeenAt: row.lastSeenAt };
      }
    });
    const signals = {};
    const scope = signalScope(aggregate);
    const currentSessionId = aggregate && aggregate.currentSession && aggregate.currentSession.sessionId
      || aggregate && aggregate.room && aggregate.room.currentSessionId
      || null;
    (signalRows || []).filter((row) => {
      if (Number(row.expiresAt) <= now()) return false;
      if (row.signalType === SIGNAL_TYPES.PARTNER_SILENT_SOUND) {
        return !!(scope
          && row.sessionId === scope.sessionId
          && row.turnId === scope.turnId
          && row.memberId === scope.memberId
          && Number(scope.deadlineAt) > now());
      }
      if (row.signalType === SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE) {
        return !!(currentSessionId && row.sessionId === currentSessionId);
      }
      if (row.signalType === SIGNAL_TYPES.DESIGN_PROBLEM_EDITING) {
        // 高频 Sync 只读 Room + Signal，不为瞬时编辑态额外重建 Session。
        // raw signal 只做当前 Session 粗筛；workflow revision 由 Page Model 与 Member View 精确校验。
        return !!(currentSessionId
          && row.sessionId === currentSessionId
          && String(row.value || ''));
      }
      return false;
    }).forEach((row) => {
      if (!signals[row.signalType] || Number(signals[row.signalType].updatedAt) < Number(row.updatedAt)) {
        signals[row.signalType] = { value: clone(row.value), memberId: row.memberId,
          sessionId: row.sessionId, turnId: row.turnId, workflowRevision: row.workflowRevision,
          updatedAt: row.updatedAt, expiresAt: row.expiresAt };
      }
    });
    return { presenceByMemberId: byMemberId, signals,
      stale: { presence: presenceResult.status === 'rejected', signals: signalResult.status === 'rejected' } };
  }

  function mergeTouchedPresence(projectedEphemeral, touched) {
    if (!touched || !touched.memberId) return projectedEphemeral;
    return { ...projectedEphemeral,
      presenceByMemberId: { ...(projectedEphemeral.presenceByMemberId || {}),
        [touched.memberId]: { online: true, lastSeenAt: touched.lastSeenAt } } };
  }

  async function readCurrentRoom(actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    const found = await repo.findActiveRoom(actorUserId);
    if (!found || found.dangling) return okResult({ roomId: null, membershipId: null });
    await touchActivity(found.roomId, found.memberId, actorContext);
    return okResult({ roomId: found.roomId, membershipId: found.memberId });
  }

  async function projectSnapshot(roomId, actorContext, aggregate, touchedPromise) {
    const actorUserId = actorContext && actorContext.userId;
    const auth = authorizeRoomRead(aggregate, actorUserId);
    if (!auth.ok) return auth;
    const [rawEphemeral, touched] = await Promise.all([
      ephemeral(roomId, aggregate),
      touchedPromise || touchActivity(roomId, auth.member.memberId, actorContext)
    ]);
    const projectedEphemeral = mergeTouchedPresence(rawEphemeral, touched);
    return okResult({
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      seq: aggregate.room.eventSeq,
      stateVersion: aggregate.room.stateVersion,
      viewSchemaVersion: VIEW_SCHEMA_VERSION,
      view: projectMemberView(auth.aggregate, actorUserId),
      ephemeral: projectedEphemeral,
      serverTime: now(),
      minAvailableSeq: aggregate.minAvailableSeq == null ? 1 : aggregate.minAvailableSeq
    });
  }

  async function readSnapshot(roomId, actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    if (!isRoomId(roomId)) return fail(ERR.INVALID_ARGUMENT, 'roomId 必须是 8 位数字');
    const aggregate = await repo.readAggregate(roomId);
    return projectSnapshot(roomId, actorContext, aggregate);
  }

  async function writeSignal(input, actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    const roomId = String(input && input.roomId || '');
    const sessionId = String(input && input.sessionId || '');
    const turnId = String(input && input.turnId || '');
    const signalType = String(input && input.signalType || '');
    const workflowRevision = input && input.workflowRevision;
    const rawValue = input && input.value;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    const silentSound = signalType === SIGNAL_TYPES.PARTNER_SILENT_SOUND;
    const designNudge = signalType === SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE;
    const designEditing = signalType === SIGNAL_TYPES.DESIGN_PROBLEM_EDITING;
    if (silentSound) {
      if (!isRoomId(roomId) || !isOpaqueId(sessionId) || !isOpaqueId(turnId)
        || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        return fail(ERR.INVALID_ARGUMENT, '未知瞬时信号');
      }
    } else if (designNudge) {
      if (!isRoomId(roomId) || !isOpaqueId(sessionId)) {
        return fail(ERR.INVALID_ARGUMENT, '未知瞬时信号');
      }
    } else if (designEditing) {
      if (!isRoomId(roomId) || !isOpaqueId(sessionId)
        || !Number.isInteger(workflowRevision) || workflowRevision < 1) {
        return fail(ERR.INVALID_ARGUMENT, '未知瞬时信号');
      }
      if (rawValue != null && rawValue !== '' && typeof rawValue !== 'string') {
        return fail(ERR.INVALID_ARGUMENT, '未知瞬时信号');
      }
      if (rawValue && !isOpaqueId(String(rawValue).trim())) {
        return fail(ERR.INVALID_ARGUMENT, '未知瞬时信号');
      }
    } else {
      return fail(ERR.INVALID_ARGUMENT, '未知瞬时信号');
    }
    if (typeof repo.upsertSignal !== 'function') return fail(ERR.DEPENDENCY_UNAVAILABLE);
    const result = await repo.upsertSignal({
      roomId,
      actorUserId,
      sessionId,
      turnId: silentSound ? turnId : '',
      signalType,
      workflowRevision: designEditing ? workflowRevision : undefined,
      value: silentSound
        ? Math.min(1, Math.max(0, rawValue))
        : (designEditing ? String(rawValue || '').trim() : 1),
      now: now()
    });
    if (!result || result.ok !== true) {
      return fail(result && result.errCode || ERR.INVALID_TRANSITION,
        result && result.errMsg || (silentSound
          ? '当前不能发布静默声贝'
          : (designEditing ? '当前不能同步设计问题编辑态' : '当前不能催促提交设计问题')));
    }
    await touchActivity(roomId, result.signal.memberId, actorContext);
    return okResult({ signal: result.signal });
  }

  async function readSessionSnapshot(roomId, sessionId, actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    if (!isRoomId(roomId) || !isOpaqueId(sessionId)) {
      return fail(ERR.INVALID_ARGUMENT, 'roomId/sessionId 不合法');
    }
    if (typeof repo.readSessionAggregate !== 'function') return fail(ERR.DEPENDENCY_UNAVAILABLE);
    const aggregate = await repo.readSessionAggregate(roomId, sessionId);
    const auth = authorizeSessionRead(aggregate, actorUserId);
    if (!auth.ok) return auth;
    const liveMember = memberByUserId(aggregate.room, actorUserId);
    await touchActivity(roomId, liveMember && liveMember.memberId, actorContext);
    return okResult({
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      sessionId,
      seq: aggregate.room.eventSeq,
      stateVersion: aggregate.room.stateVersion,
      viewSchemaVersion: VIEW_SCHEMA_VERSION,
      view: projectMemberView(auth.aggregate, actorUserId),
      serverTime: now()
    });
  }

  async function readHistory(roomId, actorContext, requestOptions) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    if (!isRoomId(roomId)) return fail(ERR.INVALID_ARGUMENT, 'roomId 必须是 8 位数字');
    const aggregate = await repo.readAggregate(roomId);
    const auth = authorizeRoomRead(aggregate, actorUserId);
    if (!auth.ok) return auth;
    await touchActivity(roomId, auth.member.memberId, actorContext);
    if (typeof repo.listSessions !== 'function') return fail(ERR.DEPENDENCY_UNAVAILABLE);
    const limit = Math.min(50, Math.max(1, Number(requestOptions && requestOptions.limit) || 20));
    const rows = await repo.listSessions(roomId, {
      limit,
      beforeOrdinal: requestOptions && requestOptions.beforeOrdinal
    });
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const sessions = selected.map((session) => ({
      sessionId: session.sessionId,
      ordinal: session.ordinal,
      mode: session.mode,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      resultSummary: session.result ? {
        ideaCount: session.result.ideaCount,
        winnerSide: session.result.winnerSide,
        leaderboard: clone(session.result.leaderboard || [])
      } : null
    }));
    return okResult({ protocolVersion: PROTOCOL_VERSION, roomId, sessions, hasMore,
      nextBeforeOrdinal: hasMore && sessions.length ? sessions[sessions.length - 1].ordinal : null,
      serverTime: now() });
  }

  async function readLeaderboard(roomId, sessionId, actorContext) {
    const snapshot = await readSessionSnapshot(roomId, sessionId, actorContext);
    if (!snapshot.ok) return snapshot;
    const session = snapshot.view && snapshot.view.session;
    if (!session || session.status !== 'COMPLETED') return fail(ERR.INVALID_TRANSITION, '场次尚未完成');
    return okResult({ protocolVersion: PROTOCOL_VERSION, roomId, sessionId,
      leaderboard: clone(session.result && session.result.leaderboard || []),
      participants: clone(session.participants || []), serverTime: now() });
  }

  async function readMessages(roomId, sessionId, actorContext, requestOptions) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    if (!isRoomId(roomId) || !isOpaqueId(sessionId)) {
      return fail(ERR.INVALID_ARGUMENT, 'roomId/sessionId 不合法');
    }
    if (typeof repo.readSessionAggregate !== 'function' || typeof repo.listMessages !== 'function') {
      return fail(ERR.DEPENDENCY_UNAVAILABLE);
    }
    const aggregate = await repo.readSessionAggregate(roomId, sessionId);
    const auth = authorizeSessionRead(aggregate, actorUserId);
    if (!auth.ok) return auth;
    const liveMember = memberByUserId(aggregate.room, actorUserId);
    await touchActivity(roomId, liveMember && liveMember.memberId, actorContext);
    const limit = Math.min(100, Math.max(1, Number(requestOptions && requestOptions.limit) || 100));
    const rawBeforeSeq = requestOptions && requestOptions.beforeSeq;
    const beforeSeq = rawBeforeSeq == null || rawBeforeSeq === '' ? null : Number(rawBeforeSeq);
    if (beforeSeq != null && (!Number.isInteger(beforeSeq) || beforeSeq < 1)) {
      return fail(ERR.INVALID_ARGUMENT, 'beforeSeq 必须是正整数');
    }
    const rows = await repo.listMessages(roomId, sessionId, { limit, beforeSeq });
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit).map((item) => ({
      messageId: item.messageId,
      turnId: item.turnId,
      turnOrdinal: item.turnOrdinal,
      roundNo: item.roundNo,
      phase: item.phase,
      text: item.text,
      anonKey: item.anonKey,
      createdAt: item.createdAt,
      commitSeq: item.commitSeq
    }));
    return okResult({
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      sessionId,
      messages: selected,
      hasMore,
      nextBeforeSeq: hasMore && selected.length ? selected[selected.length - 1].commitSeq : null,
      serverTime: now()
    });
  }

  async function sync(roomId, afterSeq, actorContext, requestOptions) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    if (!isRoomId(roomId)) return fail(ERR.INVALID_ARGUMENT, 'roomId 必须是 8 位数字');
    const baseSeq = Number(afterSeq);
    if (!Number.isInteger(baseSeq) || baseSeq < 0) return fail(ERR.INVALID_ARGUMENT, 'afterSeq 必须是非负整数');
    const limit = Math.min(100, Math.max(1, Number(requestOptions && requestOptions.limit) || DEFAULT_SYNC_LIMIT));
    const bundle = await repo.readSyncState(roomId, baseSeq, limit);
    const room = bundle && (bundle.room || (bundle.aggregate && bundle.aggregate.room));
    const authAggregate = room ? { room, currentSession: null, facts: {} } : null;
    const auth = authorizeRoomRead(authAggregate, actorUserId);
    if (!auth.ok) return auth;
    const currentSeq = room.eventSeq;
    const base = { protocolVersion: PROTOCOL_VERSION, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: baseSeq, throughSeq: baseSeq, roomCurrentSeq: currentSeq, hasMore: false,
      delivery: 'EVENTS', events: [], ephemeral: {}, serverTime: now() };
    const activityPromise = touchActivity(roomId, auth.member.memberId, actorContext);
    const inlineSnapshot = async () => {
      const aggregate = await repo.readAggregate(roomId);
      const snapshot = await projectSnapshot(roomId, actorContext, aggregate, activityPromise);
      if (!snapshot.ok) return snapshot;
      return okResult({ protocolVersion: PROTOCOL_VERSION, viewSchemaVersion: VIEW_SCHEMA_VERSION,
        eventSchemaVersion: EVENT_SCHEMA_VERSION, delivery: 'SNAPSHOT', snapshot });
    };
    if (baseSeq > currentSeq || currentSeq - baseSeq > MAX_INCREMENTAL_SYNC_EVENTS) {
      return inlineSnapshot();
    }
    const available = (bundle.events || []).filter((item) => item.seq > baseSeq && item.seq <= currentSeq)
      .sort((a, b) => a.seq - b.seq);
    if (currentSeq > baseSeq && (!available.length || available[0].seq !== baseSeq + 1)) {
      return inlineSnapshot();
    }
    for (let i = 1; i < available.length; i += 1) {
      if (available[i].seq !== available[i - 1].seq + 1) {
        return inlineSnapshot();
      }
    }
    const candidates = available.slice(0, limit);
    if (candidates.some((eventGroup) => eventGroup.roomId !== roomId || !validEventGroup(eventGroup))) {
      return inlineSnapshot();
    }
    const selected = [];
    let eventBytes = 0;
    // 为响应骨架与最终批次的 Presence/Signal 留出固定余量。
    const eventByteBudget = MAX_SYNC_RESPONSE_BYTES - (16 * 1024);
    for (const eventGroup of candidates) {
      const projected = projectEventGroupForMember(eventGroup, auth.member.memberId);
      const projectedBytes = Buffer.byteLength(stableStringify(projected), 'utf8');
      if (eventBytes + projectedBytes > eventByteBudget) break;
      selected.push(projected);
      eventBytes += projectedBytes;
    }
    if (candidates.length && !selected.length) {
      return inlineSnapshot();
    }
    const throughSeq = selected.length ? selected[selected.length - 1].seq : baseSeq;
    const hasMore = throughSeq < currentSeq;
    let projectedEphemeral = {};
    if (!hasMore) {
      const [rawEphemeral, touched] = await Promise.all([
        ephemeral(roomId, authAggregate),
        activityPromise
      ]);
      projectedEphemeral = mergeTouchedPresence(rawEphemeral, touched);
    } else {
      await activityPromise;
    }
    return okResult({ ...base, throughSeq, hasMore, events: selected,
      ephemeral: projectedEphemeral, serverTime: now() });
  }

  async function executeCommand(rawEnvelope, actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    const validated = validateCommandEnvelope(rawEnvelope);
    if (!validated.ok) return validated;
    const envelope = validated.envelope;
    if (!isNonEmptyString(appOptions.serverSecret)) {
      return fail(ERR.INTERNAL_ERROR, 'ROOM_PROTOCOL_SERVER_SECRET 未配置');
    }
    const commandNow = now();
    const isCreate = envelope.type === COMMAND_TYPES.CREATE_ROOM;
    const roomIdCandidates = isCreate
      ? Array.from({ length: 5 }, (_, attempt) => String(typeof repo.generateRoomId === 'function'
        ? repo.generateRoomId(envelope.commandId, actorUserId, attempt)
        : (10000000 + Math.floor(Math.random() * 90000000))))
      : [];
    const commandRoomId = isCreate ? roomIdCandidates[0] : envelope.roomId;
    const scopeKey = isCreate ? `actor:${hash(actorUserId)}` : commandRoomId;
    const transaction = await repo.transactCommand({
      scopeKey, commandId: envelope.commandId, actorUserId, roomId: commandRoomId, type: envelope.type,
      roomIdCandidates, requestHash: requestHash(envelope), createdAt: commandNow
    }, ({ aggregate: current, activeRoomId, resolvedRoomId }) => {
      if (isCreate && activeRoomId) return { accepted: false, error: fail(ERR.ALREADY_IN_ROOM) };
      if (isCreate && !resolvedRoomId) {
        return { accepted: false, error: fail(ERR.DEPENDENCY_UNAVAILABLE, '暂时无法分配房间号') };
      }
      if (envelope.type === COMMAND_TYPES.JOIN_ROOM && activeRoomId && activeRoomId !== commandRoomId) {
        return { accepted: false, error: fail(ERR.ALREADY_IN_ROOM) };
      }
      const effectiveRoomId = resolvedRoomId || commandRoomId;
      const seed = deriveCommandSeed(
        appOptions.serverSecret,
        effectiveRoomId,
        envelope.commandId,
        'domain'
      );
      const beforePublic = projectPublicView(current);
      const domain = reduceCommand({ aggregate: current, command: { ...envelope, roomId: effectiveRoomId }, actorUserId,
        deps: { now: commandNow, idFactory: deterministicIds(seed), random: deterministicRandom(seed),
          wordPairPicker: appOptions.wordPairPicker, roomIdFactory: () => effectiveRoomId } });
      if (!domain.ok) return { accepted: false, error: domain };
      const next = domain.aggregate;
      const storageError = validateSessionDocumentSize(next);
      if (storageError) return { accepted: false, error: storageError };
      // SignalScope 是 Room 上的轻量派生投影，与 Session 在同一事务中更新。
      next.room.signalScope = signalScopeFromSession(next);
      const afterPublic = projectPublicView(next);
      const eventGroup = buildEventGroup(envelope, domain.events, next.room, current, next,
        beforePublic, afterPublic, commandNow);
      next.room.stateVersion += 1;
      next.room.eventSeq = eventGroup.seq;
      next.room.updatedAt = commandNow;
      markCommittedFacts(next, domain.dirtyFacts, next.room.eventSeq);
      const archivedSession = next.archivedSession || null;
      const archivedFacts = next.archivedFacts || null;
      delete next.archivedSession;
      delete next.archivedFacts;
      return { accepted: true, aggregate: next, events: [eventGroup], dirtyFacts: domain.dirtyFacts || [],
        archivedSession,
        archivedFacts,
        outcome: { ...(domain.outcome || { kind: 'ACCEPTED' }), roomId: next.room.roomId,
          committedThroughSeq: next.room.eventSeq } };
    });

    if (transaction.conflict) return fail(ERR.COMMAND_ID_CONFLICT, undefined, { commandId: envelope.commandId });
    const receipt = transaction.receipt;
    await touchActivity(receipt.activityRoomId, receipt.memberId, actorContext);
    if (!receipt.accepted) {
      const rejected = { ...receipt.error, commandId: envelope.commandId };
      if (!isCreate && envelope.type !== COMMAND_TYPES.LEAVE_ROOM && envelope.type !== COMMAND_TYPES.DISSOLVE_ROOM) {
        const catchup = await sync(commandRoomId, envelope.knownSeq,
          { ...actorContext, touchPresence: false }).catch(() => null);
        if (catchup && catchup.ok) rejected.sync = catchup;
      }
      return rejected;
    }
    const outcome = receipt.outcome;
    const response = okResult({ commandId: envelope.commandId, outcome,
      traceId: `trace_${hash(`${envelope.commandId}:${commandNow}`).slice(0, 16)}` });
    if (![COMMAND_TYPES.CREATE_ROOM, COMMAND_TYPES.JOIN_ROOM,
      COMMAND_TYPES.LEAVE_ROOM, COMMAND_TYPES.DISSOLVE_ROOM].includes(envelope.type)) {
      try {
        response.sync = await sync(outcome.roomId, envelope.knownSeq,
          { ...actorContext, touchPresence: false });
      } catch (syncError) {
        // Command 已原子提交；附带同步失败不能把成功伪装成写失败，客户端按下一轮正常同步恢复。
      }
    }
    return response;
  }

  return { executeCommand, readCurrentRoom, readSnapshot, readSessionSnapshot,
    readHistory, readLeaderboard, readMessages, sync, writeSignal };
}

module.exports = { createRoomApplication, hash, deriveCommandSeed,
  deterministicRandom, deterministicIds, markCommittedFacts, validEventGroup };
