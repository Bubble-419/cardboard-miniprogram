'use strict';

const {
  COMMAND_TYPES,
  ERR,
  fail,
  okResult,
  validateCommandEnvelope
} = require('@cardboard/room-contracts');
const { executeCommand, buildHead } = require('@cardboard/room-domain');

/**
 * @typedef {object} RoomRepository
 * @property {(roomId: string) => Promise<object|null>} loadRoom
 * @property {(commandId: string) => Promise<object|null>} loadCommand
 * @property {(input: { commandId: string, actorUserId: string, roomId: string, type: string, result: object }) => Promise<void>} saveCommandResult
 * @property {(room: object, effects: object) => Promise<void>} persistRoom
 * @property {() => string} [generateRoomId]
 */

/**
 * Application service：校验信封 → 幂等 → 领域执行 → 持久化
 * @param {RoomRepository} repo
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

  return { execute };
}

/** 内存仓储：契约测试与本地演练 */
function createInMemoryRoomRepository(options) {
  const rooms = new Map();
  const commands = new Map();
  let seq = 10000000;

  return {
    rooms,
    commands,
    generateRoomId() {
      if (options && typeof options.generateRoomId === 'function') {
        return options.generateRoomId();
      }
      seq += 1;
      return String(seq);
    },
    async loadRoom(roomId) {
      return rooms.get(roomId) || null;
    },
    async loadCommand(commandId) {
      return commands.get(commandId) || null;
    },
    async saveCommandResult(row) {
      commands.set(row.commandId, row);
    },
    async persistRoom(room) {
      rooms.set(room.roomId, JSON.parse(JSON.stringify(room)));
    }
  };
}

module.exports = {
  createRoomApplication,
  createInMemoryRoomRepository
};
