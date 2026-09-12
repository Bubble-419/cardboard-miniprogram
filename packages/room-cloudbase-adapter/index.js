'use strict';

const crypto = require('crypto');
const { clone } = require('@cardboard/room-projection');

// V3 使用独立物理集合，不读取或双写旧协议数据。
const COLLECTIONS = Object.freeze({
  rooms: 'roomV3Rooms', sessions: 'roomV3Sessions', active: 'roomV3ActiveByUser',
  actions: 'roomV3Actions', events: 'roomV3Events', turns: 'roomV3Turns',
  scores: 'roomV3Scores', votes: 'roomV3Votes', contributions: 'roomV3Contributions',
  artifacts: 'roomV3Artifacts', messages: 'roomV3Messages', secrets: 'roomV3Secrets',
  presence: 'roomV3Presence'
});

const FACT_COLLECTION = Object.freeze({
  turns: COLLECTIONS.turns, scores: COLLECTIONS.scores, votes: COLLECTIONS.votes,
  contributions: COLLECTIONS.contributions, artifacts: COLLECTIONS.artifacts,
  messages: COLLECTIONS.messages, secrets: COLLECTIONS.secrets
});

const FACT_LIMITS = Object.freeze({ turns: 600, scores: 1000, votes: 1000,
  contributions: 20, artifacts: 1000, messages: 200, secrets: 12 });

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
    return null;
  }
}

async function loadFactRows(store, kind, roomId, sessionId) {
  if (!sessionId) return kind === 'messages' ? [] : {};
  const query = store.collection(FACT_COLLECTION[kind]).where({ roomId, sessionId });
  const result = await query.limit(FACT_LIMITS[kind]).get();
  const rows = (result && result.data) || [];
  if (kind === 'messages') return rows.map(cleanDoc).sort((a, b) => a.createdAt - b.createdAt);
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

async function loadAggregate(store, roomId) {
  const room = await safeGet(store, COLLECTIONS.rooms, roomId);
  if (!room) return null;
  const currentSession = room.currentSessionId
    ? await safeGet(store, COLLECTIONS.sessions, room.currentSessionId)
    : null;
  if (currentSession) delete currentSession.roomId;
  const sessionId = currentSession && currentSession.sessionId;
  const entries = await Promise.all(Object.keys(FACT_COLLECTION).map(async (kind) =>
    [kind, await loadFactRows(store, kind, roomId, sessionId)]));
  return { room, currentSession, facts: Object.fromEntries(entries) };
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

  function generateRoomId(commandId, actorUserId) {
    const value = parseInt(digest(`${actorUserId}:${commandId}:room`).slice(0, 12), 16);
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
      const current = await loadAggregate(transaction, input.roomId);
      const decision = handler({ aggregate: current, activeRoomId: active && active.roomId });
      const receipt = {
        scopeKey: input.scopeKey, commandId: input.commandId, actorUserId: input.actorUserId,
        roomId: input.roomId, type: input.type, requestHash: input.requestHash,
        accepted: decision.accepted === true, outcome: cleanDoc(decision.outcome),
        error: cleanDoc(decision.error), committedThroughSeq: decision.outcome && decision.outcome.committedThroughSeq,
        createdAt: input.createdAt
      };
      if (decision.accepted) {
        const beforeUsers = openUsers(current);
        const afterUsers = openUsers(decision.aggregate);
        await transaction.collection(COLLECTIONS.rooms).doc(input.roomId).set({ data: cleanDoc(decision.aggregate.room) });
        if (decision.aggregate.currentSession) {
          const session = cleanDoc(decision.aggregate.currentSession);
          await transaction.collection(COLLECTIONS.sessions).doc(session.sessionId)
            .set({ data: { ...session, roomId: input.roomId } });
        }
        if (decision.archivedSession) {
          const archived = cleanDoc(decision.archivedSession);
          await transaction.collection(COLLECTIONS.sessions).doc(archived.sessionId)
            .set({ data: { ...archived, roomId: input.roomId } });
        }
        for (const dirty of decision.dirtyFacts || []) {
          const row = factRow(decision.aggregate, dirty.kind, dirty.id);
          if (!row) continue;
          const sessionId = row.sessionId || (decision.aggregate.currentSession && decision.aggregate.currentSession.sessionId);
          const data = { ...cleanDoc(row), roomId: input.roomId, sessionId };
          if (dirty.kind !== 'messages') data._factKey = dirty.id;
          await transaction.collection(FACT_COLLECTION[dirty.kind]).doc(docId(`${input.roomId}:${dirty.kind}:${dirty.id}`))
            .set({ data });
        }
        for (const item of decision.events || []) {
          await transaction.collection(COLLECTIONS.events).doc(`${input.roomId}_${String(item.seq).padStart(12, '0')}`)
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

  return { generateRoomId, transactCommand, readAggregate, readSyncState, findActiveRoom,
    upsertPresence, listPresence };
}

module.exports = { COLLECTIONS, createCloudBaseRoomRepository, digest, docId };
