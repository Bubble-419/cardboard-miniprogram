'use strict';

const { PROTOCOL_VERSION, SCHEMA_VERSION, COMMAND_TYPES, SIGNAL_TYPES, SIGNAL_TTL_MS,
  DESIGN_PROBLEM_NUDGE_COOLDOWN_MS } = require('@cardboard/room-contracts');
const { memberByUserId, designProblemNudgeDeniedReason } = require('@cardboard/room-domain');
const { clone } = require('@cardboard/room-projection');

/** 仅供单元测试使用；生产云函数不应打包内存仓储。 */
function createInMemoryRoomRepository(options) {
  const rooms = new Map();
  const actions = new Map();
  const events = new Map();
  const activeRooms = new Map();
  const presence = new Map();
  const signals = new Map();
  const signalCooldowns = new Map();
  const sessions = new Map();
  const sessionRooms = new Map();
  let seq = 10000000;
  const copy = (value) => clone(value);
  const receiptKey = (scopeKey, commandId) => `${scopeKey}:${commandId}`;
  const compatibleRoom = (room) => !!room
    && room.protocolVersion === PROTOCOL_VERSION
    && room.schemaVersion === SCHEMA_VERSION;
  const usersOf = (aggregate) => {
    if (!aggregate || !compatibleRoom(aggregate.room) || aggregate.room.lifecycle !== 'OPEN') return [];
    return (aggregate.room.members || []).map((member) => ({ userId: member.userId,
      roomId: aggregate.room.roomId, memberId: member.memberId }));
  };

  return {
    rooms, actions, events, activeRooms, presence, signals, signalCooldowns, sessions,
    generateRoomId(commandId, actorUserId, attempt) {
      if (options && typeof options.generateRoomId === 'function') {
        return options.generateRoomId(commandId, actorUserId, attempt || 0);
      }
      seq += 1;
      return String(seq);
    },
    async transactCommand(input, handler) {
      const key = receiptKey(input.scopeKey, input.commandId);
      const existing = actions.get(key);
      if (existing) {
        const conflict = existing.actorUserId !== input.actorUserId
          || existing.requestHash !== input.requestHash || existing.type !== input.type;
        return conflict ? { conflict: true } : { replayed: true, receipt: copy(existing) };
      }
      let resolvedRoomId = input.roomId;
      if (input.type === COMMAND_TYPES.CREATE_ROOM) {
        resolvedRoomId = (input.roomIdCandidates || [input.roomId])
          .find((candidate) => !rooms.has(candidate)) || null;
      }
      let activeRoomId = activeRooms.get(input.actorUserId) || null;
      if (activeRoomId) {
        const activeAggregate = rooms.get(activeRoomId);
        const activeMember = activeAggregate && compatibleRoom(activeAggregate.room)
          && activeAggregate.room.lifecycle === 'OPEN'
          && memberByUserId(activeAggregate.room, input.actorUserId);
        if (!activeMember) {
          activeRooms.delete(input.actorUserId);
          activeRoomId = null;
        }
      }
      const storedCurrent = resolvedRoomId && rooms.has(resolvedRoomId) ? rooms.get(resolvedRoomId) : null;
      const current = storedCurrent && compatibleRoom(storedCurrent.room) ? copy(storedCurrent) : null;
      const decision = handler({ aggregate: current, activeRoomId, resolvedRoomId });
      const activityAggregate = [decision.accepted && decision.aggregate, current,
        activeRoomId && rooms.get(activeRoomId)].find((candidate) => candidate
          && compatibleRoom(candidate.room)
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
        beforeUsers.filter((item) => !afterIds.has(item.userId))
          .forEach((item) => activeRooms.delete(item.userId));
        afterUsers.forEach((item) => activeRooms.set(item.userId, item.roomId));
      }
      actions.set(key, copy(receipt));
      return { replayed: false, receipt: copy(receipt) };
    },
    async findActiveRoom(userId) {
      const roomId = activeRooms.get(userId);
      if (!roomId) return null;
      const aggregate = rooms.get(roomId);
      const member = aggregate && compatibleRoom(aggregate.room) && aggregate.room.lifecycle === 'OPEN'
        && memberByUserId(aggregate.room, userId);
      if (!member) {
        activeRooms.delete(userId);
        return null;
      }
      return { roomId, memberId: member.memberId };
    },
    async readAggregate(roomId) {
      if (!rooms.has(roomId) || !compatibleRoom(rooms.get(roomId).room)) return null;
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
      if (!stored || !compatibleRoom(stored.room) || !session
        || (sessionRooms.has(sessionId) && sessionRooms.get(sessionId) !== roomId)) return null;
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
      const stored = rooms.get(roomId);
      const aggregate = stored && compatibleRoom(stored.room) ? copy(stored) : null;
      const roomEvents = events.get(roomId) || [];
      if (aggregate) aggregate.minAvailableSeq = roomEvents.length
        ? roomEvents[0].seq : aggregate.room.eventSeq + 1;
      return { aggregate,
        events: copy(roomEvents.filter((item) => item.seq > afterSeq).slice(0, limit)) };
    },
    async upsertPresence({ roomId, memberId, deviceSessionId, lastSeenAt }) {
      const row = { roomId, memberId, deviceSessionId: deviceSessionId || 'default', lastSeenAt, online: true };
      const key = `${roomId}:${memberId}:${row.deviceSessionId}`;
      const existing = presence.get(key);
      if (existing && Number(existing.lastSeenAt) >= Number(lastSeenAt)) return copy(existing);
      presence.set(key, row);
      return copy(row);
    },
    async listPresence(roomId) {
      return copy([...presence.values()].filter((item) => item.roomId === roomId));
    },
    async listSignals(roomId) {
      return copy([...signals.values()].filter((item) => item.roomId === roomId));
    },
    async upsertSignal(input) {
      const aggregate = rooms.get(input.roomId);
      const member = aggregate && compatibleRoom(aggregate.room) && aggregate.room.lifecycle === 'OPEN'
        && memberByUserId(aggregate.room, input.actorUserId);
      if (!aggregate || !compatibleRoom(aggregate.room)) return { ok: false, errCode: 'ROOM_NOT_FOUND' };
      if (!member) return { ok: false, errCode: 'NOT_MEMBER' };
      if (input.signalType === SIGNAL_TYPES.PARTNER_SILENT_SOUND) {
        const scope = aggregate.room.signalScope;
        if (!scope || scope.sessionId !== input.sessionId || scope.turnId !== input.turnId
          || scope.memberId !== member.memberId || Number(scope.deadlineAt) <= input.now) {
          return { ok: false, errCode: 'INVALID_TRANSITION' };
        }
        const key = `${input.roomId}:${input.signalType}`;
        const existing = signals.get(key);
        if (existing && existing.sessionId === input.sessionId && existing.turnId === input.turnId
          && Number(existing.updatedAt) >= Number(input.now)) {
          return { ok: true, signal: copy(existing) };
        }
        const row = { roomId: input.roomId, signalType: input.signalType, value: input.value,
          memberId: member.memberId, sessionId: input.sessionId, turnId: input.turnId,
          updatedAt: input.now,
          expiresAt: Math.min(scope.deadlineAt, input.now + SIGNAL_TTL_MS[SIGNAL_TYPES.PARTNER_SILENT_SOUND]) };
        signals.set(key, copy(row));
        return { ok: true, signal: copy(row) };
      }
      if (input.signalType === SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE) {
        const session = aggregate.currentSession;
        if (!session || session.sessionId !== input.sessionId) {
          return { ok: false, errCode: 'INVALID_TRANSITION', errMsg: '当前不能催促提交设计问题' };
        }
        const denied = designProblemNudgeDeniedReason(session, member.memberId);
        if (denied) return { ok: false, errCode: denied.errCode, errMsg: denied.errMsg };
        const cooldownKey = `${input.roomId}:${input.sessionId}:${input.signalType}:${member.memberId}`;
        const cooldown = signalCooldowns.get(cooldownKey);
        if (cooldown
          && Number(input.now) - Number(cooldown.updatedAt) < DESIGN_PROBLEM_NUDGE_COOLDOWN_MS) {
          return { ok: true, signal: copy(cooldown.signal) };
        }
        const row = {
          roomId: input.roomId,
          signalType: input.signalType,
          value: 1,
          memberId: member.memberId,
          sessionId: input.sessionId,
          turnId: '',
          updatedAt: input.now,
          expiresAt: input.now + SIGNAL_TTL_MS[SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE]
        };
        signals.set(`${input.roomId}:${input.signalType}`, copy(row));
        // 广播值按房间共享，冷却则必须按成员独立记录，避免 A→B→A 绕过限制。
        signalCooldowns.set(cooldownKey, {
          updatedAt: input.now,
          expiresAt: input.now + DESIGN_PROBLEM_NUDGE_COOLDOWN_MS,
          signal: copy(row)
        });
        return { ok: true, signal: copy(row) };
      }
      return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: '未知瞬时信号' };
    }
  };
}

module.exports = { createInMemoryRoomRepository };
