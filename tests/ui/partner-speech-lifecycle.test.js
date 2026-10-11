'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPartnerSpeechSink } = require('../../modules/room-session/partner-speech');

// 设备生命周期/旧页回调在 partner-audio.test.js 覆盖；此处验证真实转写入房间的边界。
function harness(options = {}) {
  const original = global.getApp;
  const uploads = [], calls = [], commands = [];
  const app = { globalData: { cloudReady: options.ready,
    cloud: { uploadFile: async (request) => { uploads.push(request);
      return { fileID: options.noFile ? '' : 'file-id' }; } },
    roomSession: { roomId: '12345678', getView: () => ({ session: {
      sessionId: 'new-session', workflow: { step: 'PARTNER_TURN' }, activeTurn: { turnId: 'new-turn' }
    } }),
      getRequestContext: () => ({ deviceId: 'test-device' }),
      dispatch: async (command) => { commands.push(command);
        return options.commandResult || { ok: true }; } }
  } };
  global.getApp = () => app;
  const api = { cloud: { callFunction: async (request) => { calls.push(request);
    return { result: options.result || { ok: true, text: '  本段纪要  ', fileRef: 'recognized-file' } }; } } };
  return { app, uploads, calls, commands, sink: createPartnerSpeechSink(api),
    restore: () => { global.getApp = original; } };
}

const context = Object.freeze({ roomId: '12345678', sessionId: 'old-session', turnId: 'old-turn',
  workflowStep: 'PARTNER_STATEMENT', phase: 'discussion' });

test('等待云初始化，再按冻结的讨论作用域上传/转写/提交，绝不借用当前 Turn', async () => {
  let ready;
  const h = harness({ ready: new Promise((resolve) => { ready = resolve; }) });
  try {
    const pending = h.sink(context, '/tmp/segment.mp3');
    assert.deepEqual(h.uploads, []);
    ready();
    assert.equal(await pending, '本段纪要');
    assert.equal(h.uploads[0].filePath, '/tmp/segment.mp3');
    assert.match(h.uploads[0].cloudPath, /^partner-voice\/12345678\/.+\.mp3$/);
    assert.deepEqual(h.calls[0], { name: 'speechToText', data: {
      roomId: context.roomId, sessionId: context.sessionId, turnId: context.turnId,
      fileID: 'file-id', phase: 'discussion', clientContext: { deviceId: 'test-device' }
    } });
    assert.equal(h.commands[0].type, 'APPEND_ARTIFACT');
    assert.equal(h.commands[0].payload.kind, 'VOICE');
    assert.equal(h.commands[0].payload.fileRef, 'recognized-file');
    assert.equal(h.commands[0].context.sessionId, context.sessionId);
    assert.equal(h.commands[0].context.turnId, context.turnId);
    assert.equal(h.commands[0].context.workflowStep, context.workflowStep);
  } finally { h.restore(); }
});

for (const [name, options, error, calls, commands] of [
  ['上传没有 fileID', { noFile: true }, '上传录音失败', 0, 0],
  ['识别失败', { result: { ok: false, errMsg: '识别失败' } }, '识别失败', 1, 0],
  ['旧作用域入房间被拒绝', { commandResult: { ok: false, errMsg: '作用域已失效' } }, '作用域已失效', 1, 1]
]) {
  test(`转写边界：${name} 不报告成功或改用新作用域`, async () => {
    const h = harness(options);
    try {
      await assert.rejects(h.sink(context, '/tmp/segment.mp3'), new RegExp(error));
      assert.equal(h.calls.length, calls); assert.equal(h.commands.length, commands);
      if (commands) assert.equal(h.commands[0].context.turnId, 'old-turn');
    } finally { h.restore(); }
  });
}

test('空转写文本不提交 Artifact；识别未提供 fileRef 时使用上传的 fileID', async () => {
  const empty = harness({ result: { ok: true, text: '  ' } });
  try {
    assert.equal(await empty.sink(context, '/tmp/segment.mp3'), '');
    assert.deepEqual(empty.commands, []);
  } finally { empty.restore(); }
  const h = harness({ result: { ok: true, text: '纪要' } });
  try {
    await h.sink(context, '/tmp/segment.mp3');
    assert.equal(h.commands[0].payload.fileRef, 'file-id');
  } finally { h.restore(); }
});

test('云开发未初始化不上传、不调用识别、不提交 Command', async () => {
  const h = harness();
  try {
    h.app.globalData.cloud = null;
    await assert.rejects(h.sink(context, '/tmp/segment.mp3'), /云开发未初始化/);
    assert.deepEqual(h.uploads, []); assert.deepEqual(h.calls, []); assert.deepEqual(h.commands, []);
  } finally { h.restore(); }
});
