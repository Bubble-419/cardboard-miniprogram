'use strict';

const crypto = require('crypto');
const {
  PROTOCOL_VERSION, VIEW_SCHEMA_VERSION, EVENT_SCHEMA_VERSION, COMMAND_TYPES, EVENT_TYPES, ERR,
  fail, okResult, validateCommandEnvelope, stableStringify, isNonEmptyString
} = require('@cardboard/room-contracts');
const { reduceCommand, authorizeRoomRead, authorizeSessionRead, memberByUserId } = require('@cardboard/room-domain');
const {
  clone, projectPublicView, projectMemberView, createPublicPatch, projectActorPatches
} = require('@cardboard/room-projection');

const DEFAULT_SYNC_LIMIT = 100;
const MAX_SYNC_BACKLOG = 300;
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

function validPatch(patch) {
  const validPath = (path) => typeof path === 'string' && path.length > 0 && path.length <= 512
    && (path === '$' || path.split('.').every((part) => part
      && !['__proto__', 'prototype', 'constructor'].includes(part)));
  return !!patch && Array.isArray(patch.set) && patch.set.length <= 512
    && Array.isArray(patch.remove) && patch.remove.length <= 512
    && patch.set.every((item) => item && typeof item === 'object'
      && Object.keys(item).every((key) => key === 'path' || key === 'value') && validPath(item.path)
      && Object.prototype.hasOwnProperty.call(item, 'value'))
    && patch.remove.every(validPath);
}

function validEventGroup(eventGroup) {
  const projections = eventGroup && eventGroup.actorProjections;
  const recipients = Array.isArray(projections)
    ? projections.map((item) => item && item.recipientMemberId)
    : [];
  return !!eventGroup
    && eventGroup.eventSchemaVersion === EVENT_SCHEMA_VERSION
    && Number.isInteger(eventGroup.seq)
    && Number.isInteger(eventGroup.stateVersion)
    && isNonEmptyString(eventGroup.commandId)
    && Array.isArray(eventGroup.publicEvents)
    && eventGroup.publicEvents.length > 0
    && eventGroup.publicEvents.length <= 32
    && eventGroup.publicEvents.every((item) => item && Object.keys(item).length === 1
      && KNOWN_EVENT_TYPES.has(item.type))
    && validPatch(eventGroup.publicPatch)
    && Array.isArray(projections)
    && projections.length <= 6
    && projections.every((item) => item && isOpaqueId(item.recipientMemberId) && validPatch(item.actorPatch))
    && new Set(recipients).size === recipients.length;
}

