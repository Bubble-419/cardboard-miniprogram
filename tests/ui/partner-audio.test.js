'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPartnerAudio } = require('../../modules/room-session/partner-audio');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const visible = { visible: true };

function snapshot(mode = 'TRANSCRIPT', turnId = 'turn', overrides = {}) {
  return { roomId: '12345678', roomState: { partnerSilentMode: mode === 'SILENT', partnerSilentStartedAt: 1000 },
    view: { route: { name: 'partnerGame' }, actor: { role: 'HOST', memberId: 'host', ...overrides },
      session: { mode: 'PARTNER', sessionId: 'session', workflow: { step: 'PARTNER_TURN' }, activeTurn: {
        turnId, activeMemberId: 'host', silentStartedAt: 1000, silentDeadlineAt: 301000
      } } } };
}

/** 真实设备接口的可控 Adapter：不自动确认 stop，可注入迟到/超时/同步回调。 */
function harness(options = {}) {
  const events = {}, starts = [], timers = new Map(), statuses = [], signals = [], segments = [], levels = [], texts = [];
  let stops = 0, settings = 0, time = 2000, timerId = 0;
  let occupied = false, stopping = false, started = false;
  const overlaps = [], registrations = {};
  const recorder = {
    onStart: (callback) => { registrations.start = (registrations.start || 0) + 1;
      events.start = () => { started = true; callback(); }; },
    onStop: (callback) => { registrations.stop = (registrations.stop || 0) + 1;
      events.stop = (result) => { occupied = false; stopping = false; started = false; callback(result); }; },
    onError: (callback) => { registrations.error = (registrations.error || 0) + 1; events.error = callback; },
    onFrameRecorded: (callback) => { registrations.frame = (registrations.frame || 0) + 1; events.frame = callback; },
    start(args) { if (occupied) overlaps.push(args); occupied = true; started = false;
      starts.push(args); if (options.startError) {
        if (options.startWithoutDevice) occupied = false;
        throw options.startError;
      }
      if (!options.manualStart) events.start(); },
    stop() { stops += 1; stopping = true;
      if (!started && options.stopBeforeStart) {
        const error = new Error('recorder has not started');
        if (options.stopBeforeStart === 'throw') throw error;
        if (options.stopBeforeStart === 'error') events.error(error);
        return;
      }
      if (options.stopError) throw options.stopError; if (options.syncStop) events.stop({}); }
  };
  const wxApi = { getRecorderManager: () => recorder,
    getSetting(callbacks) { settings += 1;
      if (options.getSetting) options.getSetting(callbacks);
      else callbacks.success({ authSetting: { 'scope.record': true } }); },
    authorize({ fail }) { fail(); }, showModal({ success }) { success({ confirm: false }); } };
  const bindings = [];
  const h = { events, starts, statuses, signals, segments, levels, texts, wxApi,
    formats: () => starts.map((args) => args.format), stats: () => ({ stops, settings }),
    advance: (ms) => { time += ms; },
    isStopping: () => stopping, isOccupied: () => occupied, isRecording: () => started,
    failStartup(error) {
      assert.equal(started, false, '只模拟尚未取得音频轨道的终止启动错误');
      occupied = false;
      events.error(error);
    },
    expire() { const scheduled = [...timers.values()]; timers.clear(); scheduled.forEach((callback) => callback()); },
    create(extra = {}) {
      const binding = createPartnerAudio({ wxApi, transcription: true, now: () => time,
        setTimeoutFn: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeoutFn: (id) => timers.delete(id),
        onStatus: (status) => statuses.push(status), onLevel: (level) => levels.push(level),
        onText: (text) => texts.push(text), publish: async (signal) => signals.push(signal),
        speechSink: async (scope, path) => { segments.push({ scope, path }); return '纪要'; }, ...extra });
      bindings.push(binding);
      return binding;
    },
    async close() {
      bindings.forEach((binding) => binding.dispose()); events.stop?.({}); await flush();
      assert.deepEqual(overlaps, [], '所有测试路径都不允许原生设备重叠 start');
      Object.values(registrations).forEach((count) => assert.equal(count, 1, '每种原生事件只订阅一次'));
    }
  };
  return h;
}

