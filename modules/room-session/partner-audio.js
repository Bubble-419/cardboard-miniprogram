'use strict';

const { createSilentSampler } = require('./partner-silent-sound');
const { createPartnerSpeechSink } = require('./partner-speech');
const { classifyRoomShellRoute, ROOM_SHELL_OWNER, ROOM_SHELL_SCREEN } = require('../room-navigation/roomShellRoute');
const SEGMENT_DURATION_MS = 59000;
const NATIVE_ACK_TIMEOUT_MS = 2000;
const controllers = new WeakMap();

/** 仅这类错误确认没有取得音频轨道；未知错误/超时不能推断设备已释放。 */
function isTerminalStartupError(error) {
  if (!error) return false;
  if (['NotFoundError', 'NotAllowedError'].includes(error.name)) return true;
  return /^(?:operateRecorder:fail\s+)?(?:NotFoundError|NotAllowedError)\.?$/
    .test(String(error.errMsg || error.message || error).trim());
}

/** 只投影设备意图，不复制房间状态机。等待/投票/历史屏幕没有录音副作用。 */
function projectIntent(snapshot, local, transcription, now) {
  const view = snapshot && snapshot.view;
  const session = view && view.session;
  const turn = session && session.activeTurn;
  const actor = view && view.actor;
  const step = session && session.workflow && session.workflow.step;
  const route = classifyRoomShellRoute(view && view.route || {});
  if (!local.visible || local.history || route.owner !== ROOM_SHELL_OWNER.PARTNER || route.screen !== ROOM_SHELL_SCREEN.GAME
    || !session || session.mode !== 'PARTNER' || !turn || !actor
    || !['PARTNER_TURN', 'PARTNER_STATEMENT'].includes(step)) return null;
  const state = snapshot.roomState || {};
  const scope = { roomId: snapshot.roomId, sessionId: session.sessionId, turnId: turn.turnId,
    workflowStep: step, phase: step === 'PARTNER_STATEMENT' ? 'discussion' : 'play' };
  if (!scope.roomId || !scope.sessionId || !scope.turnId) return null;
  let mode;
  if (state.partnerSilentMode && actor.memberId === turn.activeMemberId) {
    // startedAt 已在 PageSnapshot 转换至本机时钟域；校时不改变录音作用域。
    scope.deadlineAt = Number(state.partnerSilentStartedAt)
      + Number(turn.silentDeadlineAt) - Number(turn.silentStartedAt);
    if (!Number.isFinite(scope.deadlineAt) || scope.deadlineAt <= now) return null;
    mode = 'SILENT';
  } else if (transcription && actor.role === 'HOST') mode = 'TRANSCRIPT';
  else return null;
  const key = JSON.stringify([mode, scope.roomId, scope.sessionId, scope.turnId, step, actor.memberId,
    mode === 'SILENT' ? turn.silentStartedAt : null, mode === 'SILENT' ? turn.silentDeadlineAt : null]);
  return { mode, key, scope };
}

function recordPermission(api, mode, live) {
  return new Promise((resolve, reject) => {
    api.getSetting({ success: (setting) => {
      if (!live()) return resolve(false);
      const granted = setting.authSetting && setting.authSetting['scope.record'];
      if (granted === true) return resolve(true);
      const settings = () => api.showModal({ title: '需要麦克风权限',
        content: mode === 'SILENT' ? '静默模式需要麦克风监测环境声量' : '用于记录本轮讨论并生成文字纪要',
        confirmText: '去设置', success: (modal) => {
          if (!modal.confirm || !live()) return resolve(false);
          api.openSetting({ success: (result) => resolve(!!(result.authSetting && result.authSetting['scope.record'])),
            fail: () => resolve(false) });
        }, fail: () => resolve(false) });
      if (granted === false) return settings();
      api.authorize({ scope: 'scope.record', success: () => resolve(true),
        fail: () => { if (mode === 'TRANSCRIPT' && live()) settings(); else resolve(false); } });
    }, fail: reject });
  });
}

