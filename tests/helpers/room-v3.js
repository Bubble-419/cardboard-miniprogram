'use strict';

const { PROTOCOL_VERSION } = require('@cardboard/room-contracts');
const { createRoomApplication } = require('@cardboard/room-application');
const { createInMemoryRoomRepository } = require('../../packages/room-application/testing');

function createHarness(options) {
  let commandSeq = 0;
  let time = 1000;
  const repo = createInMemoryRoomRepository({
    generateRoomId: typeof (options && options.generateRoomId) === 'function'
      ? options.generateRoomId
      : () => (options && options.roomId) || '12345678'
  });
  const app = createRoomApplication(repo, {
    now: () => ++time,
    serverSecret: 'test-secret',
    wordPairPicker: options && options.wordPairPicker,
    maxSessionDocumentBytes: options && options.maxSessionDocumentBytes
  });
  const knownSeq = {};

  async function command(userId, type, fields) {
    const input = fields || {};
    const roomId = input.roomId || (options && options.roomId) || '12345678';
    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: input.commandId || `command-${++commandSeq}`,
      roomId: type === 'CREATE_ROOM' ? (input.roomId || '') : roomId,
      knownSeq: input.knownSeq == null ? (knownSeq[userId] || 0) : input.knownSeq,
      type,
      context: input.context || {},
      payload: input.payload || {}
    };
    const result = await app.executeCommand(envelope, { userId });
    if (result.ok && result.outcome && result.outcome.committedThroughSeq) {
      knownSeq[userId] = result.outcome.committedThroughSeq;
    }
    return result;
  }

  async function snapshot(userId, roomId) {
    return app.readSnapshot(roomId || (options && options.roomId) || '12345678', { userId });
  }

  async function seedMembers(count) {
    await command('host', 'CREATE_ROOM', { payload: { nickName: '房主' } });
    for (let index = 2; index <= count; index += 1) {
      await command(`u${index}`, 'JOIN_ROOM', { payload: { nickName: `玩家${index}` } });
    }
    return snapshot('host');
  }

  function advanceTime(ms) {
    time += Number(ms) || 0;
    return time;
  }

  return { app, repo, command, snapshot, seedMembers, advanceTime, knownSeq };
}

module.exports = { createHarness };