for (const oldMode of ['TRANSCRIPT', 'SILENT']) {
  for (const nextMode of ['TRANSCRIPT', 'SILENT']) {
    for (const [samePage, nextTurn] of [
      [true, 'old-turn'], [true, 'new-turn'], [false, 'old-turn'], [false, 'new-turn']
    ]) {
      test(`${oldMode} → ${nextMode}，同页面=${samePage}/${nextTurn}：停止超时后自动恢复，无须轮询`, async () => {
        const h = harness();
        try {
          const first = h.create();
          first.update(snapshot(oldMode, 'old-turn'), visible); await flush();
          first.update(null, { visible: false });
          if (!samePage) first.dispose();
          const current = samePage ? first : h.create();
          current.update(snapshot(nextMode, nextTurn), visible); await flush();
          h.expire(); await flush();
          assert.deepEqual(h.formats(), [oldMode === 'SILENT' ? 'pcm' : 'mp3']);
          assert.equal(h.stats().stops, 1);
          assert.equal(h.statuses.at(-1).phase, 'blocked');
          h.events.stop({ tempFilePath: '/tmp/old.mp3' }); await flush();
          assert.deepEqual(h.formats(), [oldMode === 'SILENT' ? 'pcm' : 'mp3', nextMode === 'SILENT' ? 'pcm' : 'mp3']);
          assert.deepEqual(h.segments, [], '主动停止的旧部分音频必须丢弃');
          assert.equal(h.statuses.at(-1).phase, 'recording');
          if (nextMode === 'TRANSCRIPT') {
            h.events.stop({ tempFilePath: '/tmp/new.mp3' }); await flush();
            assert.equal(h.segments[0].scope.turnId, nextTurn);
            assert.equal(h.segments[0].path, '/tmp/new.mp3');
            assert.ok(Object.isFrozen(h.segments[0].scope));
          } else {
            h.events.frame({ frameBuffer: new Int16Array([500, -500]).buffer }); await flush();
            assert.equal(h.signals[0].turnId, nextTurn);
          }
        } finally { await h.close(); }
      });
    }
  }
}

test('启动确认迟到：确认超时不伪造失败或停止，原生 onStart 自动完成当前意图', async () => {
  const h = harness({ manualStart: true });
  try {
    const binding = h.create();
    binding.update(snapshot(), visible); await flush();
    h.expire(); await flush();
    assert.equal(h.stats().stops, 0, '启动慢不等于启动失败，不能主动取消仍有效的意图');
    assert.equal(h.statuses.some((status) => status.phase === 'failed'), false);
    h.events.start(); await flush();
    assert.equal(h.statuses.at(-1).phase, 'recording');
    assert.equal(h.starts.length, 1, '无须新 View 或重复 start');
  } finally { await h.close(); }
});

test('start 返回不代表已录音，onStart 才确认；停止期间迟到 onStart 不激活旧 run', async () => {
  const h = harness({ manualStart: true });
  try {
    const binding = h.create();
    binding.update(snapshot('SILENT'), visible); await flush();
    assert.equal(h.statuses.at(-1).phase, 'starting');
    h.events.frame({ frameBuffer: new Int16Array([500]).buffer }); await flush();
    assert.deepEqual(h.signals, []);
    binding.update(snapshot('TRANSCRIPT', 'next-turn'), visible);
    h.events.start(); await flush();
    assert.equal(h.statuses.filter((s) => s.phase === 'recording').length, 0);
    h.events.stop({}); await flush();
    assert.deepEqual(h.formats(), ['pcm', 'mp3']);
    h.events.start();
    assert.equal(h.statuses.at(-1).phase, 'recording');
  } finally { await h.close(); }
});

test('启动中离页的停止失败后，迟到 onStart 收口旧设备并自动交接新页面', async () => {
  const h = harness({ manualStart: true, stopBeforeStart: 'throw', syncStop: true });
  try {
    const old = h.create(), latest = h.create();
    old.update(snapshot(), visible); await flush();
    old.dispose();
    latest.update(snapshot('SILENT', 'next-turn'), visible); await flush();
    h.expire(); await flush();
    assert.deepEqual(h.formats(), ['mp3'], '停止失败/超时都不能释放尚未确认的设备');
    h.events.start(); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'pcm'], '迟到启动确认应重新停止旧设备，无须新 View');
    h.events.start();
    h.events.frame({ frameBuffer: new Int16Array([500]).buffer }); await flush();
    assert.equal(h.isRecording(), true);
    assert.equal(h.signals[0].turnId, 'next-turn');
    assert.deepEqual(h.segments, [], '被撤销的旧录音不得提交纪要');
  } finally { await h.close(); }
});

