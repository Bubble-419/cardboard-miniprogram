'use strict';

const crypto = require('crypto');
const {
  PROTOCOL_VERSION, VIEW_SCHEMA_VERSION, EVENT_SCHEMA_VERSION, COMMAND_TYPES, ERR,
  fail, okResult, validateCommandEnvelope, stableStringify, isNonEmptyString
} = require('@cardboard/room-contracts');
const { reduceCommand, authorizeRoomRead, authorizeSessionRead, memberByUserId } = require('@cardboard/room-domain');
const {
  clone, projectPublicView, projectActorView, projectMemberView, projectRoute, createPublicPatch
} = require('@cardboard/room-projection');

const DEFAULT_SYNC_LIMIT = 100;
const MAX_SYNC_BACKLOG = 300;

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

function buildEvents(envelope, domainEvents, room, beforePublic, afterPublic, occurredAt) {
  const events = domainEvents && domainEvents.length ? domainEvents : [];
  if (!events.length) throw new Error('accepted command must produce at least one event');
  const firstSeq = room.eventSeq + 1;
  const stateVersion = room.stateVersion + 1;
  const patch = createPublicPatch(beforePublic, afterPublic);
  return events.map((item, index) => ({
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    roomId: room.roomId,
    seq: firstSeq + index,
    stateVersion,
    commandId: envelope.commandId,
    commandEventIndex: index + 1,
    commandEventCount: events.length,
    sessionId: envelope.context.sessionId || (afterPublic && afterPublic.session ? afterPublic.session.sessionId : null),
    type: item.type,
    payload: index === events.length - 1 ? { ...(clone(item.payload) || {}), publicPatch: patch } : clone(item.payload || {}),
    occurredAt
  }));
}

function eventGroups(events) {
  const groups = [];
  (events || []).forEach((item) => {
    const last = groups[groups.length - 1];
    if (!last || last[0].commandId !== item.commandId) groups.push([item]);
    else last.push(item);
  });
  return groups;
}

function validEventGroup(group) {
  if (!group.length) return false;
  const count = group[0].commandEventCount;
  return group.length === count && group.every((item, index) =>
    item.eventSchemaVersion === EVENT_SCHEMA_VERSION
      && item.commandEventCount === count
      && item.commandEventIndex === index + 1);
}