/** 一个原生 RecorderManager 对应一个持久控制器，生命周期长于任意物理页面。 */
function controllerFor(recorder, options) {
  let controller = controllers.get(recorder);
  if (controller) return controller;
  const setTimer = options.setTimeoutFn || setTimeout;
  const clearTimer = options.clearTimeoutFn || clearTimeout;
  let desired = null, run = null, permissionTask = null, queued = false, runId = 0;

  function selected(binding, generation, intent) {
    return desired === binding && !binding.disposed && binding.generation === generation
      && binding.intent === intent && (intent.mode !== 'SILENT' || binding.now() < intent.scope.deadlineAt);
  }
  function notify(binding, phase, error) {
    if (!binding.disposed) binding.notify('onStatus', { phase, mode: binding.intent && binding.intent.mode || 'OFF', error });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => { queued = false; reconcile(); });
  }
  function clearAck(current) {
    if (current.timer != null) clearTimer(current.timer);
    current.timer = null;
  }
  function finishFailedStartup(current, error) {
    if (!current || run !== current || current.started || !isTerminalStartupError(error)) return false;
    clearAck(current);
    current.cancelled = true;
    run = null;
    const binding = current.binding;
    // 先结束失败 run，再通知 UI；回调可同步换页/换意图，不能污染新绑定。
    if (binding.generation === current.generation && binding.intent === current.intent) {
      binding.failed = true;
      binding.level = null;
      notify(binding, 'failed', error);
    }
    schedule();
    return true;
  }
  function requestStop(current) {
    if (!current || run !== current || current.phase !== 'STOPPING') return;
    clearAck(current);
    // 超时只报告设备仍未确认，不释放 run，也不丢弃最新 desired。
    current.timer = setTimer(() => {
      current.timer = null;
      if (run === current) notify(desired || current.binding, 'blocked', '录音器停止未确认');
    }, NATIVE_ACK_TIMEOUT_MS);
    try { recorder.stop(); } catch (error) {
      if (run === current) notify(desired || current.binding, 'blocked', error);
    }
  }
  function stop(current) {
    if (!current || run !== current || current.phase === 'STOPPING') return;
    clearAck(current);
    current.phase = 'STOPPING';
    current.cancelled = true;
    current.binding.level = null;
    if (!current.invoked) {
      // hook 可同步撤销意图；尚未调用原生 start 就没有需要等待的设备资源。
      if (run === current) run = null;
      schedule();
      return;
    }
    requestStop(current);
  }
  function reconcile() {
    const target = desired;
    const intent = target && target.intent;
    const live = intent && selected(target, target.generation, intent);
    if (run) {
      if (!live || run.binding !== target || run.generation !== target.generation || run.intent !== intent) stop(run);
      return;
    }
    if (!live || target.denied || target.failed || target.completed === intent.key || target.processing === intent) return;
    if (!target.permitted) {
      if (permissionTask) return;
      const generation = target.generation;
      // 设备级单飞授权；离页/换意图后迟到的授权不能重新激活旧页面。
      const task = Promise.resolve().then(() => {
        if (!selected(target, generation, intent)) return null;
        return recordPermission(target.api, intent.mode, () => selected(target, generation, intent));
      });
      permissionTask = task;
      notify(target, 'authorizing');
      task.then((granted) => {
        if (!selected(target, generation, intent)) return;
        if (granted) target.permitted = true;
        else { target.denied = true; notify(target, 'denied'); }
      }, (error) => {
        if (selected(target, generation, intent)) { target.failed = true; notify(target, 'failed', error); }
      }).finally(() => { permissionTask = null; schedule(); });
      return;
    }
    const current = { binding: target, intent, generation: target.generation,
      context: Object.freeze({ ...intent.scope, runId: ++runId, ownerGeneration: target.generation }),
      phase: 'STARTING', invoked: false, started: false, cancelled: false, timer: null, sampler: null };
    run = current;
    if (intent.mode === 'SILENT') {
      current.sampler = createSilentSampler({ scope: current.context, now: target.now,
        live: () => run === current && current.phase === 'RECORDING'
          && selected(target, current.generation, intent), publish: target.publish,
        onLevel: (level) => { target.level = level; target.notify('onLevel', level); } });
    }
    notify(target, 'starting');
    if (run !== current || !selected(target, current.generation, intent)) return;
    current.timer = setTimer(() => {
      current.timer = null;
      if (run !== current || current.phase !== 'STARTING') return;
      // 初始化麦克风（尤其外接设备）可能较慢。计时器不是原生失败确认，
      // 保持 STARTING；迟到 onStart 继续当前意图，离页才撤销并请求停止。
      notify(target, 'starting', '录音器启动较慢，等待原生确认');
    }, NATIVE_ACK_TIMEOUT_MS);
    try {
      current.invoked = true;
      recorder.start({ duration: intent.mode === 'SILENT'
        ? Math.min(600000, Math.max(1, intent.scope.deadlineAt - target.now())) : SEGMENT_DURATION_MS,
      sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000,
      format: intent.mode === 'SILENT' ? 'pcm' : 'mp3', ...(intent.mode === 'SILENT' ? { frameSize: 1 } : {}) });
    } catch (error) {
      if (finishFailedStartup(current, error) || run !== current) return;
      target.failed = true;
      notify(target, 'failed', error);
      stop(current);
    }
  }

  recorder.onStart(() => {
    const current = run;
    if (!current || current.started) return;
    current.started = true;
    if (current.phase === 'STOPPING') {
      // 首次 stop 可能发生在原生尚未启动时。迟到确认只补一次停止，
      // 不恢复旧提交资格；重复 onStart 不重试，仍等 onStop 才交接设备。
      requestStop(current);
      return;
    }
    clearAck(current);
    if (!selected(current.binding, current.generation, current.intent)) { stop(current); return; }
    current.phase = 'RECORDING';
    notify(current.binding, 'recording');
  });
  recorder.onFrameRecorded((event) => {
    if (!run || run.phase !== 'RECORDING') return;
    if (!selected(run.binding, run.generation, run.intent)) { schedule(); return; }
    if (run.sampler) run.sampler.frame(event);
  });
  recorder.onStop((result) => {
    if (!run) return;
    const stopped = run;
    clearAck(stopped);
    run = null;
    const binding = stopped.binding;
    binding.level = null;
    const eligible = !stopped.cancelled && stopped.phase === 'RECORDING'
      && selected(binding, stopped.generation, stopped.intent);
    if (eligible && stopped.intent.mode === 'TRANSCRIPT' && result && result.tempFilePath) {
      // 自然分段才提交纪要；主动停止/切轮丢弃旧部分音频。上传永远使用旧 run 的上下文。
      binding.processing = stopped.intent;
      Promise.resolve().then(() => binding.speechSink(stopped.context, result.tempFilePath))
        .then((text) => {
          if (text && selected(binding, stopped.generation, stopped.intent)) binding.notify('onText', text);
        }).catch((error) => {
          if (selected(binding, stopped.generation, stopped.intent)) notify(binding, 'uploadFailed', error);
        }).finally(() => {
          if (binding.processing === stopped.intent) binding.processing = null;
          schedule();
        });
    } else if (eligible) {
      // PCM 已达到原生 duration，或无有效文件：不形成无间隔重启循环。
      binding.completed = stopped.intent.key;
    } else if (!stopped.cancelled && selected(binding, stopped.generation, stopped.intent)) {
      binding.failed = true;
      notify(binding, 'failed', '录音器未确认开始就已停止');
    }
    if (!binding.disposed && desired === binding) notify(binding, 'idle');
    schedule();
  });
  recorder.onError((error) => {
    const current = run;
    if (!current) return;
    if (finishFailedStartup(current, error)) return;
    if (current.phase !== 'STOPPING') {
      current.binding.failed = true;
      notify(current.binding, 'failed', error);
      // hook 可同步离页并触发 onStop；只收口原 run，不读取被重入改写的全局 run。
      stop(current);
    } else notify(desired || current.binding, 'blocked', error);
    // 除明确未取得设备的启动错误外，onError 不是 onStop；未知设备状态仍等确认。
  });
  controller = {
    update(binding, intent) {
      if (binding.intent && intent && binding.intent.key === intent.key) {
        binding.intent.scope.deadlineAt = intent.scope.deadlineAt;
        schedule();
        return;
      }
      binding.generation += 1;
      binding.intent = intent;
      binding.level = null;
      binding.completed = null;
      // 只有新的录音作用域或前后台周期才重试设备；同 key 的 View 在上方直接返回。
      binding.failed = false;
      if (!intent) {
        if (desired === binding) desired = null;
        // 权限拒绝仍在本页记忆，不随 View/前后台重试。
        binding.permitted = false;
      } else desired = binding;
      // 先撤销旧音频提交资格，再同步发起 stop；迟到清理不会影响新所有者。
      if (run && (desired !== run.binding || run.generation !== run.binding.generation)) stop(run);
      schedule();
    }
  };
  controllers.set(recorder, controller);
  return controller;
}