function projectEventGroupForMember(eventGroup, memberId) {
  const actorProjection = (eventGroup.actorProjections || [])
    .find((item) => item && item.recipientMemberId === memberId);
  // 显式白名单构造传输事件，绝不把 rawEvents 或其他成员投影返回客户端。
  return {
    eventSchemaVersion: eventGroup.eventSchemaVersion,
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

  async function ephemeral(roomId, aggregate) {
    const [rows, signalRows] = await Promise.all([
      typeof repo.listPresence === 'function' ? repo.listPresence(roomId).catch(() => []) : [],
      typeof repo.listSignals === 'function' ? repo.listSignals(roomId).catch(() => []) : []
    ]);
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
    const activeTurn = aggregate && aggregate.currentSession
      && aggregate.currentSession.modeState && aggregate.currentSession.modeState.partner
      && aggregate.currentSession.modeState.partner.activeTurn;
    (signalRows || []).filter((row) => {
      if (Number(row.expiresAt) <= now()) return false;
      if (row.signalType !== 'PARTNER_SILENT_SOUND') return true;
      if (!aggregate || !aggregate.room || row.sessionId !== aggregate.room.currentSessionId) return false;
      // 增量查询只加载轻量 Room；Snapshot 有完整 Session 时再校验 Turn。
      if (!aggregate.currentSession) return true;
      return !!(activeTurn
        && row.sessionId === aggregate.currentSession.sessionId
        && row.turnId === activeTurn.turnId
        && row.memberId === activeTurn.activeMemberId
        && Number(activeTurn.silentDeadlineAt) > now());
    }).forEach((row) => {
      if (!signals[row.signalType] || Number(signals[row.signalType].updatedAt) < Number(row.updatedAt)) {
        signals[row.signalType] = { value: clone(row.value), memberId: row.memberId,
          updatedAt: row.updatedAt, expiresAt: row.expiresAt };
      }
    });
    return { presenceByMemberId: byMemberId, signals };
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

  async function readSnapshot(roomId, actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    if (!isRoomId(roomId)) return fail(ERR.INVALID_ARGUMENT, 'roomId 必须是 8 位数字');
    const aggregate = await repo.readAggregate(roomId);
    const auth = authorizeRoomRead(aggregate, actorUserId);
    if (!auth.ok) return auth;
    const [rawEphemeral, touched] = await Promise.all([
      ephemeral(roomId, aggregate),
      touchActivity(roomId, auth.member.memberId, actorContext)
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
    await touchActivity(roomId, auth.member.memberId, actorContext);
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
    await touchActivity(roomId, auth.member.memberId, actorContext);
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
    const bundle = await repo.readSyncState(roomId, baseSeq, MAX_SYNC_BACKLOG + 1);
    const room = bundle && (bundle.room || (bundle.aggregate && bundle.aggregate.room));
    const authAggregate = room ? { room, currentSession: null, facts: {} } : null;
    const auth = authorizeRoomRead(authAggregate, actorUserId);
    if (!auth.ok) return auth;
    const currentSeq = room.eventSeq;
    const base = { protocolVersion: PROTOCOL_VERSION, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: baseSeq, throughSeq: baseSeq, roomCurrentSeq: currentSeq, hasMore: false,
      snapshotRequired: false, events: [], ephemeral: {}, serverTime: now() };
    const activityPromise = touchActivity(roomId, auth.member.memberId, actorContext);
    if (baseSeq > currentSeq || currentSeq - baseSeq > MAX_SYNC_BACKLOG) {
      await activityPromise;
      return okResult({ ...base, snapshotRequired: true });
    }
    const available = (bundle.events || []).filter((item) => item.seq > baseSeq && item.seq <= currentSeq)
      .sort((a, b) => a.seq - b.seq);
    if (currentSeq > baseSeq && (!available.length || available[0].seq !== baseSeq + 1)) {
      await activityPromise;
      return okResult({ ...base, snapshotRequired: true });
    }
    for (let i = 1; i < available.length; i += 1) {
      if (available[i].seq !== available[i - 1].seq + 1) {
        await activityPromise;
        return okResult({ ...base, snapshotRequired: true });
      }
    }
    const selected = available.slice(0, limit);
    if (selected.some((eventGroup) => eventGroup.roomId !== roomId || !validEventGroup(eventGroup))) {
      await activityPromise;
      return okResult({ ...base, snapshotRequired: true });
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
    const events = selected.map((eventGroup) => projectEventGroupForMember(eventGroup, auth.member.memberId));
    return okResult({ ...base, throughSeq, hasMore, events,
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
    if ([COMMAND_TYPES.CREATE_ROOM, COMMAND_TYPES.JOIN_ROOM].includes(envelope.type)) {
      response.sync = { snapshotRequired: true, roomId: outcome.roomId };
    } else if (![COMMAND_TYPES.LEAVE_ROOM, COMMAND_TYPES.DISSOLVE_ROOM].includes(envelope.type)) {
      response.sync = await sync(outcome.roomId, envelope.knownSeq, { ...actorContext, touchPresence: false });
    }
    return response;
  }

  return { executeCommand, readCurrentRoom, readSnapshot, readSessionSnapshot,
    readHistory, readLeaderboard, readMessages, sync };
}

function createInMemoryRoomRepository(options) {
  const rooms = new Map();
  const actions = new Map();
  const events = new Map();
  const activeRooms = new Map();
  const presence = new Map();
  const signals = new Map();
  const sessions = new Map();
  const sessionRooms = new Map();
  let seq = 10000000;
  const copy = (value) => clone(value);
  const receiptKey = (scopeKey, commandId) => `${scopeKey}:${commandId}`;
  const usersOf = (aggregate) => {
    if (!aggregate || aggregate.room.lifecycle !== 'OPEN') return [];
    return (aggregate.room.members || []).map((member) => ({ userId: member.userId,
      roomId: aggregate.room.roomId, memberId: member.memberId }));
  };

  return {
    rooms, actions, events, activeRooms, presence, signals, sessions,
    generateRoomId(commandId, actorUserId, attempt) {
      if (options && typeof options.generateRoomId === 'function') return options.generateRoomId(commandId, actorUserId, attempt || 0);
      seq += 1;
      return String(seq);
    },
    async transactCommand(input, handler) {
      const key = receiptKey(input.scopeKey, input.commandId);
      const existing = actions.get(key);
      if (existing) {
        const conflict = existing.actorUserId !== input.actorUserId || existing.requestHash !== input.requestHash || existing.type !== input.type;
        return conflict ? { conflict: true } : { replayed: true, receipt: copy(existing) };
      }
      let resolvedRoomId = input.roomId;
      if (input.type === COMMAND_TYPES.CREATE_ROOM) {
        resolvedRoomId = (input.roomIdCandidates || [input.roomId]).find((candidate) => !rooms.has(candidate)) || null;
      }
      let activeRoomId = activeRooms.get(input.actorUserId) || null;
      if (activeRoomId) {
        const activeAggregate = rooms.get(activeRoomId);
        const activeMember = activeAggregate && activeAggregate.room.lifecycle === 'OPEN'
          && memberByUserId(activeAggregate.room, input.actorUserId);
        if (!activeMember) {
          // 命令事务可修复悬挂唯一索引，避免用户永久无法创建或加入房间。
          activeRooms.delete(input.actorUserId);
          activeRoomId = null;
        }
      }
      const current = resolvedRoomId && rooms.has(resolvedRoomId) ? copy(rooms.get(resolvedRoomId)) : null;
      const decision = handler({ aggregate: current, activeRoomId, resolvedRoomId });
      const activityAggregate = [decision.accepted && decision.aggregate, current,
        activeRoomId && rooms.get(activeRoomId)].find((candidate) => candidate && candidate.room
          && memberByUserId(candidate.room, input.actorUserId)) || null;
      const activityMember = activityAggregate && activityAggregate.room
        && memberByUserId(activityAggregate.room, input.actorUserId);
      const receipt = { scopeKey: input.scopeKey, commandId: input.commandId, actorUserId: input.actorUserId,
        roomId: resolvedRoomId, type: input.type, requestHash: input.requestHash, accepted: decision.accepted === true,
        outcome: copy(decision.outcome || null), error: copy(decision.error || null),
        activityRoomId: activityAggregate && activityAggregate.room && activityAggregate.room.roomId || null,
        memberId: activityMember && activityMember.memberId || null,
        committedThroughSeq: decision.outcome && decision.outcome.committedThroughSeq || null,
        createdAt: input.createdAt };
      if (decision.accepted) {
        const beforeUsers = usersOf(current);
        const afterUsers = usersOf(decision.aggregate);
        rooms.set(resolvedRoomId, copy(decision.aggregate));
        if (decision.aggregate.currentSession) {
          sessions.set(decision.aggregate.currentSession.sessionId, copy({
            ...decision.aggregate.currentSession,
            facts: decision.aggregate.facts
          }));
          sessionRooms.set(decision.aggregate.currentSession.sessionId, resolvedRoomId);
        }
        if (decision.archivedSession) {
          sessions.set(decision.archivedSession.sessionId, copy({
            ...decision.archivedSession,
            facts: decision.archivedFacts || {}
          }));
          sessionRooms.set(decision.archivedSession.sessionId, resolvedRoomId);
        }
        (decision.events || []).forEach((item) => {
          if (!events.has(resolvedRoomId)) events.set(resolvedRoomId, []);
          events.get(resolvedRoomId).push(copy(item));
        });
        const afterIds = new Set(afterUsers.map((item) => item.userId));
        beforeUsers.filter((item) => !afterIds.has(item.userId)).forEach((item) => activeRooms.delete(item.userId));
        afterUsers.forEach((item) => activeRooms.set(item.userId, item.roomId));
      }
      actions.set(key, copy(receipt));
      return { replayed: false, receipt: copy(receipt) };
    },
    async findActiveRoom(userId) {
      const roomId = activeRooms.get(userId);
      if (!roomId) return null;
      const aggregate = rooms.get(roomId);
      const member = aggregate && aggregate.room.lifecycle === 'OPEN' && memberByUserId(aggregate.room, userId);
      if (!member) {
        activeRooms.delete(userId);
        return null;
      }
      return { roomId, memberId: member.memberId };
    },
    async readAggregate(roomId) {
      if (!rooms.has(roomId)) return null;
      const aggregate = copy(rooms.get(roomId));
      const firstEvent = (events.get(roomId) || [])[0];
      aggregate.minAvailableSeq = firstEvent ? firstEvent.seq : aggregate.room.eventSeq + 1;
      return aggregate;
    },
    async readSessionAggregate(roomId, sessionId) {
      const stored = rooms.get(roomId);
      const sessionDocument = sessions.get(sessionId)
        || (stored && stored.currentSession && stored.currentSession.sessionId === sessionId
          && { ...stored.currentSession, facts: stored.facts });
      const session = sessionDocument && copy(sessionDocument);
      if (!stored || !session || (sessionRooms.has(sessionId) && sessionRooms.get(sessionId) !== roomId)) return null;
      const facts = copy(session.facts || {});
      delete session.facts;
      return copy({ room: stored.room, currentSession: session, facts });
    },
    async listSessions(roomId, requestOptions) {
      const before = Number(requestOptions && requestOptions.beforeOrdinal);
      const limit = Number(requestOptions && requestOptions.limit) || 20;
      return copy([...sessions.values()].filter((session) => sessionRooms.get(session.sessionId) === roomId
        && ['COMPLETED', 'CANCELLED'].includes(session.status)
        && (!Number.isInteger(before) || session.ordinal < before))
        .sort((a, b) => b.ordinal - a.ordinal).slice(0, limit + 1));
    },
    async listMessages(roomId, sessionId, requestOptions) {
      const rawBeforeSeq = requestOptions && requestOptions.beforeSeq;
      const beforeSeq = rawBeforeSeq == null || rawBeforeSeq === '' ? null : Number(rawBeforeSeq);
      const limit = Number(requestOptions && requestOptions.limit) || 100;
      const sessionDocument = sessions.get(sessionId);
      return copy(((sessionDocument && sessionDocument.facts && sessionDocument.facts.messages) || [])
        .filter((item) => item.sessionId === sessionId
          && (beforeSeq == null || item.commitSeq < beforeSeq))
        .sort((a, b) => b.commitSeq - a.commitSeq)
        .slice(0, limit + 1));
    },
    async readSyncState(roomId, afterSeq, limit) {
      const aggregate = rooms.has(roomId) ? copy(rooms.get(roomId)) : null;
      const roomEvents = events.get(roomId) || [];
      if (aggregate) aggregate.minAvailableSeq = roomEvents.length
        ? roomEvents[0].seq : aggregate.room.eventSeq + 1;
      return { aggregate,
        events: copy(roomEvents.filter((item) => item.seq > afterSeq).slice(0, limit)) };
    },
    async upsertPresence({ roomId, memberId, deviceSessionId, lastSeenAt }) {
      const row = { roomId, memberId, deviceSessionId: deviceSessionId || 'default', lastSeenAt, online: true };
      presence.set(`${roomId}:${memberId}:${row.deviceSessionId}`, row);
      return copy(row);
    },
    async listPresence(roomId) { return copy([...presence.values()].filter((item) => item.roomId === roomId)); },
    async listSignals(roomId) { return copy([...signals.values()].filter((item) => item.roomId === roomId)); }
  };
}

module.exports = { createRoomApplication, createInMemoryRoomRepository, hash, deriveCommandSeed,
  deterministicRandom, deterministicIds, markCommittedFacts, validEventGroup };
