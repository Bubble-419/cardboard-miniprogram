'use strict';

const crypto = require('crypto');
const { clone } = require('@cardboard/room-projection');
const { emptyFacts } = require('@cardboard/room-domain');

// V3 使用独立物理集合，不读取或双写旧协议数据。
const COLLECTIONS = Object.freeze({
  rooms: 'roomV3Rooms', sessions: 'roomV3Sessions', active: 'roomV3ActiveByUser',
  actions: 'roomV3Actions', events: 'roomV3Events', messages: 'roomV3Messages',
  presence: 'roomV3Presence', signals: 'roomV3Signals', media: 'roomV3Media'
});

function digest(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function docId(value) { return digest(value).slice(0, 48); }
function cleanDoc(value) {
  if (!value) return null;
  const next = clone(value);
  delete next._id;
  return next;
}
async function safeGet(store, collection, id) {
  try {
    const result = await store.collection(collection).doc(id).get();
    return result && result.data ? cleanDoc(result.data) : null;
  } catch (error) {
    // 只有“文档不存在”才等价于空值；网络、权限、事务错误必须上抛，避免误判后覆盖数据。
    const code = String(error && (error.errCode || error.code) || '');
    const message = String(error && (error.errMsg || error.message) || '');
    const missing = ['DATABASE_DOCUMENT_NOT_EXIST', '-502005', 'DOCUMENT_NOT_FOUND'].includes(code)
      || /document[^\n]*(not exist|not found)|文档不存在/i.test(message);
    if (missing) return null;
    throw error;
  }
}

async function loadAggregate(store, roomId) {
  const room = await safeGet(store, COLLECTIONS.rooms, roomId);
  if (!room) return null;
  const currentSession = room.currentSessionId
    ? await safeGet(store, COLLECTIONS.sessions, room.currentSessionId)
    : null;
  if (room.currentSessionId && (!currentSession || currentSession.roomId !== roomId)) {
    throw Object.assign(new Error('Room.currentSessionId 指向无效场次'), { code: 'INTERNAL_ERROR' });
  }
  const facts = currentSession && currentSession.facts ? cleanDoc(currentSession.facts) : emptyFacts();
  if (currentSession) {
    delete currentSession.roomId;
    delete currentSession.facts;
  }
  return { room, currentSession, facts };
}

async function loadSessionAggregate(store, roomId, sessionId) {
  const room = await safeGet(store, COLLECTIONS.rooms, roomId);
  if (!room) return null;
  const currentSession = await safeGet(store, COLLECTIONS.sessions, sessionId);
  if (!currentSession || currentSession.roomId !== roomId) return null;
  const facts = currentSession.facts ? cleanDoc(currentSession.facts) : emptyFacts();
  delete currentSession.roomId;
  delete currentSession.facts;
  return { room, currentSession, facts };
}

function openUsers(aggregate) {
  if (!aggregate || !aggregate.room || aggregate.room.lifecycle !== 'OPEN') return [];
  return (aggregate.room.members || []).map((member) => ({ userId: member.userId,
    roomId: aggregate.room.roomId, memberId: member.memberId }));
}

function createCloudBaseRoomRepository(deps) {
  const db = deps && deps.db;
  if (!db || typeof db.runTransaction !== 'function') throw new Error('CloudBase transaction database required');

  function generateRoomId(commandId, actorUserId, attempt) {
    const value = parseInt(digest(`${actorUserId}:${commandId}:room:${attempt || 0}`).slice(0, 12), 16);
    return String(10000000 + (value % 90000000));
  }

  async function transactCommand(input, handler) {
    return db.runTransaction(async (transaction) => {
      const actionId = docId(`${input.scopeKey}:${input.commandId}`);
      const existing = await safeGet(transaction, COLLECTIONS.actions, actionId);
      if (existing) {
        const conflict = existing.actorUserId !== input.actorUserId
          || existing.requestHash !== input.requestHash || existing.type !== input.type;
        return conflict ? { conflict: true } : { replayed: true, receipt: existing };
      }
      const active = await safeGet(transaction, COLLECTIONS.active, docId(input.actorUserId));
      let activeRoomId = active && active.roomId;
      let activeRoomDocument = null;
      let danglingActive = false;
      if (activeRoomId) {
        activeRoomDocument = await safeGet(transaction, COLLECTIONS.rooms, activeRoomId);
        const activeMember = activeRoomDocument && activeRoomDocument.lifecycle === 'OPEN'
          && (activeRoomDocument.members || []).some((member) => member.userId === input.actorUserId);
        if (!activeMember) {
          // 只在命令事务内修复悬挂索引，查询接口继续保持只读。
          activeRoomId = null;
          danglingActive = true;
        }
      }
      let resolvedRoomId = input.roomId;
      if (input.type === 'CREATE_ROOM') {
        resolvedRoomId = null;
        for (const candidate of input.roomIdCandidates || [input.roomId]) {
          if (!await safeGet(transaction, COLLECTIONS.rooms, candidate)) {
            resolvedRoomId = candidate;
            break;
          }
        }
      }
      const current = resolvedRoomId ? await loadAggregate(transaction, resolvedRoomId) : null;
      const decision = handler({ aggregate: current, activeRoomId, resolvedRoomId });
      const activityAggregate = [decision.accepted && decision.aggregate, current,
        activeRoomDocument && { room: activeRoomDocument }].find((candidate) => candidate && candidate.room
          && (candidate.room.members || []).some((member) => member.userId === input.actorUserId)) || null;
      const activityMember = activityAggregate && activityAggregate.room
        && (activityAggregate.room.members || []).find((member) => member.userId === input.actorUserId);
      const receipt = {
        scopeKey: input.scopeKey, commandId: input.commandId, actorUserId: input.actorUserId,
        roomId: resolvedRoomId, type: input.type, requestHash: input.requestHash,
        accepted: decision.accepted === true, outcome: cleanDoc(decision.outcome),
        error: cleanDoc(decision.error),
        committedThroughSeq: decision.outcome && decision.outcome.committedThroughSeq || null,
        activityRoomId: activityAggregate && activityAggregate.room && activityAggregate.room.roomId || null,
        memberId: activityMember && activityMember.memberId || null,
        createdAt: input.createdAt
      };
      if (decision.accepted) {
        const beforeUsers = openUsers(current);
        const afterUsers = openUsers(decision.aggregate);
        const actorWillHaveActiveIndex = afterUsers.some((member) => member.userId === input.actorUserId);
        if (danglingActive && !actorWillHaveActiveIndex) {
          await transaction.collection(COLLECTIONS.active).doc(docId(input.actorUserId)).remove();
        }
        await transaction.collection(COLLECTIONS.rooms).doc(resolvedRoomId).set({ data: cleanDoc(decision.aggregate.room) });
        if (decision.aggregate.currentSession) {
          const session = cleanDoc(decision.aggregate.currentSession);
          await transaction.collection(COLLECTIONS.sessions).doc(session.sessionId)
            .set({ data: { ...session, roomId: resolvedRoomId,
              facts: cleanDoc(decision.aggregate.facts || emptyFacts()) } });
        }
        if (decision.archivedSession) {
          const archived = cleanDoc(decision.archivedSession);
          await transaction.collection(COLLECTIONS.sessions).doc(archived.sessionId)
            .set({ data: { ...archived, roomId: resolvedRoomId,
              facts: cleanDoc(decision.archivedFacts || emptyFacts()) } });
        }
        // RoomSession 聚合保存全部事实；消息另建只读索引，支持按 commitSeq 分页。
        for (const dirty of decision.dirtyFacts || []) {
          if (dirty.kind !== 'messages') continue;
          const factDocumentId = docId(`${resolvedRoomId}:${dirty.kind}:${dirty.id}`);
          if (dirty.remove) {
            await transaction.collection(COLLECTIONS.messages).doc(factDocumentId).remove();
            continue;
          }
          const row = (decision.aggregate.facts && decision.aggregate.facts.messages || [])
            .find((item) => item.messageId === dirty.id);
          if (!row) continue;
          const sessionId = row.sessionId || (decision.aggregate.currentSession && decision.aggregate.currentSession.sessionId);
          const data = { ...cleanDoc(row), roomId: resolvedRoomId, sessionId };
          await transaction.collection(COLLECTIONS.messages).doc(factDocumentId)
            .set({ data });
        }
        for (const item of decision.events || []) {
          await transaction.collection(COLLECTIONS.events).doc(`${resolvedRoomId}_${String(item.seq).padStart(12, '0')}`)
            .set({ data: cleanDoc(item) });
        }
        const afterIds = new Set(afterUsers.map((item) => item.userId));
        for (const member of beforeUsers) {
          if (!afterIds.has(member.userId)) {
            await transaction.collection(COLLECTIONS.active).doc(docId(member.userId)).remove();
          }
        }
        for (const member of afterUsers) {
          await transaction.collection(COLLECTIONS.active).doc(docId(member.userId)).set({ data: member });
        }
      } else if (danglingActive) {
        await transaction.collection(COLLECTIONS.active).doc(docId(input.actorUserId)).remove();
      }
      await transaction.collection(COLLECTIONS.actions).doc(actionId).set({ data: receipt });
      return { replayed: false, receipt };
    });
  }

  async function readAggregate(roomId) {
    return db.runTransaction(async (transaction) => {
      const aggregate = await loadAggregate(transaction, roomId);
      if (!aggregate) return null;
      const first = await transaction.collection(COLLECTIONS.events).where({ roomId })
        .orderBy('seq', 'asc').limit(1).get();
      const firstEvent = first && first.data && first.data[0];
      aggregate.minAvailableSeq = firstEvent ? firstEvent.seq : aggregate.room.eventSeq + 1;
      return aggregate;
    });
  }

  async function readSessionAggregate(roomId, sessionId) {
    return db.runTransaction((transaction) => loadSessionAggregate(transaction, roomId, sessionId));
  }

  async function listSessions(roomId, options) {
    const size = Math.min(50, Math.max(1, Number(options && options.limit) || 20));
    const before = Number(options && options.beforeOrdinal);
    const condition = {
      roomId,
      status: db.command.in(['COMPLETED', 'CANCELLED'])
    };
    if (Number.isInteger(before)) condition.ordinal = db.command.lt(before);
    const result = await db.collection(COLLECTIONS.sessions).where(condition)
      .orderBy('ordinal', 'desc').limit(size + 1).get();
    return (result && result.data || []).map(cleanDoc);
  }

  async function listMessages(roomId, sessionId, options) {
    const size = Math.min(100, Math.max(1, Number(options && options.limit) || 100));
    const rawBeforeSeq = options && options.beforeSeq;
    const beforeSeq = rawBeforeSeq == null || rawBeforeSeq === '' ? null : Number(rawBeforeSeq);
    const condition = { roomId, sessionId };
    if (beforeSeq != null) condition.commitSeq = db.command.lt(beforeSeq);
    const result = await db.collection(COLLECTIONS.messages).where(condition)
      .orderBy('commitSeq', 'desc').limit(size + 1).get();
    return (result && result.data || []).map(cleanDoc);
  }

  async function readSyncState(roomId, afterSeq, limit) {
    return db.runTransaction(async (transaction) => {
      // 高频增量查询只读取轻量 Room 和统一事件流，不加载 RoomSession 聚合。
      const room = await safeGet(transaction, COLLECTIONS.rooms, roomId);
      if (!room) return { room: null, events: [] };
      const ceiling = room.eventSeq;
      const _ = db.command;
      const result = await transaction.collection(COLLECTIONS.events)
        .where({ roomId, seq: _.gt(afterSeq).and(_.lte(ceiling)) }).orderBy('seq', 'asc').limit(limit).get();
      return { room, events: (result && result.data || []).map(cleanDoc) };
    });
  }

  async function findActiveRoom(userId) {
    return db.runTransaction(async (transaction) => {
      const active = await safeGet(transaction, COLLECTIONS.active, docId(userId));
      if (!active) return null;
      // current 查询只需验证“用户索引 -> 房间成员”这一条引用。
      // 不加载完整聚合，避免无谓依赖场次、事实集合及其复合索引，也避免在事务内并发查询。
      const room = await safeGet(transaction, COLLECTIONS.rooms, active.roomId);
      const member = room && room.lifecycle === 'OPEN'
        && (room.members || []).find((item) => item.userId === userId);
      return member ? { roomId: active.roomId, memberId: member.memberId }
        : { dangling: true, roomId: active.roomId };
    });
  }

  async function upsertPresence({ roomId, memberId, deviceSessionId, lastSeenAt }) {
    const row = { roomId, memberId, deviceSessionId: deviceSessionId || 'default', lastSeenAt, online: true };
    await db.collection(COLLECTIONS.presence).doc(docId(`${roomId}:${memberId}:${row.deviceSessionId}`)).set({ data: row });
    return row;
  }

  async function listPresence(roomId) {
    const result = await db.collection(COLLECTIONS.presence).where({ roomId })
      .orderBy('lastSeenAt', 'desc').limit(50).get();
    return (result && result.data || []).map(cleanDoc);
  }

  async function listSignals(roomId) {
    const result = await db.collection(COLLECTIONS.signals).where({ roomId }).limit(20).get();
    return (result && result.data || []).map(cleanDoc);
  }

  return { generateRoomId, transactCommand, readAggregate, readSessionAggregate, listSessions, listMessages,
    readSyncState, findActiveRoom,
    upsertPresence, listPresence, listSignals };
}

module.exports = { COLLECTIONS, createCloudBaseRoomRepository, digest, docId, safeGet };
