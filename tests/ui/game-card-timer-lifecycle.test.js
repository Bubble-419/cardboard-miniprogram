'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

/** 使用真实组件方法，单独控制微信回调与时钟，复现离页时的异步交错。 */
function createHarness(properties = {}, options = {}) {
  const filename = path.resolve(__dirname, '../../components/game-card-timer/index.js');
  let now = 1_700_000_001_000;
  let nextId = 0;
  let definition;
  let queryCount = 0;
  let vibrations = 0;
  const tasks = new Map();
  const nextTicks = [];
  const queries = [];
  const querySelectors = [];
  const context = new Proxy({}, { get(target, key) { return target[key] || (() => {}); } });
  const canvas = { getContext: () => context };
  const schedule = (callback, delay, interval = false) => {
    const id = ++nextId;
    tasks.set(id, { callback, delay, due: now + delay, interval });
    return id;
  };
  class ClockDate extends Date {
    static now() { return now; }
  }
  // 纯计时工具也执行真实源码并共用同一时钟，避免取模周期依赖宿主系统时间。
  const timerFilename = path.resolve(__dirname, '../../utils/partnerRoundTimer.js');
  const timerModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(timerFilename, 'utf8'), {
    module: timerModule, Date: ClockDate
  }, { filename: timerFilename });
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: (name) => name === '../../utils/partnerRoundTimer' ? timerModule.exports : localRequire(name),
    Component(value) { definition = value; },
    Date: ClockDate,
    setTimeout: (callback, delay) => schedule(callback, delay),
    clearTimeout: (id) => tasks.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearInterval: (id) => tasks.delete(id),
    wx: {
      nextTick: options.withoutNextTick ? undefined : (callback) => nextTicks.push(callback),
      getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 375 }),
      vibrateShort() { vibrations++; }
    }
  }, { filename });

  const events = [];
  const component = {
    ...definition.methods,
    data: { ...definition.data },
    properties: {
      ...Object.fromEntries(Object.entries(definition.properties).map(([key, value]) => [key, value.value])),
      startedAt: now - 1000,
      timerActive: true,
      ...properties
    },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    triggerEvent(name, detail) { events.push({ name, detail }); },
    createSelectorQuery() {
      let selector;
      const query = {
        in() { return query; },
        select(value) { selector = value; return query; },
        fields() { return query; },
        exec(callback) {
          queryCount++;
          querySelectors.push(selector);
          queries.push({ selector, callback });
        }
      };
      return query;
    }
  };
  const harness = {
    component,
    canvas,
    events,
    queries,
    querySelectors,
    get queryCount() { return queryCount; },
    get vibrations() { return vibrations; },
    get pendingTasks() { return tasks.size; },
    get intervals() { return [...tasks.values()].filter((task) => task.interval).length; },
    flushNextTicks() { nextTicks.splice(0).forEach((callback) => callback()); },
    replyQuery(index = 0, size = { width: 320, height: 480 }) {
      const query = queries.splice(index, 1)[0];
      assert.ok(query, '必须先发起真实 selector 查询');
      query.callback(size ? [{ node: canvas, ...size }] : []);
    },
    replyAll(size) {
      const count = queries.length;
      for (let index = 0; index < count; index++) harness.replyQuery(0, size);
    },
    advance(ms) {
      const target = now + ms;
      for (let step = 0; step < 1000; step++) {
        const pending = [...tasks.entries()].filter(([, task]) => task.due <= target)
          .sort((left, right) => left[1].due - right[1].due)[0];
        if (!pending) { now = target; return; }
        const [id, task] = pending;
        now = task.due;
        if (task.interval) task.due += task.delay;
        else tasks.delete(id);
        task.callback();
      }
      throw new Error('组件不应无限创建立即执行的任务');
    },
    resize() { definition.observers.layoutKey.call(component); },
    observe(name) { definition.observers[name].call(component, component.properties[name]); },
    hide() { definition.pageLifetimes.hide.call(component); },
    show() { definition.pageLifetimes.show.call(component); },
    detach() { definition.lifetimes.detached.call(component); }
  };
  if (definition.lifetimes.attached) definition.lifetimes.attached.call(component);
  definition.lifetimes.ready.call(component);
  if (!options.deferInitialQueries) harness.replyAll();
  return harness;
}

