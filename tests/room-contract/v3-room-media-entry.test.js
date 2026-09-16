'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const ALLOWED_AVATAR = 'cloud://test-env/avatars/allowed.png';
const ALLOWED_ARTIFACT = 'cloud://test-env/artifacts/allowed.png';
const PRIVATE_FILE = 'cloud://test-env/private/not-in-view.png';

async function invokeRoomMedia({ event, openid = 'member-openid', roomApp }) {
  const originalLoad = Module._load;
  const entryPath = require.resolve('../../cloudfunctions/roomMedia/src/entry');
  const tempFileUrlCalls = [];

  Module._load = function loadWithCloudMocks(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return {}; },
        getWXContext() { return { OPENID: openid }; },
        async getTempFileURL(args) {
          tempFileUrlCalls.push(args);
          return {
            fileList: args.fileList.map((fileID) => ({
              fileID,
              tempFileURL: `https://example.test/${encodeURIComponent(fileID)}`,
              status: 0
            }))
          };
        }
      };
    }
    if (request === '@cardboard/room-application') {
      return { createRoomApplication() { return roomApp; } };
    }
    if (request === '@cardboard/room-cloudbase-adapter') {
      return {
        COLLECTIONS: { media: 'roomV3Media' },
        createCloudBaseRoomRepository() { return {}; },
        docId(value) { return value; },
        async safeGet() { return null; }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[entryPath];
  try {
    const result = await require(entryPath).main(event);
    return { result, tempFileUrlCalls };
  } finally {
    Module._load = originalLoad;
    delete require.cache[entryPath];
  }
}

function authorizedRoomApp() {
  return {
    async readCurrentRoom() {
      return { ok: true, roomId: '12345678', membershipId: 'member-1' };
    },
    async readSnapshot() {
      return {
        ok: true,
        view: {
          room: { members: [{ avatarRef: ALLOWED_AVATAR }] },
          session: { activeArtifacts: [{ fileRef: ALLOWED_ARTIFACT }] }
        }
      };
    }
  };
}

test('roomMedia tempUrls 只签名当前 MemberView 中可见的文件', async () => {
  const { result, tempFileUrlCalls } = await invokeRoomMedia({
    event: { action: 'tempUrls', fileList: [ALLOWED_AVATAR, ALLOWED_ARTIFACT] },
    roomApp: authorizedRoomApp()
  });

  assert.equal(result.ok, true, result.errMsg);
  assert.deepEqual(tempFileUrlCalls, [{ fileList: [ALLOWED_AVATAR, ALLOWED_ARTIFACT] }]);
});

test('roomMedia tempUrls 拒绝签名 MemberView 之外的任意云文件', async () => {
  const { result, tempFileUrlCalls } = await invokeRoomMedia({
    event: { action: 'tempUrls', fileList: [PRIVATE_FILE] },
    roomApp: authorizedRoomApp()
  });

  assert.equal(result.ok, false);
  assert.equal(result.errCode, 'INVALID_ARGUMENT');
  assert.equal(tempFileUrlCalls.length, 0);
});

test('roomMedia tempUrls 要求有效微信身份', async () => {
  const { result, tempFileUrlCalls } = await invokeRoomMedia({
    event: { action: 'tempUrls', fileList: [ALLOWED_AVATAR] },
    openid: '',
    roomApp: authorizedRoomApp()
  });

  assert.equal(result.ok, false);
  assert.equal(result.errCode, 'UNAUTHENTICATED');
  assert.equal(tempFileUrlCalls.length, 0);
});

test('roomMedia tempUrls 要求调用者当前仍是房间成员', async () => {
  const roomApp = authorizedRoomApp();
  roomApp.readCurrentRoom = async () => ({ ok: true, roomId: null, membershipId: null });
  const { result, tempFileUrlCalls } = await invokeRoomMedia({
    event: { action: 'tempUrls', fileList: [ALLOWED_AVATAR] },
    roomApp
  });

  assert.equal(result.ok, false);
  assert.equal(result.errCode, 'NOT_MEMBER');
  assert.equal(tempFileUrlCalls.length, 0);
});