for (const oldMode of ['TRANSCRIPT', 'SILENT']) {
  for (const failure of ['throw', 'error', 'ignore']) {
    test(`${oldMode} 启动中停止 ${failure}：迟到开始仅补停一次，等真实停止才交接`, async () => {
      const h = harness({ manualStart: true, stopBeforeStart: failure });
      try {
        const old = h.create(), latest = h.create();
        const nextMode = oldMode === 'TRANSCRIPT' ? 'SILENT' : 'TRANSCRIPT';
        old.update(snapshot(oldMode, 'old-turn'), visible); await flush();
        old.dispose();
        latest.update(snapshot(nextMode, 'next-turn'), visible); await flush();
        h.expire(); h.events.start(); await flush();
        assert.equal(h.stats().stops, 2);
        for (let i = 0; i < 3; i += 1) {
          h.events.start(); latest.update(snapshot(nextMode, 'next-turn'), visible);
          h.expire(); await flush();
        }
        assert.equal(h.stats().stops, 2, '重复开始/超时/View 不能形成停止重试循环');
        assert.deepEqual(h.formats(), [oldMode === 'SILENT' ? 'pcm' : 'mp3']);
        h.events.frame({ frameBuffer: new Int16Array([500]).buffer }); await flush();
        assert.deepEqual(h.signals, [], '停止等待期间即使真实设备已启动也不能恢复旧采样');
        h.events.stop({ tempFilePath: '/tmp/cancelled.mp3' }); await flush();
        assert.deepEqual(h.formats(), oldMode === 'SILENT' ? ['pcm', 'mp3'] : ['mp3', 'pcm']);
        assert.deepEqual(h.segments, []);
        h.events.start(); old.dispose(); await flush();
        assert.equal(h.stats().stops, 2, '旧页重复清理不影响新页设备');
        assert.equal(h.statuses.at(-1).phase, 'recording');
      } finally { await h.close(); }
    });
  }
}

test('后台期间迟到开始会停止设备，前台仅在真实停止后恢复同页最新意图', async () => {
  const h = harness({ manualStart: true, stopBeforeStart: 'error' });
  try {
    const binding = h.create();
    binding.update(snapshot(), visible); await flush();
    binding.update(null, { visible: false });
    h.expire(); h.events.start(); await flush();
    assert.equal(h.stats().stops, 2);
    assert.equal(h.statuses.filter((status) => status.phase === 'recording').length, 0);
    binding.update(snapshot(), visible); await flush();
    assert.deepEqual(h.formats(), ['mp3']);
    h.events.stop({ tempFilePath: '/tmp/background.mp3' }); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'mp3']);
    assert.deepEqual(h.segments, []);
    h.events.start();
    assert.equal(h.statuses.at(-1).phase, 'recording');
  } finally { await h.close(); }
});

test('迟到启动的补停再次失败时不抢占、不循环重试，迟到停止仍可交接', async () => {
  const h = harness({ manualStart: true, stopError: new Error('stop failed') });
  try {
    const old = h.create(), latest = h.create();
    old.update(snapshot(), visible); await flush();
    old.dispose(); latest.update(snapshot('SILENT'), visible); await flush();
    h.events.start(); await flush();
    for (let i = 0; i < 3; i += 1) { h.events.start(); h.expire(); await flush(); }
    assert.equal(h.stats().stops, 2);
    assert.deepEqual(h.formats(), ['mp3']);
    h.events.stop({}); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'pcm']);
  } finally { await h.close(); }
});

for (const cancel of ['hidden', 'destroyed', 'waiting', 'history']) {
  test(`迟到开始前最新意图已 ${cancel}：只收口旧设备，不启动已撤销的新意图`, async () => {
    const h = harness({ manualStart: true, stopBeforeStart: 'error' });
    try {
      const old = h.create(), latest = h.create();
      old.update(snapshot(), visible); await flush(); old.dispose();
      latest.update(snapshot('SILENT'), visible); await flush();
      if (cancel === 'destroyed') latest.dispose();
      else if (cancel === 'hidden') latest.update(null, { visible: false });
      else if (cancel === 'history') latest.update(snapshot('SILENT'), { visible: true, history: true });
      else {
        const state = snapshot('SILENT'); state.view.route.name = 'subAwait';
        latest.update(state, visible);
      }
      h.events.start(); await flush();
      assert.equal(h.stats().stops, 2);
      h.events.stop({ tempFilePath: '/tmp/cancelled.mp3' }); await flush();
      assert.deepEqual(h.formats(), ['mp3']);
      assert.equal(h.isOccupied(), false);
      assert.deepEqual(h.segments, []);
    } finally { await h.close(); }
  });
}

test('等待停止期间连续更换意图，只启动最后一个可见绑定；旧页 dispose 不能停止新页', async () => {
  const h = harness();
  try {
    const first = h.create(), middle = h.create(), latest = h.create();
    first.update(snapshot('TRANSCRIPT', 'first'), visible); await flush();
    middle.update(snapshot('SILENT', 'middle'), visible);
    latest.update(snapshot('TRANSCRIPT', 'latest'), visible); await flush();
    h.expire(); h.events.stop({}); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'mp3']);
    first.dispose(); middle.dispose(); await flush();
    assert.equal(h.stats().stops, 1);
    h.events.stop({ tempFilePath: '/tmp/latest.mp3' }); await flush();
    assert.equal(h.segments[0].scope.turnId, 'latest');
  } finally { await h.close(); }
});

