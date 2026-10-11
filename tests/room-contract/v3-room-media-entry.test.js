'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const ALLOWED_AVATAR = 'cloud://test-env/avatars/allowed.png';
const ALLOWED_ARTIFACT = 'cloud://test-env/artifacts/allowed.png';
const PRIVATE_FILE = 'cloud://test-env/private/not-in-view.png';

async function invokeRoomMedia({ event, openid = 'member-openid', roomApp, media = null, effects = [], io = {} }) {
  const originalLoad = Module._load;
  const entryPath = require.resolve('../../cloudfunctions/roomMedia/src/entry');
  const tempFileUrlCalls = [];

  Module._load = function loadWithCloudMocks(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { collection: () => ({ doc: () => ({
          set: async ({ data }) => {
            effects.push(['save', data]);
            if (io.save) return io.save(data);
          }
        }) }) }; },
        openapi: { wxacode: { getUnlimited: async () => {
          effects.push(['generate']); return { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
        } } },
        async uploadFile() { effects.push(['upload']); return { fileID: ALLOWED_AVATAR }; },
        getWXContext() { return { OPENID: openid }; },
        async getTempFileURL(args) {
          effects.push(['tempUrl']);
          tempFileUrlCalls.push(args);
          if (io.tempUrl) return io.tempUrl(args);
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
        async safeGet() {
          effects.push(['readMedia']);
          return io.readMedia ? io.readMedia() : media;
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[entryPath];
  try {
    const result = await require(entryPath).main(event);
    return { result, tempFileUrlCalls, effects };
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

test('二维码使用轻量成员授权：房主可生成，普通成员只能读缓存', async () => {
  for (const role of ['HOST', 'MEMBER']) {
    for (const cached of [false, true]) {
      for (const force of [false, true]) {
        const { result, effects } = await invokeRoomMedia({
          event: { action: 'qrcode', roomId: '12345678', force },
          media: cached ? { fileRef: ALLOWED_AVATAR } : null,
          roomApp: { readRoomAccess: async () => ({ ok: true, role }),
            readSnapshot: async () => { throw new Error('不应重建 Snapshot'); } }
        });
        const allowed = role === 'HOST' || (cached && !force);
        assert.equal(result.ok, allowed, `${role}, cached=${cached}, force=${force}`);
        assert.equal(effects.some(([kind]) => kind === 'generate'), allowed && (!cached || force));
        if (!allowed) assert.equal(result.errCode, 'HOST_REQUIRED');
      }
    }
  }
});

test('非成员不可读取缓存二维码或生成文件', async () => {
  const { result, effects, tempFileUrlCalls } = await invokeRoomMedia({
    event: { action: 'qrcode', roomId: '12345678' }, media: { fileRef: ALLOWED_AVATAR },
    roomApp: { readRoomAccess: async () => ({ ok: false, errCode: 'NOT_MEMBER' }) }
  });
  assert.equal(result.errCode, 'NOT_MEMBER');
  assert.deepEqual(effects, [['readMedia']], '可预读缓存，但授权前不能生成、上传、签名或返回缓存');
  assert.deepEqual(tempFileUrlCalls, []);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('二维码授权与缓存读取并行，授权成功前不签名或生成', async () => {
  const authorization = deferred();
  const cache = deferred();
  const effects = [];
  const request = invokeRoomMedia({
    event: { action: 'qrcode', roomId: '12345678' }, effects,
    roomApp: { readRoomAccess: () => { effects.push(['authorize']); return authorization.promise; } },
    io: { readMedia: () => cache.promise }
  });
  try {
    await flush();
    assert.deepEqual(effects, [['authorize'], ['readMedia']]);
    cache.resolve({ fileRef: ALLOWED_AVATAR });
    await flush();
    assert.equal(effects.some(([stage]) => stage === 'tempUrl'), false);
    authorization.resolve({ ok: true, role: 'MEMBER' });
    assert.equal((await request).result.ok, true);
  } finally {
    authorization.resolve({ ok: false, errCode: 'NOT_MEMBER' });
    cache.resolve(null);
    await request;
  }
});

test('缓存读取失败不会覆盖非成员权限错误，也不会产生未处理的拒绝', async () => {
  const authorization = deferred();
  const effects = [];
  const request = invokeRoomMedia({
    event: { action: 'qrcode', roomId: '12345678' }, effects,
    roomApp: { readRoomAccess: () => authorization.promise },
    io: { readMedia: async () => { throw new Error('cache unavailable'); } }
  });
  try {
    await flush();
    assert.deepEqual(effects, [['readMedia']]);
    authorization.resolve({ ok: false, errCode: 'NOT_MEMBER' });
    assert.equal((await request).result.errCode, 'NOT_MEMBER');
    assert.equal(effects.some(([stage]) => stage === 'tempUrl' || stage === 'generate'), false);
  } finally {
    authorization.resolve({ ok: false, errCode: 'NOT_MEMBER' });
    await request;
  }
});

for (const first of ['save', 'tempUrl']) {
  test(`二维码上传后缓存写入与签名并行：${first} 先完成仍等待另一项`, async () => {
    const save = deferred();
    const url = deferred();
    const effects = [];
    let finished = false;
    const request = invokeRoomMedia({
      event: { action: 'qrcode', roomId: '12345678' }, effects,
      roomApp: { readRoomAccess: async () => ({ ok: true, role: 'HOST' }) },
      io: { save: () => save.promise, tempUrl: () => url.promise }
    }).then((response) => { finished = true; return response; });
    try {
      await flush();
      assert.deepEqual(effects.map(([stage]) => stage), ['readMedia', 'generate', 'upload', 'save', 'tempUrl']);
      if (first === 'save') save.resolve();
      else url.resolve({ fileList: [{ tempFileURL: 'https://example.test/qr' }] });
      await flush();
      assert.equal(finished, false);
      save.resolve();
      url.resolve({ fileList: [{ tempFileURL: 'https://example.test/qr' }] });
      const response = await request;
      assert.equal(response.result.ok, true);
      assert.equal(response.result.qrcodeUrl, 'https://example.test/qr');
    } finally {
      save.resolve();
      url.resolve({ fileList: [] });
      await request;
    }
  });
}

test('二维码签名失败也等待缓存持久化完成后返回错误', async () => {
  const save = deferred();
  const effects = [];
  let finished = false;
  const request = invokeRoomMedia({
    event: { action: 'qrcode', roomId: '12345678' }, effects,
    roomApp: { readRoomAccess: async () => ({ ok: true, role: 'HOST' }) },
    io: { save: () => save.promise,
      tempUrl: async () => { throw Object.assign(new Error('url unavailable'), { code: 'URL_FAILED' }); } }
  }).then((response) => { finished = true; return response; });
  try {
    await flush();
    assert.equal(effects.some(([stage]) => stage === 'tempUrl'), true);
    assert.equal(finished, false);
    save.resolve();
    assert.equal((await request).result.errCode, 'URL_FAILED');
  } finally {
    save.resolve();
    await request;
  }
});

test('二维码缓存写入失败不能提前返回成功，签名失败时仍保留写入错误优先级', async () => {
  const { result } = await invokeRoomMedia({
    event: { action: 'qrcode', roomId: '12345678' },
    roomApp: { readRoomAccess: async () => ({ ok: true, role: 'HOST' }) },
    io: { save: async () => { throw Object.assign(new Error('save unavailable'), { code: 'SAVE_FAILED' }); },
      tempUrl: async () => { throw new Error('url unavailable'); } }
  });
  assert.equal(result.errCode, 'SAVE_FAILED');
});

test('非法 roomId 在授权与缓存预读之前拒绝', async () => {
  const effects = [];
  const { result } = await invokeRoomMedia({
    event: { action: 'qrcode', roomId: 'bad-id' }, effects,
    roomApp: { readRoomAccess: async () => { effects.push(['authorize']); return { ok: false, errCode: 'INVALID_ARGUMENT' }; } }
  });
  assert.equal(result.errCode, 'INVALID_ARGUMENT');
  assert.deepEqual(effects, []);
});

test('roomMedia 依赖加载失败时返回结构化错误', async () => {
  const originalLoad = Module._load;
  const entryPath = require.resolve('../../cloudfunctions/roomMedia/src/entry');
  Module._load = function loadMissingSdk(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      throw Object.assign(new Error("Cannot find module 'wx-server-sdk'"), { code: 'MODULE_NOT_FOUND' });
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[entryPath];
  try {
    const result = await require(entryPath).main({ action: 'qrcode', roomId: '12345678' });
    assert.equal(result.ok, false);
    assert.equal(result.errCode, 'MODULE_NOT_FOUND');
  } finally {
    Module._load = originalLoad;
    delete require.cache[entryPath];
  }
});

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

test('roomMedia tempUrls 可按 roomId/sessionId 授权历史 MemberView 中的文件', async () => {
  const calls = [];
  const roomApp = authorizedRoomApp();
  roomApp.readCurrentRoom = async () => ({ ok: true, roomId: null, membershipId: null });
  roomApp.readSessionSnapshot = async (roomId, sessionId, actorContext) => {
    calls.push({ roomId, sessionId, actorContext });
    return {
      ok: true,
      view: {
        room: { members: [{ avatarRef: ALLOWED_AVATAR }] },
        session: { activeArtifacts: [{ fileRef: ALLOWED_ARTIFACT }] }
      }
    };
  };

  const { result, tempFileUrlCalls } = await invokeRoomMedia({
    event: {
      action: 'tempUrls', roomId: '12345678', sessionId: 'session-history',
      fileList: [ALLOWED_ARTIFACT]
    },
    roomApp
  });

  assert.equal(result.ok, true, result.errMsg);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].roomId, '12345678');
  assert.deepEqual(calls[0].sessionId, 'session-history');
  assert.equal(calls[0].actorContext.touchPresence, false);
  assert.deepEqual(tempFileUrlCalls, [{ fileList: [ALLOWED_ARTIFACT] }]);
});
