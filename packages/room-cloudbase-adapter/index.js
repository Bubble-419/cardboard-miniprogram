'use strict';

const crypto = require('crypto');
const { clone } = require('@cardboard/room-projection');

// V3 使用独立物理集合，不读取或双写旧协议数据。
const COLLECTIONS = Object.freeze({
  rooms: 'roomV3Rooms', sessions: 'roomV3Sessions', active: 'roomV3ActiveByUser',
  actions: 'roomV3Actions', events: 'roomV3Events', turns: 'roomV3Turns',
  scores: 'roomV3Scores', votes: 'roomV3Votes', contributions: 'roomV3Contributions',
  artifacts: 'roomV3Artifacts', messages: 'roomV3Messages', secrets: 'roomV3Secrets',
  presence: 'roomV3Presence', signals: 'roomV3Signals', media: 'roomV3Media'
});

const FACT_COLLECTION = Object.freeze({
  turns: COLLECTIONS.turns, scores: COLLECTIONS.scores, votes: COLLECTIONS.votes,
  contributions: COLLECTIONS.contributions, artifacts: COLLECTIONS.artifacts,
  messages: COLLECTIONS.messages, secrets: COLLECTIONS.secrets
});

const FACT_LIMITS = Object.freeze({ turns: 1200, scores: 6000, votes: 6000,
  contributions: 500, artifacts: 20000, secrets: 12 });
const QUERY_PAGE_SIZE = 100;

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

async function loadFactRows(store, kind, roomId, sessionId) {
  if (!sessionId) return kind === 'messages' ? [] : {};
  if (kind === 'messages') {
    // 表达消息是有界视图，只读取最新 40 条；历史消息无需参与领域裁决。
    const result = await store.collection(FACT_COLLECTION.messages).where({ roomId, sessionId })
      .orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(40).get();
    return ((result && result.data) || []).map(cleanDoc).sort((a, b) => a.createdAt - b.createdAt);
  }
  const rows = [];
  while (true) {
    // 多读一条才能区分“恰好达到上限”和“已经超过上限”。
    const take = Math.min(QUERY_PAGE_SIZE, FACT_LIMITS[kind] + 1 - rows.length);
    const result = await store.collection(FACT_COLLECTION[kind]).where({ roomId, sessionId })
      .orderBy('_factKey', 'asc')
      .skip(rows.length).limit(take).get();
    const page = (result && result.data) || [];
    rows.push(...page);
    // 宁可明确失败并要求运维归档，也不能用截断数据生成一个貌似合法的 Snapshot。
    if (rows.length > FACT_LIMITS[kind]) {
      throw Object.assign(new Error(`${kind} 超过单场次安全上限`), { code: 'LIMIT_EXCEEDED' });
    }
    if (page.length < take) break;
  }
  const out = {};
  rows.forEach((raw) => {
    const row = cleanDoc(raw);
    if (row && row._factKey) {
      const key = row._factKey;
      delete row._factKey;
      out[key] = row;
    }
  });
  return out;
}

async function loadFacts(store, roomId, sessionId) {
  const entries = [];
  // CloudBase 的同一个 transaction 实例不能并行执行查询，否则会返回 TransactionBusy。
  for (const kind of Object.keys(FACT_COLLECTION)) {
    entries.push([kind, await loadFactRows(store, kind, roomId, sessionId)]);
  }
  return Object.fromEntries(entries);
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
  if (currentSession) delete currentSession.roomId;
  const sessionId = currentSession && currentSession.sessionId;
  const facts = await loadFacts(store, roomId, sessionId);
  const firstEventResult = await store.collection(COLLECTIONS.events).where({ roomId })
    .orderBy('seq', 'asc').limit(1).get();
  const firstEvent = firstEventResult && firstEventResult.data && firstEventResult.data[0];
  // Event 使用 TTL 后，最小可用水位必须从实际日志计算，不能依赖可能滞后的 Room 字段。
  const minAvailableSeq = firstEvent ? Number(firstEvent.seq) : Number(room.eventSeq) + 1;
  return { room, currentSession, facts, minAvailableSeq };
}

async function loadSessionAggregate(store, roomId, sessionId) {
  const room = await safeGet(store, COLLECTIONS.rooms, roomId);
  if (!room) return null;
  const currentSession = await safeGet(store, COLLECTIONS.sessions, sessionId);
  if (!currentSession || currentSession.roomId !== roomId) return null;
  delete currentSession.roomId;
  const facts = await loadFacts(store, roomId, sessionId);
  return { room, currentSession, facts };
}