for (const cancel of ['hidden', 'destroyed', 'external', 'history', 'waiting', 'closing']) {
  test(`停止等待时 ${cancel}：迟到确认不应再次启动录音`, async () => {
    const h = harness();
    try {
      const binding = h.create();
      binding.update(snapshot(), visible); await flush();
      binding.update(snapshot('SILENT', 'next'), visible);
      const next = snapshot('SILENT', 'next');
      if (cancel === 'destroyed') binding.dispose();
      else if (cancel === 'hidden') binding.update(next, { visible: false });
      else if (cancel === 'history') binding.update(next, { visible: true, history: true });
      else { next.view.route.name = { waiting: 'subAwait', closing: 'closingStatement', external: 'room' }[cancel];
        binding.update(next, visible); }
      h.expire(); h.events.stop({ tempFilePath: '/tmp/old.mp3' }); await flush();
      assert.deepEqual(h.formats(), ['mp3']);
      assert.deepEqual(h.segments, []);
    } finally { await h.close(); }
  });
}

test('迟到授权、跨页面授权单飞和取消后的新意图都在同一控制器内处理', async () => {
  const grants = [];
  const h = harness({ getSetting: (callbacks) => grants.push(callbacks.success) });
  try {
    const first = h.create(), next = h.create();
    first.update(snapshot(), visible); await flush();
    first.dispose(); next.update(snapshot('SILENT', 'new'), visible); await flush();
    assert.equal(h.stats().settings, 1, '不同时弹出两次授权');
    grants[0]({ authSetting: { 'scope.record': true } }); await flush();
    assert.equal(h.stats().settings, 2);
    assert.deepEqual(h.formats(), []);
    grants[1]({ authSetting: { 'scope.record': true } }); await flush();
    assert.deepEqual(h.formats(), ['pcm']);
  } finally { await h.close(); }
});

test('授权被拒绝不随 View/前后台重复弹窗，设备失败不随 View 重试', async () => {
  const denied = harness({ getSetting: ({ success }) => success({ authSetting: { 'scope.record': false } }) });
  try {
    const binding = denied.create(), state = snapshot('SILENT');
    binding.update(state, visible); await flush();
    binding.update(state, { visible: false }); binding.update(state, visible); await flush();
    assert.equal(denied.stats().settings, 1);
    assert.deepEqual(denied.formats(), []);
  } finally { await denied.close(); }
  const h = harness();
  try {
    const binding = h.create();
    binding.update(snapshot(), visible); await flush();
    h.events.error(new Error('no microphone')); h.events.stop({});
    for (let i = 0; i < 5; i += 1) binding.update(snapshot(), visible);
    await flush();
    assert.deepEqual(h.formats(), ['mp3']);
    binding.update(snapshot('TRANSCRIPT', 'next-turn'), visible); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'mp3'], '新的作用域可重试设备，非每次 View');
    h.events.error(new Error('no microphone')); h.events.stop({});
    binding.update(null, { visible: false }); binding.update(snapshot('TRANSCRIPT', 'next-turn'), visible); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'mp3', 'mp3'], '新的可见生命周期也可重试设备');
  } finally { await h.close(); }
});

for (const mode of ['TRANSCRIPT', 'SILENT']) {
  test(`${mode} 启动 NotFoundError 且没有 onStop：不进入停止等待，前后台恢复可重新录音`, async () => {
    const h = harness({ manualStart: true, stopBeforeStart: 'error' });
    try {
      const binding = h.create(), state = snapshot(mode);
      binding.update(state, visible); await flush();
      h.failStartup({ errMsg: 'operateRecorder:fail NotFoundError' }); await flush();
      h.expire(); await flush();
      assert.equal(h.stats().stops, 0, '未获得设备的启动失败不应再调用 stop');
      assert.equal(h.statuses.at(-1).phase, 'failed');
      assert.equal(h.statuses.some((status) => status.phase === 'blocked'), false);
      for (let i = 0; i < 3; i += 1) binding.update(state, visible);
      await flush();
      assert.equal(h.starts.length, 1, '相同 View 不应循环重试不可用设备');
      binding.update(null, { visible: false }); binding.update(state, visible); await flush();
      assert.equal(h.starts.length, 2, '新的前台周期不应等待不存在的 onStop');
      h.events.start();
      assert.equal(h.statuses.at(-1).phase, 'recording');
    } finally { await h.close(); }
  });
}

