'use strict';

const { MAX_SEATS } = require('@cardboard/room-contracts');

const ROOMS = 'rooms';
const MEMBERS = 'roomMembers';
const COMMANDS = 'roomCommands';
const PRESENCE = 'roomPresence';
const SCORES = 'roomScores';
const MESSAGES = 'roomMessages';
const VOTES = 'roomVotes';
const ARTIFACTS = 'roomArtifacts';
const SECRETS = 'roomSecrets';

/**
 * CloudBase 仓储：将领域聚合映射到 rooms + roomMembers + roomCommands
 * @param {{ db: any, cloud?: any }} deps
 */
function createCloudBaseRoomRepository(deps) {
  const db = deps.db;
  if (!db) throw new Error('db required');

  async function generateRoomId(maxRetry) {
    const retries = maxRetry || 5;
    for (let i = 0; i < retries; i += 1) {
      const roomId = String(Math.floor(10000000 + Math.random() * 90000000));
      const exist = await db.collection(ROOMS).where({ roomId }).limit(1).get();
      if (!exist.data || !exist.data.length) return roomId;
    }
    return String(Math.floor(10000000 + Math.random() * 90000000));
  }

  function toAggregate(roomDoc, memberDocs) {
    if (!roomDoc) return null;
    const membersByUserId = {};
    const seatMap = roomDoc.seatMap && typeof roomDoc.seatMap === 'object'
      ? { ...roomDoc.seatMap }
      : {};

    (memberDocs || []).forEach((m) => {
      if (!m || !m.userId) return;
      const seatNo = m.playerIndex != null ? Number(m.playerIndex) : null;
      membersByUserId[m.userId] = {
        userId: m.userId,
        seatNo,
        role: m.role === 'GOD' || m.role === 'HOST' ? 'HOST' : 'PLAYER',
        nickName: m.nickName || `玩家${seatNo || ''}`,
        avatarUrl: m.avatarUrl || null,
        avatarColor: m.avatarColor || '#5EC159',
        avatarIndex: m.avatarIndex != null ? m.avatarIndex : null,
        joinedAt: m.joinedAt || null,
        _id: m._id
      };
      if (seatNo && !seatMap[String(seatNo)]) {
        seatMap[String(seatNo)] = m.userId;
      }
    });

    // 若无 seatMap，从成员重建
    if (!Object.keys(seatMap).length) {
      Object.values(membersByUserId).forEach((m) => {
        if (m.seatNo) seatMap[String(m.seatNo)] = m.userId;
      });
    }

    return {
      _id: roomDoc._id,
      roomId: roomDoc.roomId,
      schemaVersion: roomDoc.schemaVersion || 1,
      protocolVersion: roomDoc.protocolVersion || 1,
      lifecycle: roomDoc.lifecycle || (roomDoc.status === 'DISSOLVED' ? 'DISSOLVED' : 'LOBBY'),
      status: roomDoc.status || 'CREATED',
      hostUserId: roomDoc.hostUserId || roomDoc.creatorId,
      creatorId: roomDoc.creatorId || roomDoc.hostUserId,
      seatMap,
      activeSessionId: roomDoc.activeSessionId || null,
      revision: roomDoc.revision != null ? roomDoc.revision : 0,
      workflow: roomDoc.workflow || null,
      domainRevisions: roomDoc.domainRevisions || null,
      progress: roomDoc.progress || null,
      workshopName: roomDoc.workshopName || '脑暴工作坊',
      membersByUserId,
      selectedModeId: roomDoc.selectedModeId || null,
      currentPage: roomDoc.currentPage || null,
      brainstormProgressPage: roomDoc.brainstormProgressPage || null,
      spyGame: roomDoc.spyGame || null,
      spyAssignments: roomDoc.spyAssignments || null,
      secretsByUserId: null,
      createdAt: roomDoc.createdAt,
      updatedAt: roomDoc.updatedAt
    };
  }

  function secretsFromLegacyAssignments(spyAssignments) {
    const map = {};
    if (!spyAssignments || typeof spyAssignments !== 'object') return map;
    Object.keys(spyAssignments).forEach((seat) => {
      const row = spyAssignments[seat];
      if (!row || !row.userId) return;
      map[row.userId] = {
        playerIndex: row.playerIndex != null ? Number(row.playerIndex) : Number(seat),
        userId: row.userId,
        role: row.role,
        word: row.word,
        blurb: row.blurb || '',
        name: row.name || ''
      };
    });
    return map;
  }

  async function loadSecretsByUserId(roomId) {
    try {
      const res = await db.collection(SECRETS).where({ roomId }).limit(MAX_SEATS).get();
      const map = {};
      (res.data || []).forEach((doc) => {
        if (!doc || !doc.userId) return;
        map[doc.userId] = {
          playerIndex: doc.playerIndex != null ? Number(doc.playerIndex) : null,
          userId: doc.userId,
          role: doc.role,
          word: doc.word,
          blurb: doc.blurb || '',
          name: doc.name || ''
        };
      });
      return map;
    } catch (e) {
      console.warn('load roomSecrets failed', e);
      return {};
    }
  }

  async function loadRoom(roomId) {
    const roomRes = await db.collection(ROOMS).where({ roomId }).limit(1).get();
    if (!roomRes.data || !roomRes.data.length) return null;
    const roomDoc = roomRes.data[0];
    const membersRes = await db
      .collection(MEMBERS)
      .where({ roomId })
      .limit(MAX_SEATS)
      .get();
    const agg = toAggregate(roomDoc, membersRes.data || []);
    let secretsByUserId = await loadSecretsByUserId(roomId);
    if (!Object.keys(secretsByUserId).length) {
      secretsByUserId = secretsFromLegacyAssignments(roomDoc.spyAssignments);
    }
    agg.secretsByUserId = Object.keys(secretsByUserId).length ? secretsByUserId : null;
    return agg;
  }

  async function loadCommand(commandId) {
    try {
      const res = await db.collection(COMMANDS).doc(commandId).get();
      return res && res.data ? res.data : null;
    } catch (e) {
      return null;
    }
  }

  async function saveCommandResult(row) {
    const now = Date.now();
    await db.collection(COMMANDS).doc(row.commandId).set({
      data: {
        commandId: row.commandId,
        actorUserId: row.actorUserId,
        roomId: row.roomId,
        type: row.type,
        result: row.result,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  async function persistRoom(room, effects) {
    const now = room.updatedAt || Date.now();
    const roomFields = {
      roomId: room.roomId,
      schemaVersion: room.schemaVersion,
      protocolVersion: room.protocolVersion,
      lifecycle: room.lifecycle,
      status: room.status,
      hostUserId: room.hostUserId,
      creatorId: room.creatorId || room.hostUserId,
      seatMap: room.seatMap,
      activeSessionId: room.activeSessionId,
      revision: room.revision,
      workflow: room.workflow,
      domainRevisions: room.domainRevisions,
      progress: room.progress,
      workshopName: room.workshopName,
      selectedModeId: room.selectedModeId || null,
      currentPage: room.currentPage || null,
      brainstormProgressPage: room.brainstormProgressPage || null,
      spyGame: room.spyGame || null,
      // 兼容现网 spyGameAction：过渡期双写；权威密牌以 roomSecrets 为准
      spyAssignments: room.spyAssignments || null,
      updatedAt: now
    };

    if (effects && effects.created) {
      roomFields.createdAt = room.createdAt || now;
      await db.collection(ROOMS).add({ data: roomFields });
    } else if (room._id) {
      await db.collection(ROOMS).doc(room._id).update({ data: roomFields });
    } else {
      await db.collection(ROOMS).where({ roomId: room.roomId }).update({ data: roomFields });
    }

    if (effects && effects.dissolved) {
      const all = await db.collection(MEMBERS).where({ roomId: room.roomId }).limit(20).get();
      for (const m of all.data || []) {
        await db.collection(MEMBERS).doc(m._id).remove();
      }
      return;
    }

    // 同步 roomMembers 读模型
    const existing = await db.collection(MEMBERS).where({ roomId: room.roomId }).limit(20).get();
    const byUser = {};
    (existing.data || []).forEach((m) => {
      byUser[m.userId] = m;
    });

    const desiredIds = new Set(Object.keys(room.membersByUserId || {}));
    for (const userId of Object.keys(byUser)) {
      if (!desiredIds.has(userId)) {
        await db.collection(MEMBERS).doc(byUser[userId]._id).remove();
      }
    }

    for (const userId of desiredIds) {
      const m = room.membersByUserId[userId];
      const data = {
        roomId: room.roomId,
        userId,
        role: m.role === 'HOST' ? 'GOD' : 'PLAYER',
        nickName: m.nickName,
        avatarUrl: m.avatarUrl,
        avatarColor: m.avatarColor,
        avatarIndex: m.avatarIndex,
        playerIndex: m.seatNo,
        joinedAt: m.joinedAt || now,
        lastSeenAt: now
      };
      if (byUser[userId]) {
        await db.collection(MEMBERS).doc(byUser[userId]._id).update({ data });
      } else {
        await db.collection(MEMBERS).add({ data });
      }
    }

    // Partner 独立事实：评分 / 消息 / 投票 / 素材
    if (effects && effects.scoreUpsert && room.scoresByKey && effects.scoreKey) {
      const row = room.scoresByKey[effects.scoreKey];
      if (row) {
        const docId = `${room.roomId}_${row.turnId}_${row.scorerUserId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
        try {
          await db.collection(SCORES).doc(docId).set({
            data: {
              roomId: room.roomId,
              turnId: row.turnId,
              userId: row.scorerUserId,
              currentPlayerIndex: row.activeSeatNo,
              score: row.score,
              updatedAt: row.updatedAt,
              createdAt: row.updatedAt
            }
          });
        } catch (e) {
          console.warn('persist score failed', e);
        }
      }
    }
    if (effects && effects.messageAppended && Array.isArray(room.messages)) {
      const msg = room.messages.find((m) => m && m.id === effects.messageId);
      if (msg) {
        try {
          await db.collection(MESSAGES).add({
            data: {
              roomId: room.roomId,
              messageId: msg.id,
              text: msg.text,
              at: msg.at,
              round: msg.round,
              phase: msg.phase,
              anonKey: msg.anonKey
            }
          });
        } catch (e) {
          console.warn('persist message failed', e);
        }
      }
    }
    if (effects && effects.voteUpsert && room.votesByKey && effects.voteKey) {
      const row = room.votesByKey[effects.voteKey];
      if (row) {
        const docId = `${row.voteSessionId}_${row.voterUserId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
        try {
          await db.collection(VOTES).doc(docId).set({
            data: {
              roomId: room.roomId,
              voteSessionId: row.voteSessionId,
              userId: row.voterUserId,
              seatNo: row.seatNo,
              vote: row.vote,
              at: row.at
            }
          });
        } catch (e) {
          console.warn('persist vote failed', e);
        }
      }
    }
    if (effects && effects.artifactAppended && Array.isArray(room.artifacts)) {
      const art = room.artifacts.find((a) => a && a.operationId === effects.operationId);
      if (art) {
        try {
          await db.collection(ARTIFACTS).add({
            data: {
              roomId: room.roomId,
              ...art
            }
          });
        } catch (e) {
          console.warn('persist artifact failed', e);
        }
      }
    }

    // Spy 密牌：独立集合，不进公开快照
    if (effects && effects.secretsClear) {
      try {
        const existing = await db.collection(SECRETS).where({ roomId: room.roomId }).limit(MAX_SEATS).get();
        for (const doc of existing.data || []) {
          await db.collection(SECRETS).doc(doc._id).remove();
        }
      } catch (e) {
        console.warn('clear roomSecrets failed', e);
      }
    } else if (effects && effects.secretsUpsert && room.secretsByUserId) {
      try {
        const existing = await db.collection(SECRETS).where({ roomId: room.roomId }).limit(MAX_SEATS).get();
        for (const doc of existing.data || []) {
          await db.collection(SECRETS).doc(doc._id).remove();
        }
      } catch (e) {
        console.warn('clear roomSecrets failed', e);
      }
      for (const userId of Object.keys(room.secretsByUserId)) {
        const row = room.secretsByUserId[userId];
        if (!row) continue;
        const docId = `${room.roomId}_${userId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
        try {
          await db.collection(SECRETS).doc(docId).set({
            data: {
              roomId: room.roomId,
              userId,
              playerIndex: row.playerIndex != null ? Number(row.playerIndex) : null,
              role: row.role,
              word: row.word,
              blurb: row.blurb || '',
              name: row.name || '',
              updatedAt: now
            }
          });
        } catch (e) {
          console.warn('persist roomSecret failed', e);
        }
      }
    }
  }

  async function loadDomainData(roomId, domains) {
    const out = {};
    const wanted = domains || [];
    if (wanted.includes('scores')) {
      try {
        const res = await db.collection(SCORES).where({ roomId }).limit(200).get();
        out.scores = res.data || [];
      } catch (e) {
        out.scores = [];
      }
    }
    return out;
  }

  async function upsertPresence({ roomId, userId, deviceSessionId }) {
    const device = deviceSessionId || 'default';
    const docId = `${roomId}_${userId}_${device}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    const now = Date.now();
    const data = {
      roomId,
      userId,
      deviceSessionId: device,
      lastSeenAt: now,
      online: true,
      updatedAt: now
    };
    try {
      await db.collection(PRESENCE).doc(docId).set({ data });
    } catch (e) {
      await db.collection(PRESENCE).add({ data: { ...data, _fallbackId: docId } });
    }
    return data;
  }

  async function listPresence(roomId) {
    const res = await db.collection(PRESENCE).where({ roomId }).limit(50).get();
    return res.data || [];
  }

  return {
    generateRoomId,
    loadRoom,
    loadCommand,
    saveCommandResult,
    persistRoom,
    loadDomainData,
    upsertPresence,
    listPresence
  };
}

module.exports = {
  createCloudBaseRoomRepository
};
