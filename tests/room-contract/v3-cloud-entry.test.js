'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { validateCommandEnvelope } = require('../../packages/room-contracts/index');

async function invokeRoomCommand(event) {
  const originalLoad = Module._load;
  const entryPath = require.resolve('../../cloudfunctions/roomCommand/src/entry');

  Module._load = function loadWithCloudMocks(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return {}; },
        getWXContext() { return { OPENID: 'host-openid' }; }
      };
    }
    if (request === '@cardboard/room-application') {
      return {
        createRoomApplication() {
          return { executeCommand: async (command) => validateCommandEnvelope(command) };
        }
      };
    }
    if (request === '@cardboard/room-cloudbase-adapter') {
      return { createCloudBaseRoomRepository() { return {}; } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[entryPath];
  try {
    return await require(entryPath).main(event);
  } finally {
    Module._load = originalLoad;
    delete require.cache[entryPath];
  }
}

function createRoomCommand(extra = {}) {
  return {
    protocolVersion: 3,
    commandId: 'create-room-1',
    roomId: '',
    knownSeq: 0,
    type: 'CREATE_ROOM',
    context: {},
    payload: { nickName: '房主' },
    clientSentAt: 1,
    ...extra
  };
}

test('roomCommand removes CloudBase metadata before validating a direct command event', async () => {
  const result = await invokeRoomCommand(createRoomCommand({
    tcbContext: { env: 'shared-cloud-environment' },
    userInfo: { appId: 'resource-app-id', openId: 'host-openid' }
  }));

  assert.equal(result.ok, true, result.errMsg);
});

test('roomCommand still rejects unknown client command fields', async () => {
  const result = await invokeRoomCommand({
    command: createRoomCommand({ unexpectedClientField: true }),
    tcbContext: { env: 'shared-cloud-environment' },
    userInfo: { appId: 'resource-app-id', openId: 'host-openid' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errMsg, 'command.unexpectedClientField 是未知字段');
});

test('roomCommand ignores arbitrary platform metadata outside the wrapped command', async () => {
  const result = await invokeRoomCommand({
    command: createRoomCommand(),
    tcbContext: { env: 'shared-cloud-environment' },
    userInfo: { appId: 'resource-app-id', openId: 'host-openid' },
    futureCloudMetadata: { traceId: 'trace-1' }
  });

  assert.equal(result.ok, true, result.errMsg);
});