for (const samePage of [true, false]) {
  test(`未启动旧 run 被撤销后才收到 NotFoundError，同页面=${samePage}：只协调最新意图`, async () => {
    const h = harness({ manualStart: true });
    try {
      const old = h.create(), latest = samePage ? old : h.create();
      old.update(snapshot(), visible); await flush();
      if (!samePage) old.dispose();
      latest.update(snapshot('SILENT', 'latest'), visible); await flush();
      h.failStartup({ errMsg: 'operateRecorder:fail NotFoundError' }); await flush();
      assert.deepEqual(h.formats(), ['mp3', 'pcm'], '旧失败不得给最新意图设置 failed');
      const stops = h.stats().stops;
      h.events.start();
      if (!samePage) old.dispose();
      h.events.frame({ frameBuffer: new Int16Array([500]).buffer }); await flush();
      assert.equal(h.stats().stops, stops, '旧失败/清理不额外停止新设备');
      assert.equal(h.signals[0].turnId, 'latest');
      assert.deepEqual(h.segments, []);
    } finally { await h.close(); }
  });
}

test('终止启动错误的通知同步切换意图：不会污染新 run，也不会重新停止旧 run', async () => {
  const h = harness({ manualStart: true }); let binding;
  try {
    binding = h.create({ onStatus(status) {
      h.statuses.push(status);
      if (status.phase === 'failed') binding.update(snapshot('SILENT', 'latest'), visible);
    } });
    binding.update(snapshot(), visible); await flush();
    h.failStartup({ errMsg: 'operateRecorder:fail NotFoundError' }); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'pcm']);
    assert.equal(h.stats().stops, 0);
    h.events.start();
    assert.equal(h.statuses.at(-1).phase, 'recording');
  } finally { await h.close(); }
});

test('原生启动同步抛出未取得设备的错误：结束失败 run，无须等待 onStop', async () => {
  const options = { manualStart: true, startWithoutDevice: true,
    startError: new DOMException('没有可用麦克风', 'NotFoundError') };
  const h = harness(options);
  try {
    const binding = h.create();
    binding.update(snapshot(), visible); await flush(); h.expire();
    assert.equal(h.statuses.at(-1).phase, 'failed');
    assert.equal(h.stats().stops, 0);
    options.startError = null;
    binding.update(snapshot('SILENT', 'next'), visible); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'pcm']);
    h.events.start();
    assert.equal(h.statuses.at(-1).phase, 'recording');
  } finally { await h.close(); }
});

test('原生启动 NotAllowedError：保留失败状态但不制造停止超时，也不随 View 重试', async () => {
  const h = harness({ manualStart: true });
  try {
    const binding = h.create(), state = snapshot();
    binding.update(state, visible); await flush();
    h.failStartup({ errMsg: 'operateRecorder:fail NotAllowedError' });
    binding.update(state, visible); await flush(); h.expire();
    assert.equal(h.stats().stops, 0);
    assert.equal(h.starts.length, 1);
    assert.equal(h.statuses.at(-1).phase, 'failed');
  } finally { await h.close(); }
});

for (const [started, error] of [
  [true, { errMsg: 'operateRecorder:fail NotFoundError' }],
  [false, { errMsg: 'operateRecorder:fail stop failed NotFoundError' }],
  [false, { errMsg: 'operateRecorder:fail unknown error' }]
]) {
  test(`非终止启动错误，已开始=${started}/${error.errMsg}：仍等待原生停止确认`, async () => {
    const h = harness({ manualStart: !started });
    try {
      const binding = h.create();
      binding.update(snapshot(), visible); await flush();
      h.events.error(error); binding.update(snapshot('SILENT', 'next'), visible); await flush();
      h.expire(); await flush();
      assert.equal(h.stats().stops, 1);
      assert.deepEqual(h.formats(), ['mp3']);
      h.events.stop({}); await flush();
      assert.deepEqual(h.formats(), ['mp3', 'pcm']);
    } finally { await h.close(); }
  });
}

for (const failure of ['error', 'throw', 'startTimeout']) {
  test(`原生 ${failure} 不是停止确认，迟到 onStop 前不能让新页抢占设备`, async () => {
    const h = harness({ stopError: failure === 'throw' ? new Error('stop failed') : null,
      manualStart: failure === 'startTimeout' });
    try {
      const first = h.create(), next = h.create();
      first.update(snapshot(), visible); await flush();
      if (failure === 'startTimeout') h.expire();
      next.update(snapshot('SILENT', 'new'), visible); await flush();
      if (failure === 'error') h.events.error(new Error('stop failed'));
      assert.deepEqual(h.formats(), ['mp3']);
      h.events.stop({}); await flush();
      assert.deepEqual(h.formats(), ['mp3', 'pcm']);
    } finally { await h.close(); }
  });
}