test('键盘布局校准按真实尺寸更新位图且只保留一个倒计时循环', () => {
  const harness = createHarness();
  harness.resize();
  harness.flushNextTicks();
  harness.replyAll({ width: 300, height: 210 });
  harness.advance(300);
  harness.replyAll({ width: 300, height: 210 });

  assert.equal(harness.canvas.width, 600);
  assert.equal(harness.canvas.height, 420);
  assert.equal(harness.component._width, 300);
  assert.equal(harness.component._height, 210);
  assert.equal(harness.intervals, 1);
  assert.equal(harness.events.length, 0);
  harness.detach();
});

test('布局校准后立即隐藏页面，nextTick 和延迟回调不得重启计时', () => {
  const harness = createHarness();
  harness.resize();
  harness.hide();
  const queriesBeforeHide = harness.queryCount;
  harness.flushNextTicks();
  harness.replyAll();
  harness.advance(400);
  harness.replyAll();

  assert.equal(harness.queryCount, queriesBeforeHide, '隐藏后不得重新查询 canvas');
  assert.equal(harness.intervals, 0, '隐藏后不得重新启动倒计时');
  assert.equal(harness.pendingTasks, 0);
  assert.equal(harness.vibrations, 0);
  assert.equal(harness.events.length, 0);
});

test('组件销毁后排队的 nextTick 不得查询已销毁 canvas 或进入重试', () => {
  const harness = createHarness();
  harness.resize();
  harness.detach();
  const queriesBeforeDetach = harness.queryCount;
  harness.flushNextTicks();
  harness.replyAll(null);
  harness.advance(400);
  harness.replyAll(null);

  assert.equal(harness.queryCount, queriesBeforeDetach);
  assert.equal(harness.pendingTasks, 0);
  assert.equal(harness.intervals, 0);
});

test('隐藏页面后迟到的 selector 结果不得重启倒计时', () => {
  const harness = createHarness();
  harness.resize();
  harness.flushNextTicks();
  harness.hide();
  harness.replyAll();
  harness.advance(400);

  assert.equal(harness.intervals, 0);
  assert.equal(harness.pendingTasks, 0);
});

test('组件销毁后迟到的空 selector 结果不得继续每 80ms 重试', () => {
  const harness = createHarness();
  harness.resize();
  harness.flushNextTicks();
  harness.detach();
  harness.replyAll(null);
  const queriesBeforeRetry = harness.queryCount;
  harness.advance(400);
  harness.replyAll(null);

  assert.equal(harness.queryCount, queriesBeforeRetry);
  assert.equal(harness.pendingTasks, 0);
});

test('重新显示页面后旧生命周期的 selector 不得覆盖新尺寸', () => {
  const harness = createHarness();
  harness.resize();
  harness.flushNextTicks();
  harness.hide();
  harness.show();
  harness.replyQuery(0, { width: 300, height: 210 });
  assert.notEqual(harness.component._height, 210, '旧生命周期结果必须废弃');
  harness.replyAll({ width: 320, height: 480 });

  assert.equal(harness.component._height, 480);
  assert.equal(harness.intervals, 1);
  harness.detach();
});

test('同一生命周期连续键盘变化时，乱序尺寸查询不能覆盖最新位图', () => {
  const harness = createHarness();
  harness.resize();
  harness.flushNextTicks();
  harness.resize();
  harness.flushNextTicks();
  harness.replyQuery(1, { width: 300, height: 220 });
  harness.replyQuery(0, { width: 300, height: 210 });

  assert.equal(harness.component._height, 220);
  assert.equal(harness.canvas.height, 440);
  assert.equal(harness.intervals, 1);
  harness.detach();
});

test('可见时 canvas 尚未布局允许重试，隐藏后立即取消重试', () => {
  const harness = createHarness();
  harness.resize();
  harness.flushNextTicks();
  harness.replyAll(null);
  harness.advance(80);
  assert.equal(harness.queries.length, 1, '布局未完成时应继续一次查询');
  harness.replyAll(null);
  harness.hide();
  const queriesBeforeHide = harness.queryCount;
  harness.advance(400);

  assert.equal(harness.queryCount, queriesBeforeHide);
  assert.equal(harness.pendingTasks, 0);
});

test('隐藏期间的属性与键盘更新不启动计时、声浪或画布查询', () => {
  const harness = createHarness();
  harness.hide();
  const queriesBeforeHide = harness.queryCount;
  harness.component.properties.borderVariant = 'sound';
  harness.observe('startedAt, timerActive, borderVariant');
  harness.observe('soundLevel');
  harness.observe('suppressCanvas');
  harness.resize();
  harness.flushNextTicks();
  harness.advance(400);

  assert.equal(harness.queryCount, queriesBeforeHide);
  assert.equal(harness.pendingTasks, 0);
});