/** 应用层只编排事务、投影与同步；所有业务裁决留在领域 Reducer。 */
function createRoomApplication(repo, options) {
  if (!repo || typeof repo.transactCommand !== 'function') throw new Error('RoomRepository required');
  const appOptions = options || {};
  const now = () => Number(typeof appOptions.now === 'function' ? appOptions.now() : (appOptions.now || Date.now()));

  async function ephemeral(roomId, aggregate) {
    let rows = [];
    let signalRows = [];
    try {
      rows = typeof repo.listPresence === 'function' ? await repo.listPresence(roomId) : [];
    } catch (e) {
      rows = [];
    }
    const cutoff = now() - (appOptions.presenceTtlMs || 15000);
    const currentMemberIds = new Set((aggregate && aggregate.room && aggregate.room.members || [])
      .map((member) => member.memberId));
    const byMemberId = {};
    (rows || []).filter((row) => Number(row.lastSeenAt) >= cutoff && currentMemberIds.has(row.memberId)).forEach((row) => {
      if (!byMemberId[row.memberId] || byMemberId[row.memberId].lastSeenAt < row.lastSeenAt) {
        byMemberId[row.memberId] = { online: true, lastSeenAt: row.lastSeenAt };
      }
    });
    try {
      signalRows = typeof repo.listSignals === 'function' ? await repo.listSignals(roomId) : [];
    } catch (e) {
      signalRows = [];
    }
    const signals = {};
    const activeTurn = aggregate && aggregate.currentSession
      && aggregate.currentSession.modeState && aggregate.currentSession.modeState.partner
      && aggregate.currentSession.modeState.partner.activeTurn;
    (signalRows || []).filter((row) => {
      if (Number(row.expiresAt) <= now()) return false;
      if (row.signalType !== 'PARTNER_SILENT_SOUND') return true;
      return !!(aggregate && aggregate.currentSession && activeTurn
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

  async function readCurrentRoom(actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    const found = await repo.findActiveRoom(actorUserId);
    if (!found) return okResult({ roomId: null, membershipId: null });
    if (found.dangling) return fail(ERR.INTERNAL_ERROR, '当前房间索引不一致', { recoverable: true });
    return okResult({ roomId: found.roomId, membershipId: found.memberId });
  }

  async function readSnapshot(roomId, actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    if (!isRoomId(roomId)) return fail(ERR.INVALID_ARGUMENT, 'roomId 必须是 8 位数字');
    const aggregate = await repo.readAggregate(roomId);
    const auth = authorizeRoomRead(aggregate, actorUserId);
    if (!auth.ok) return auth;
    return okResult({
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      seq: aggregate.room.eventSeq,
      stateVersion: aggregate.room.stateVersion,
      viewSchemaVersion: VIEW_SCHEMA_VERSION,
      view: projectMemberView(auth.aggregate, actorUserId),
      ephemeral: await ephemeral(roomId, aggregate),
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
    const aggregate = bundle && bundle.aggregate;
    const auth = authorizeRoomRead(aggregate, actorUserId);
    if (!auth.ok) return auth;
    const currentSeq = aggregate.room.eventSeq;
    const minAvailableSeq = aggregate.minAvailableSeq == null ? 1 : aggregate.minAvailableSeq;
    const base = { protocolVersion: PROTOCOL_VERSION, viewSchemaVersion: VIEW_SCHEMA_VERSION,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      afterSeq: baseSeq, throughSeq: baseSeq, roomCurrentSeq: currentSeq, hasMore: false,
      snapshotRequired: false, events: [], actorView: null, ephemeral: {}, serverTime: now() };
    if (baseSeq > currentSeq || baseSeq < minAvailableSeq - 1 || currentSeq - baseSeq > MAX_SYNC_BACKLOG) {
      return okResult({ ...base, snapshotRequired: true });
    }
    const available = (bundle.events || []).filter((item) => item.seq > baseSeq && item.seq <= currentSeq)
      .sort((a, b) => a.seq - b.seq);
    if (currentSeq > baseSeq && (!available.length || available[0].seq !== baseSeq + 1)) {
      return okResult({ ...base, snapshotRequired: true });
    }
    for (let i = 1; i < available.length; i += 1) {
      if (available[i].seq !== available[i - 1].seq + 1) return okResult({ ...base, snapshotRequired: true });
    }
    const selected = [];
    for (const group of eventGroups(available)) {
      if (!validEventGroup(group)) return okResult({ ...base, snapshotRequired: true });
      if (selected.length && selected.length + group.length > limit) break;
      selected.push(...group);
      if (selected.length >= limit) break;
    }
    const throughSeq = selected.length ? selected[selected.length - 1].seq : baseSeq;
    const hasMore = throughSeq < currentSeq;
    let actorView = null;
    let projectedEphemeral = {};
    if (!hasMore) {
      const actor = projectActorView(aggregate, actorUserId);
      actorView = { actor, route: projectRoute(aggregate, actor) };
      projectedEphemeral = await ephemeral(roomId, aggregate);
    }
    return okResult({ ...base, throughSeq, hasMore, events: clone(selected), actorView,
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
      const events = buildEvents(envelope, domain.events, next.room, beforePublic, afterPublic, commandNow);
      next.room.stateVersion += 1;
      next.room.eventSeq = events[events.length - 1].seq;
      next.room.updatedAt = commandNow;
      markCommittedFacts(next, domain.dirtyFacts, next.room.eventSeq);
      return { accepted: true, aggregate: next, events, dirtyFacts: domain.dirtyFacts || [],
        archivedSession: next.archivedSession || null,
        outcome: { ...(domain.outcome || { kind: 'ACCEPTED' }), roomId: next.room.roomId,
          committedThroughSeq: next.room.eventSeq } };
    });

    if (transaction.conflict) return fail(ERR.COMMAND_ID_CONFLICT, undefined, { commandId: envelope.commandId });
    const receipt = transaction.receipt;
    if (!receipt.accepted) {
      const rejected = { ...receipt.error, commandId: envelope.commandId };
      if (!isCreate && envelope.type !== COMMAND_TYPES.LEAVE_ROOM && envelope.type !== COMMAND_TYPES.DISSOLVE_ROOM) {
        const catchup = await sync(commandRoomId, envelope.knownSeq, actorContext).catch(() => null);
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
      response.sync = await sync(outcome.roomId, envelope.knownSeq, actorContext);
    }
    return response;
  }

  async function heartbeat(roomId, actorContext, payload) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(actorUserId)) return fail(ERR.UNAUTHENTICATED);
    if (!isRoomId(roomId)) return fail(ERR.INVALID_ARGUMENT, 'roomId 必须是 8 位数字');
    const deviceSessionId = payload && payload.deviceSessionId;
    if (deviceSessionId != null && !isOpaqueId(deviceSessionId)) {
      return fail(ERR.INVALID_ARGUMENT, 'deviceSessionId 必须是 1～128 字符');
    }
    const aggregate = await repo.readAggregate(roomId);
    const auth = authorizeRoomRead(aggregate, actorUserId);
    if (!auth.ok) return auth;
    if (typeof repo.upsertPresence !== 'function') return fail(ERR.DEPENDENCY_UNAVAILABLE, 'presence store unavailable');
    const row = await repo.upsertPresence({ roomId, memberId: auth.member.memberId,
      deviceSessionId, lastSeenAt: now() });
    return okResult({ presence: row, seq: aggregate.room.eventSeq });
  }

  return { executeCommand, readCurrentRoom, readSnapshot, readSessionSnapshot,
    readHistory, readLeaderboard, readMessages, sync, heartbeat };
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
      const receipt = { scopeKey: input.scopeKey, commandId: input.commandId, actorUserId: input.actorUserId,
        roomId: resolvedRoomId, type: input.type, requestHash: input.requestHash, accepted: decision.accepted === true,
        outcome: copy(decision.outcome || null), error: copy(decision.error || null),
        committedThroughSeq: decision.outcome && decision.outcome.committedThroughSeq, createdAt: input.createdAt };
      if (decision.accepted) {
        const beforeUsers = usersOf(current);
        const afterUsers = usersOf(decision.aggregate);
        rooms.set(resolvedRoomId, copy(decision.aggregate));
        if (decision.aggregate.currentSession) {
          sessions.set(decision.aggregate.currentSession.sessionId, copy(decision.aggregate.currentSession));
          sessionRooms.set(decision.aggregate.currentSession.sessionId, resolvedRoomId);
        }
        if (decision.archivedSession) {
          sessions.set(decision.archivedSession.sessionId, copy(decision.archivedSession));
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
      const member = aggregate && memberByUserId(aggregate.room, userId);
      if (!aggregate || aggregate.room.lifecycle !== 'OPEN' || !member) return { dangling: true, roomId };
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
      const session = sessions.get(sessionId)
        || (stored && stored.currentSession && stored.currentSession.sessionId === sessionId && stored.currentSession);
      if (!stored || !session || (sessionRooms.has(sessionId) && sessionRooms.get(sessionId) !== roomId)) return null;
      const facts = {};
      Object.entries(stored.facts || {}).forEach(([kind, bucket]) => {
        if (kind === 'messages') {
          facts[kind] = (bucket || []).filter((row) => row.sessionId === sessionId);
          return;
        }
        facts[kind] = Object.fromEntries(Object.entries(bucket || {})
          .filter(([, row]) => row.sessionId === sessionId));
      });
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
      return copy((rooms.get(roomId) && rooms.get(roomId).facts.messages || [])
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