test('Snapshot/Event 和校时更新不重启采样，单一监听、声级单飞限流、截止后不发送', async () => {
  let finishPublish;
  const h = harness(), binding = h.create({ publish: (signal) => {
    h.signals.push(signal); return new Promise((resolve) => { finishPublish = resolve; });
  } });
  try {
    const state = snapshot('SILENT');
    binding.update(state, visible); await flush();
    const revised = structuredClone(state); revised.roomState.partnerSilentStartedAt += 20;
    binding.update(revised, visible); await flush();
    const frame = { frameBuffer: new Int16Array([500, -500]).buffer };
    h.events.frame(frame); await flush(); h.advance(600); h.events.frame(frame); await flush();
    assert.equal(h.signals.length, 1, '上传未结束不能堆积下一次广播');
    finishPublish(); await flush(); h.events.frame(frame); await flush();
    assert.equal(h.signals.length, 2);
    assert.ok(binding.getLevel() > 0 && binding.getLevel() <= 1);
    assert.equal(h.starts.length, 1);
    finishPublish(); h.advance(301000); h.events.frame(frame); await flush();
    assert.equal(h.signals.length, 2);
    assert.equal(binding.getLevel(), null);
    assert.equal(h.stats().stops, 1);
  } finally { finishPublish?.(); await h.close(); }
});

for (const role of ['HOST', 'MEMBER']) {
  for (const current of [true, false]) {
    test(`静默角色矩阵 ${role}/行动者=${current}：只有行动者发送声级`, async () => {
      const h = harness();
      try {
        const binding = h.create({ transcription: false });
        binding.update(snapshot('SILENT', 'turn', { role, memberId: current ? 'host' : 'other' }), visible);
        await flush();
        h.events.frame?.({ frameBuffer: new Int16Array([500]).buffer }); await flush();
        assert.equal(h.starts.length, current ? 1 : 0);
        assert.equal(h.signals.length, current ? 1 : 0);
      } finally { await h.close(); }
    });
  }
}

test('自然纪要上传使用不可变 run 上下文；离页期间完成的上传不得刷新旧页面', async () => {
  const h = harness(); let finish;
  try {
    const binding = h.create({ speechSink: (scope, path) => {
      h.segments.push({ scope, path }); return new Promise((resolve) => { finish = resolve; });
    } });
    const state = snapshot(); binding.update(state, visible); await flush();
    h.events.stop({ tempFilePath: '/tmp/natural.mp3' }); await flush();
    assert.equal(h.starts.length, 1, '同一作用域分段等待转写，不堆积上传');
    state.view.session.activeTurn.turnId = 'next-turn'; binding.update(state, visible); await flush();
    assert.equal(h.starts.length, 2);
    binding.dispose(); finish('旧段纪要'); await flush();
    assert.equal(h.segments[0].scope.turnId, 'turn');
    assert.equal(h.segments[0].scope.workflowStep, 'PARTNER_TURN');
    assert.deepEqual(h.texts, []);
    assert.equal(h.starts.length, 2);
  } finally { await h.close(); }
});

test('转写失败后仍自动续录，但旧作用域上传失败不得唤醒已销毁页面', async () => {
  const h = harness();
  try {
    const binding = h.create({ speechSink: async () => { throw new Error('转写失败'); } });
    binding.update(snapshot(), visible); await flush();
    h.events.stop({ tempFilePath: '/tmp/segment.mp3' }); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'mp3']);
    assert.ok(h.statuses.some((status) => status.phase === 'uploadFailed'));
  } finally { await h.close(); }
});

test('同步 stop 回调和 start 抛错不造成双所有者或每轮 View 无限重启', async () => {
  const h = harness({ syncStop: true });
  try {
    const binding = h.create();
    binding.update(snapshot(), visible); await flush();
    binding.update(snapshot('SILENT'), visible); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'pcm']);
    assert.equal(h.stats().stops, 1);
  } finally { await h.close(); }
  const failed = harness({ syncStop: true, startError: new Error('no microphone') });
  try {
    const binding = failed.create();
    for (let i = 0; i < 5; i += 1) { binding.update(snapshot(), visible); await flush(); }
    assert.deepEqual(failed.formats(), ['mp3']);
    assert.ok(failed.statuses.some((status) => status.phase === 'failed'));
  } finally { await failed.close(); }
});

function loadPage(kind) {
  const original = global.Page;
  let definition;
  const file = require.resolve(`../../pages/main-pages/partnerMode/${kind}/index`);
  global.Page = (value) => { definition = value; };
  try { delete require.cache[file]; require(file); }
  finally { delete require.cache[file]; global.Page = original; }
  return { ...definition, _pageVisible: true, data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); } };
}

