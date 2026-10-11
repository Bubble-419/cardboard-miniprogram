'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSilentSampler } = require('../../modules/room-session/partner-silent-sound');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const frame = (samples) => ({ frameBuffer: new Int16Array(samples).buffer });

// 授权/所有权/跨页交接在 partner-audio.test.js 覆盖；此处仅验证私有 PCM 策略。
function harness(publish) {
  const levels = [], signals = [];
  let time = 0, live = true;
  const scope = Object.freeze({ roomId: '12345678', sessionId: 'session', turnId: 'turn' });
  const sampler = createSilentSampler({ scope, now: () => time, live: () => live,
    onLevel: (level) => levels.push(level),
    publish: publish || (async (signal) => signals.push(signal)) });
  return { sampler, levels, signals, advance: (ms) => { time += ms; }, hide: () => { live = false; } };
}

test('PCM 近似声级为有限的 0～1：静音为 0，最大振幅不越界', async () => {
  const quiet = harness(), loud = harness();
  quiet.sampler.frame(frame([0, 0])); loud.sampler.frame(frame([32767, -32768])); await flush();
  assert.equal(quiet.levels[0], 0);
  assert.equal(loud.levels[0], 1);
  loud.sampler.frame(frame([0, 0]));
  assert.equal(loud.levels[1], 0.74, '沿用现有平滑效果');
});

test('空帧、非法 PCM 与已撤销作用域不产生声级或广播', async () => {
  const h = harness();
  for (const invalid of [null, {}, frame([]), { frameBuffer: new ArrayBuffer(1) }]) h.sampler.frame(invalid);
  h.hide(); h.sampler.frame(frame([500])); await flush();
  assert.deepEqual(h.levels, []); assert.deepEqual(h.signals, []);
});

test('声级广播使用本段冻结作用域，每 500ms 至多一次', async () => {
  const h = harness();
  h.sampler.frame(frame([500, -500])); await flush();
  h.advance(499); h.sampler.frame(frame([500])); await flush();
  assert.equal(h.signals.length, 1);
  h.advance(1); h.sampler.frame(frame([500])); await flush();
  assert.equal(h.signals.length, 2);
  assert.deepEqual(h.signals[0], { roomId: '12345678', sessionId: 'session', turnId: 'turn',
    signalType: 'PARTNER_SILENT_SOUND', value: h.levels[0] });
});

test('广播单飞；发送失败后下一帧仍可发送，不堆积在途请求', async () => {
  let reject;
  const signals = [];
  const h = harness((signal) => { signals.push(signal); return new Promise((_, fail) => { reject = fail; }); });
  h.sampler.frame(frame([500])); await flush();
  h.advance(1000); h.sampler.frame(frame([500])); await flush();
  assert.equal(signals.length, 1);
  reject(new Error('network')); await flush();
  h.sampler.frame(frame([500])); await flush();
  assert.equal(signals.length, 2);
  reject(new Error('network')); await flush();
});

test('采样后立即离页，排队的广播不再发送', async () => {
  const h = harness();
  h.sampler.frame(frame([500])); h.hide(); await flush();
  assert.equal(h.levels.length, 1);
  assert.deepEqual(h.signals, []);
});