test('无 wx.nextTick 时的延迟校准也在销毁时取消', () => {
  const harness = createHarness({}, { withoutNextTick: true });
  harness.resize();
  harness.detach();
  const queriesBeforeDetach = harness.queryCount;
  harness.advance(400);

  assert.equal(harness.queryCount, queriesBeforeDetach);
  assert.equal(harness.pendingTasks, 0);
});

test('静默声浪按新尺寸校准，不查询不存在的普通倒计时 canvas', () => {
  // 与 gamepage 一致：静默卡片关闭普通倒计时，只保留声浪 canvas。
  const harness = createHarness({ borderVariant: 'sound', soundLevel: 0.6, timerActive: false });
  harness.resize();
  harness.flushNextTicks();
  harness.replyAll({ width: 300, height: 210 });
  harness.advance(300);
  harness.replyAll({ width: 300, height: 210 });

  assert.equal(harness.component._soundH, 210);
  assert.equal(harness.canvas.height, 420);
  assert.ok(harness.querySelectors.every((selector) => selector === '#gctSoundCanvas'));
  harness.hide();
  harness.advance(400);
  assert.equal(harness.pendingTasks, 0);
});

test('声浪校准的空查询迟到时，销毁后不启动重试或绘制', () => {
  const harness = createHarness({ borderVariant: 'sound', timerActive: false });
  harness.resize();
  harness.flushNextTicks();
  harness.detach();
  harness.replyAll(null);
  const queriesBeforeRetry = harness.queryCount;
  harness.advance(400);

  assert.equal(harness.queryCount, queriesBeforeRetry);
  assert.equal(harness.pendingTasks, 0);
});

test('可见时校准声浪尺寸不清掉已持续超标的声音提示', () => {
  // 新版阈值为 50dB；0.7≈56dB，保留原测试“确已超标”的业务前提。
  const harness = createHarness({ borderVariant: 'sound', soundLevel: 0.7, timerActive: false });
  harness.advance(800);
  assert.equal(harness.component.data.soundTooLoud, true);
  harness.resize();
  harness.flushNextTicks();
  harness.replyAll({ width: 300, height: 210 });

  assert.equal(harness.component.data.soundTooLoud, true, '尺寸变化不能中断同一声级的提示');
  harness.detach();
});

test('声浪尺寸校准同时保留新版低于阈值的稳定消标时间', () => {
  const harness = createHarness({ borderVariant: 'sound', soundLevel: 0.7, timerActive: false });
  harness.advance(800);
  assert.equal(harness.component.data.soundTooLoud, true);
  harness.component._soundSmooth = 0.6125;
  harness.component._soundTarget = 0.6125;
  harness.component.properties.soundLevel = 0.6125;
  harness.advance(160);
  const underWarnSince = harness.component._underWarnSince;
  assert.ok(underWarnSince > 0);
  harness.resize();
  harness.flushNextTicks();
  harness.replyAll({ width: 300, height: 210 });
  assert.equal(harness.component._underWarnSince, underWarnSince,
    '键盘尺寸变化不得重新开始 280ms 的消标等待');
  harness.advance(160);
  assert.equal(harness.component.data.soundTooLoud, false);
  harness.detach();
});

test('首屏 show 与声浪查询交错时，旧结果不能打断当前采样初始化', () => {
  const harness = createHarness({ borderVariant: 'sound', timerActive: false }, { deferInitialQueries: true });
  harness.show();
  harness.replyQuery(0, { width: 300, height: 210 });
  assert.equal(harness.component._soundStarting, true);
  assert.equal(harness.component._soundCtx, null);
  harness.replyAll({ width: 320, height: 480 });

  assert.equal(harness.component._soundStarting, false);
  assert.equal(harness.component._soundH, 480);
  assert.ok(harness.component._soundTimer != null);
  harness.detach();
  assert.equal(harness.pendingTasks, 0);
});

test('隐藏期间取消第二次震动和到期事件，恢复后继续当前循环', () => {
  const harness = createHarness();
  harness.component._triggerExpireAnimation();
  assert.equal(harness.vibrations, 1);
  harness.hide();
  harness.advance(3000);

  assert.equal(harness.vibrations, 1, '隐藏期间不得补发第二次震动');
  assert.equal(harness.events.length, 0);
  assert.equal(harness.pendingTasks, 0);
  harness.show();
  harness.replyAll();
  assert.equal(harness.component.data.displayMode, 'timer');
  assert.equal(harness.intervals, 1);
  assert.equal(harness.events.length, 0);
  harness.detach();
});