test('原始跨实例复现：旧 PCM 页面销毁、全新 gamepage 等待超时，迟到确认自动恢复纪要', async () => {
  const h = harness();
  const previousWx = global.wx;
  let page;
  try {
    const old = h.create({ transcription: false });
    old.update(snapshot('SILENT', 'old-turn'), visible); await flush();
    old.dispose();
    global.wx = h.wxApi;
    page = loadPage('gamepage');
    page._syncPartnerAudio(snapshot('TRANSCRIPT', 'new-turn')); await flush();
    h.expire(); await flush();
    assert.deepEqual(h.formats(), ['pcm']);
    // 不调用任何 page/RoomQuery 方法，仅原生确认应推进待启动意图。
    h.events.stop({ tempFilePath: '/tmp/old.mp3' }); await flush();
    assert.deepEqual(h.formats(), ['pcm', 'mp3']);
    old.dispose(); await flush();
    assert.equal(h.stats().stops, 1);
  } finally { page?._partnerAudio?.dispose(); await h.close(); global.wx = previousWx; }
});

test('真实 gamepage 与特殊行动页双向交接；叠层暂停后下层不等待额外 View 恢复', async () => {
  const h = harness();
  const previousWx = global.wx;
  let game, special;
  try {
    // 先创建真实控制器，以 fake timer 控制其所有原生确认期限。
    const seed = h.create(); seed.update(snapshot(), visible); await flush(); seed.dispose(); h.events.stop({});
    global.wx = h.wxApi;
    game = loadPage('gamepage'); special = loadPage('specialMove');
    const state = snapshot(); game._syncPartnerAudio(state); await flush();
    game._pageVisible = false; game._suspendPartnerAudio();
    const silent = snapshot('SILENT');
    const start = Date.now() - 1000;
    silent.roomState.partnerSilentStartedAt = start;
    silent.view.session.activeTurn.silentStartedAt = start;
    silent.view.session.activeTurn.silentDeadlineAt = start + 300000;
    special._startSoundLevelSampling(silent); await flush();
    h.expire(); h.events.stop({}); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'mp3', 'pcm']);
    special._pageVisible = false; special._stopSoundLevelSampling();
    game._pageVisible = true; game._syncPartnerAudio(state); await flush();
    h.expire(); h.events.stop({}); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'mp3', 'pcm', 'mp3']);
    special._partnerAudio.dispose(); await flush();
    assert.equal(h.stats().stops, 3, '旧叠层清理不得停止下层新录音');
  } finally {
    game?._partnerAudio?.dispose(); special?._partnerAudio?.dispose(); await h.close(); global.wx = previousWx;
  }
});

test('真实转写 pipeline 只用冻结的 phase/session/turn，并通过 V3 Artifact Command 入房间', async () => {
  const h = harness();
  const previousWx = global.wx, previousGetApp = global.getApp;
  const uploads = [], calls = [], commands = [];
  try {
    h.wxApi.cloud = { callFunction: async (request) => {
      calls.push(request); return { result: { ok: true, text: '完整转写', fileRef: 'file-id' } };
    } };
    global.wx = h.wxApi;
    global.getApp = () => ({ globalData: {
      cloud: { uploadFile: async (request) => { uploads.push(request); return { fileID: 'file-id' }; } },
      roomSession: { roomId: '12345678', getRequestContext: () => ({}),
        dispatch: async (command) => { commands.push(command); return { ok: true }; } }
    } });
    const binding = h.create({ speechSink: undefined });
    const state = snapshot(); state.view.session.workflow.step = 'PARTNER_STATEMENT';
    binding.update(state, visible); await flush();
    h.events.stop({ tempFilePath: '/tmp/discussion.mp3' }); await flush();
    assert.equal(uploads[0].filePath, '/tmp/discussion.mp3');
    assert.equal(calls[0].name, 'speechToText');
    assert.equal(calls[0].data.phase, 'discussion');
    assert.equal(calls[0].data.turnId, 'turn');
    assert.equal(commands[0].type, 'APPEND_ARTIFACT');
    assert.equal(commands[0].payload.text, '完整转写');
    assert.deepEqual(commands[0].context, { sessionId: 'session', turnId: 'turn', workflowStep: 'PARTNER_STATEMENT' });
  } finally { await h.close(); global.wx = previousWx; global.getApp = previousGetApp; }
});

test('200 步确定性生命周期轨迹：任意旧页清理/多次 supersede/超时均不丢最新意图或重叠 start', async () => {
  const h = harness(), pages = [h.create(), h.create(), h.create()];
  let seed = 1701, desired = null;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  try {
    for (let i = 0; i < 200; i += 1) {
      const index = random() % pages.length;
      const op = random() % 5;
      if (op < 3) {
        const mode = random() % 2 === 0 ? 'TRANSCRIPT' : 'SILENT';
        pages[index].update(snapshot(mode, `turn-${i}`), visible);
        desired = { index, mode };
      } else {
        if (desired && desired.index === index) desired = null;
        if (op === 3) pages[index].update(null, { visible: false });
        else { pages[index].dispose(); pages[index] = h.create(); }
      }
      await flush();
      if (h.isStopping() && random() % 3 === 0) h.expire();
      if (h.isStopping() && random() % 2 === 0) {
        h.events.stop({ tempFilePath: '/tmp/cancelled.mp3' }); await flush();
        assert.equal(h.isOccupied(), !!desired);
        if (desired) assert.equal(h.formats().at(-1), desired.mode === 'SILENT' ? 'pcm' : 'mp3');
      }
    }
    if (h.isStopping()) { h.events.stop({}); await flush(); }
    assert.equal(h.isOccupied(), !!desired);
    assert.deepEqual(h.segments, [], '所有轨迹中的手动停止都不能提交部分旧纪要');
  } finally { await h.close(); }
});