/** 页面唯一接线：update(完整 PageSnapshot, 本地可见性) / dispose，不编排 start-stop。 */
function createPartnerAudio(options = {}) {
  const api = options.wxApi || wx;
  const transcription = options.transcription === true;
  const controllerOptions = { setTimeoutFn: options.setTimeoutFn, clearTimeoutFn: options.clearTimeoutFn };
  let hooks = { onText: options.onText, onLevel: options.onLevel, onStatus: options.onStatus };
  let controller = null;
  const binding = { api, now: options.now || Date.now, intent: null, generation: 0,
    disposed: false, denied: false, failed: false, permitted: false, level: null,
    completed: null, processing: null,
    publish: options.publish || ((signal) => require('./index').publishRoomSignal(signal)),
    speechSink: options.speechSink || createPartnerSpeechSink(api),
    notify(name, value) {
      if (binding.disposed) return;
      try {
        if (hooks && typeof hooks[name] === 'function') hooks[name](value);
        else if (name === 'onStatus' && value.error) console.warn('partnerAudio', value.phase, value.error);
      } catch (error) {
        // UI hook 失败不能打断原生资源状态的收口或下一次意图协调。
        console.warn('partnerAudio hook', name, error);
      }
    } };
  return {
    update(snapshot, local = {}) {
      if (binding.disposed) return;
      const intent = projectIntent(snapshot, local, transcription, binding.now());
      if (!controller && !intent) return;
      if (!controller) controller = controllerFor(api.getRecorderManager(), controllerOptions);
      controller.update(binding, intent);
    },
    dispose() {
      if (binding.disposed) return;
      binding.disposed = true;
      hooks = null;
      if (controller) controller.update(binding, null);
    },
    getLevel: () => binding.level
  };
}

module.exports = { createPartnerAudio };
