'use strict';

const {
  COMMAND_TYPES,
  ERR,
  fail,
  okResult,
  validateCommandEnvelope,
  isNonEmptyString
} = require('@cardboard/room-contracts');
const {
  executeCommand,
  buildHead,
  projectSnapshot,
  authorizeRoomRead
} = require('@cardboard/room-domain');

/**
 * @typedef {object} RoomRepository
 * @property {(roomId: string) => Promise<object|null>} loadRoom
 * @property {(commandId: string) => Promise<object|null>} loadCommand
 * @property {(input: object) => Promise<void>} saveCommandResult
 * @property {(room: object, effects: object) => Promise<void>} persistRoom
 * @property {() => string} [generateRoomId]
 * @property {(roomId: string, domains: string[]) => Promise<object>} [loadDomainData]
 * @property {(input: { roomId: string, userId: string, deviceSessionId?: string }) => Promise<object>} [upsertPresence]
 * @property {(roomId: string) => Promise<object[]>} [listPresence]
 */

function createRoomApplication(repo) {
  if (!repo || typeof repo.loadRoom !== 'function') {
    throw new Error('RoomRepository required');
  }

  async function execute(rawEnvelope, actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    if (!actorUserId) {
      return fail(ERR.UNAUTHENTICATED);
    }

    const validated = validateCommandEnvelope(rawEnvelope);
    if (!validated.ok) return validated;
    const envelope = validated.envelope;

    const existingCmd = await repo.loadCommand(envelope.commandId);
    if (existingCmd) {
      if (
        String(existingCmd.actorUserId) !== String(actorUserId) ||
        (existingCmd.roomId && envelope.roomId && String(existingCmd.roomId) !== String(envelope.roomId))
      ) {
        return fail(ERR.COMMAND_ID_CONFLICT);
      }
      return existingCmd.result;
    }

    let room = null;
    if (envelope.type !== COMMAND_TYPES.CREATE_ROOM) {
      room = await repo.loadRoom(envelope.roomId);
    }

    const domainResult = executeCommand({
      room,
      envelope,
      actorUserId,
      roomIdFactory: repo.generateRoomId
        ? () => repo.generateRoomId()
        : undefined,
      now: Date.now()
    });

    if (!domainResult.ok) {
      return {
        ...domainResult,
        commandId: envelope.commandId
      };
    }

    await repo.persistRoom(domainResult.room, domainResult.effects || {});

    const success = okResult({
      commandId: envelope.commandId,
      appliedRevision: domainResult.appliedRevision,
      changedDomains: domainResult.changedDomains || [],
      head: domainResult.head || buildHead(domainResult.room, actorUserId),
      effects: domainResult.effects || {},
      roomId: domainResult.room.roomId
    });

    await repo.saveCommandResult({
      commandId: envelope.commandId,
      actorUserId,
      roomId: domainResult.room.roomId,
      type: envelope.type,
      result: success
    });

    return success;
  }

  /** 只读 head：不写库、不增加 revision */
  async function readHead(roomId, actorContext) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(roomId)) {
      return fail(ERR.INVALID_ARGUMENT, 'roomId 必填');
    }
    const room = await repo.loadRoom(roomId);
    const auth = authorizeRoomRead(room, actorUserId);
    if (!auth.ok) return auth;
    return okResult({ head: buildHead(auth.room, actorUserId) });
  }

  /** 按域快照：无业务写副作用 */
  async function readSnapshot(roomId, actorContext, request) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(roomId)) {
      return fail(ERR.INVALID_ARGUMENT, 'roomId 必填');
    }
    const room = await repo.loadRoom(roomId);
    const auth = authorizeRoomRead(room, actorUserId);
    if (!auth.ok) return auth;

    const domains = (request && request.domains) || ['members'];
    let extraDomainData = {};
    if (typeof repo.loadDomainData === 'function') {
      extraDomainData = await repo.loadDomainData(roomId, domains);
    }

    const snapshot = projectSnapshot(auth.room, {
      actorUserId,
      domains,
      clientDomainRevisions: (request && request.domainRevisions) || {},
      extraDomainData
    });
    return okResult({ snapshot, head: buildHead(auth.room, actorUserId) });
  }

  /**
   * Presence 心跳：不修改 seatMap / revision / 成员资格
   */
  async function heartbeat(roomId, actorContext, payload) {
    const actorUserId = actorContext && actorContext.userId;
    if (!isNonEmptyString(roomId)) {
      return fail(ERR.INVALID_ARGUMENT, 'roomId 必填');
    }
    if (!isNonEmptyString(actorUserId)) {
      return fail(ERR.UNAUTHENTICATED);
    }
    const room = await repo.loadRoom(roomId);
    const auth = authorizeRoomRead(room, actorUserId);
    if (!auth.ok) return auth;

    if (typeof repo.upsertPresence !== 'function') {
      return fail(ERR.DEPENDENCY_UNAVAILABLE, 'presence store unavailable');
    }

    const row = await repo.upsertPresence({
      roomId,
      userId: actorUserId,
      deviceSessionId: payload && payload.deviceSessionId
    });

    return okResult({
      presence: row,
      revision: auth.room.revision
    });
  }

  return { execute, readHead, readSnapshot, heartbeat };
}

function createInMemoryRoomRepository(options) {
  const rooms = new Map();
  const commands = new Map();
  const presence = new Map();
  const domainExtras = new Map();
  let seq = 10000000;

  return {
    rooms,
    commands,
    presence,
    domainExtras,
    generateRoomId() {
      if (options && typeof options.generateRoomId === 'function') {
        return options.generateRoomId();
      }
      seq += 1;
      return String(seq);
    },
    async loadRoom(roomId) {
      const room = rooms.get(roomId);
      return room ? JSON.parse(JSON.stringify(room)) : null;
    },
    async loadCommand(commandId) {
      return commands.get(commandId) || null;
    },
    async saveCommandResult(row) {
      commands.set(row.commandId, row);
    },
    async persistRoom(room) {
      rooms.set(room.roomId, JSON.parse(JSON.stringify(room)));
    },
    async loadDomainData(roomId, domains) {
      const bag = domainExtras.get(roomId) || {};
      const out = {};
      (domains || []).forEach((d) => {
        if (d !== 'members' && Object.prototype.hasOwnProperty.call(bag, d)) {
          out[d] = bag[d];
        }
      });
      return out;
    },
    async upsertPresence({ roomId, userId, deviceSessionId }) {
      const key = `${roomId}:${userId}:${deviceSessionId || 'default'}`;
      const row = {
        roomId,
        userId,
        deviceSessionId: deviceSessionId || 'default',
        lastSeenAt: Date.now(),
        online: true
      };
      presence.set(key, row);
      return row;
    },
    async listPresence(roomId) {
      return [...presence.values()].filter((p) => p.roomId === roomId);
    }
  };
}

module.exports = {
  createRoomApplication,
  createInMemoryRoomRepository
};