test('UI hook 同步撤销启动意图时不调用原生设备，也不永久等待不存在的停止确认', async () => {
  const h = harness(); let binding;
  try {
    binding = h.create({ onStatus: (status) => {
      if (status.phase === 'starting') binding.dispose();
    } });
    binding.update(snapshot(), visible); await flush();
    assert.deepEqual(h.formats(), []);
    assert.equal(h.stats().stops, 0);
    const next = h.create(); next.update(snapshot('SILENT'), visible); await flush();
    assert.deepEqual(h.formats(), ['pcm']);
  } finally { await h.close(); }
});

test('错误 hook 同步销毁旧页并确认停止后，不抛错、不重复停止新页', async () => {
  const h = harness({ syncStop: true });
  let old;
  try {
    const latest = h.create();
    old = h.create({ onStatus: (status) => {
      if (status.phase === 'failed') {
        old.dispose();
        latest.update(snapshot('SILENT', 'next-turn'), visible);
      }
    } });
    old.update(snapshot(), visible); await flush();
    assert.doesNotThrow(() => h.events.error(new Error('microphone failed')),
      '错误通知允许同步撤销所有者，返回后必须重新检查资源归属');
    await flush();
    assert.deepEqual(h.formats(), ['mp3', 'pcm']);
    assert.equal(h.stats().stops, 1, '旧错误回调不能重复 stop 或影响新设备');
    h.events.frame({ frameBuffer: new Int16Array([500]).buffer }); await flush();
    assert.equal(h.signals[0].turnId, 'next-turn');
    assert.deepEqual(h.segments, []);
  } finally { await h.close(); }
});

test('错误 hook 同步切换同页意图时，旧错误回调不干扰新 PCM', async () => {
  const h = harness({ syncStop: true });
  let binding;
  try {
    binding = h.create({ onStatus: (status) => {
      if (status.phase === 'failed') binding.update(snapshot('SILENT', 'next-turn'), visible);
    } });
    binding.update(snapshot(), visible); await flush();
    assert.doesNotThrow(() => h.events.error(new Error('microphone failed')));
    await flush();
    assert.deepEqual(h.formats(), ['mp3', 'pcm']);
    assert.equal(h.stats().stops, 1);
    h.events.frame({ frameBuffer: new Int16Array([500]).buffer }); await flush();
    assert.equal(h.signals[0].turnId, 'next-turn');
  } finally { await h.close(); }
});

test('设备在 onStart 前自然停止属于启动失败，不能产生无间隔重新启动循环', async () => {
  const h = harness({ manualStart: true });
  try {
    const binding = h.create(); binding.update(snapshot(), visible); await flush();
    h.events.stop({}); await flush();
    binding.update(snapshot(), visible); await flush();
    assert.deepEqual(h.formats(), ['mp3']);
    assert.equal(h.statuses.filter((status) => status.phase === 'recording').length, 0);
    assert.equal(h.statuses.find((status) => status.phase === 'failed').error, '录音器未确认开始就已停止');
  } finally { await h.close(); }
});

test('被接管旧页面的相同 View 刷新不抢回所有权；授权查询错误不是用户拒绝', async () => {
  const h = harness();
  try {
    const old = h.create(), latest = h.create();
    old.update(snapshot(), visible); await flush();
    latest.update(snapshot('SILENT'), visible); h.events.stop({}); await flush();
    old.update(snapshot(), visible); await flush();
    assert.deepEqual(h.formats(), ['mp3', 'pcm']);
    assert.equal(h.stats().stops, 1);
  } finally { await h.close(); }
  let settingFailed = true;
  const failed = harness({ getSetting: (callbacks) => {
    if (settingFailed) callbacks.fail(new Error('getSetting failed'));
    else callbacks.success({ authSetting: { 'scope.record': true } });
  } });
  try {
    const binding = failed.create(); binding.update(snapshot(), visible); await flush();
    binding.update(snapshot(), visible); await flush();
    assert.equal(failed.stats().settings, 1);
    settingFailed = false;
    binding.update(snapshot('TRANSCRIPT', 'next-turn'), visible); await flush();
    assert.deepEqual(failed.formats(), ['mp3'], '查询故障不能永久记成用户拒绝');
  } finally { await failed.close(); }
});