function factRow(aggregate, kind, id) {
  if (!aggregate || !aggregate.facts) return null;
  if (kind === 'messages') return (aggregate.facts.messages || []).find((item) => item.messageId === id) || null;
  return aggregate.facts[kind] && aggregate.facts[kind][id];
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
      const decision = handler({ aggregate: current, activeRoomId: active && active.roomId, resolvedRoomId });
      const receipt = {
        scopeKey: input.scopeKey, commandId: input.commandId, actorUserId: input.actorUserId,
        roomId: resolvedRoomId, type: input.type, requestHash: input.requestHash,
        accepted: decision.accepted === true, outcome: cleanDoc(decision.outcome),
        error: cleanDoc(decision.error), committedThroughSeq: decision.outcome && decision.outcome.committedThroughSeq,
        createdAt: input.createdAt
      };
      if (decision.accepted) {
        const beforeUsers = openUsers(current);
        const afterUsers = openUsers(decision.aggregate);
        await transaction.collection(COLLECTIONS.rooms).doc(resolvedRoomId).set({ data: cleanDoc(decision.aggregate.room) });
        if (decision.aggregate.currentSession) {
          const session = cleanDoc(decision.aggregate.currentSession);
          await transaction.collection(COLLECTIONS.sessions).doc(session.sessionId)
            .set({ data: { ...session, roomId: resolvedRoomId } });
        }
        if (decision.archivedSession) {
          const archived = cleanDoc(decision.archivedSession);
          await transaction.collection(COLLECTIONS.sessions).doc(archived.sessionId)
            .set({ data: { ...archived, roomId: resolvedRoomId } });
        }
        for (const dirty of decision.dirtyFacts || []) {
          const factDocumentId = docId(`${resolvedRoomId}:${dirty.kind}:${dirty.id}`);
          if (dirty.remove) {
            await transaction.collection(FACT_COLLECTION[dirty.kind]).doc(factDocumentId).remove();
            continue;
          }
          const row = factRow(decision.aggregate, dirty.kind, dirty.id);
          if (!row) continue;
          const sessionId = row.sessionId || (decision.aggregate.currentSession && decision.aggregate.currentSession.sessionId);
          const data = { ...cleanDoc(row), roomId: resolvedRoomId, sessionId };
          if (dirty.kind !== 'messages') data._factKey = dirty.id;
          await transaction.collection(FACT_COLLECTION[dirty.kind]).doc(factDocumentId)
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
      }
      await transaction.collection(COLLECTIONS.actions).doc(actionId).set({ data: receipt });
      return { replayed: false, receipt };
    });
  }

  async function readAggregate(roomId) {
    return db.runTransaction((transaction) => loadAggregate(transaction, roomId));
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

  async function readSyncState(roomId, afterSeq, limit) {
    return db.runTransaction(async (transaction) => {
      const aggregate = await loadAggregate(transaction, roomId);
      if (!aggregate) return { aggregate: null, events: [] };
      const ceiling = aggregate.room.eventSeq;
      const _ = db.command;
      const result = await transaction.collection(COLLECTIONS.events)
        .where({ roomId, seq: _.gt(afterSeq).and(_.lte(ceiling)) }).orderBy('seq', 'asc').limit(limit).get();
      return { aggregate, events: (result && result.data || []).map(cleanDoc) };
    });
  }

  async function findActiveRoom(userId) {
    return db.runTransaction(async (transaction) => {
      const active = await safeGet(transaction, COLLECTIONS.active, docId(userId));
      if (!active) return null;
      const aggregate = await loadAggregate(transaction, active.roomId);
      const member = aggregate && aggregate.room.lifecycle === 'OPEN'
        && (aggregate.room.members || []).find((item) => item.userId === userId);
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
    const result = await db.collection(COLLECTIONS.presence).where({ roomId }).limit(50).get();
    return (result && result.data || []).map(cleanDoc);
  }

  async function listSignals(roomId) {
    const result = await db.collection(COLLECTIONS.signals).where({ roomId }).limit(20).get();
    return (result && result.data || []).map(cleanDoc);
  }

  return { generateRoomId, transactCommand, readAggregate, readSessionAggregate, listSessions,
    readSyncState, findActiveRoom,
    upsertPresence, listPresence, listSignals };
}

module.exports = { COLLECTIONS, createCloudBaseRoomRepository, digest, docId, safeGet };
