'use strict';

const {
  PROTOCOL_VERSION, VIEW_SCHEMA_VERSION, EVENT_SCHEMA_VERSION, EVENT_TYPES, ERR,
  MAX_INCREMENTAL_SYNC_EVENTS,
  stableStringify, validatePublicViewPatch, validateActorViewPatch, validateMemberView
} = require('../room-contracts/index');
const { clone, applyProjectedEvent } = require('../room-projection/index');

// RoomClient 的统一轮询下限；页面不能再通过局部配置发起更高频的请求。
const ROOM_POLL_INTERVAL_MS = 2000;
const PRESENCE_TOUCH_INTERVAL_MS = 5000;
const PRESENCE_READ_INTERVAL_MS = 5000;
// 云函数控制台建议至少 10 秒；客户端略晚于服务端预算结束，防止 SDK 丢回调永久堵塞串行队列。
const ROOM_REQUEST_TIMEOUT_MS = 12000;

function defaultCommandId() {
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function unwrapCloudResult(response) {
  return response && Object.prototype.hasOwnProperty.call(response, 'result') ? response.result : response;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 将 wx.cloud.callFunction 收敛为 RoomClient 唯一传输端口。 */
function createCloudRoomGateway(options) {
  const callFunction = options && options.callFunction;
  if (typeof callFunction !== 'function') throw new Error('callFunction required');
  const requestedTimeoutMs = Number(options && options.requestTimeoutMs);
  const requestTimeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? requestedTimeoutMs
    : ROOM_REQUEST_TIMEOUT_MS;
  const setTimeoutFn = options && options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options && options.clearTimeoutFn || clearTimeout;
  const call = (name, data) => new Promise((resolve, reject) => {
    let settled = false;
    let timeoutTimer = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeoutFn(timeoutTimer);
      callback(value);
    };
    timeoutTimer = setTimeoutFn(() => {
      const error = new Error('房间服务响应超时，请稍后重试');
      error.code = ERR.DEPENDENCY_UNAVAILABLE;
      error.errCode = ERR.DEPENDENCY_UNAVAILABLE;
      error.retryable = true;
      finish(reject, error);
    }, requestTimeoutMs);
    Promise.resolve()
      .then(() => callFunction({ name, data }))
      .then(
        (response) => finish(resolve, unwrapCloudResult(response)),
        (error) => finish(reject, error)
      );
  });
  const withContext = (data, clientContext) => clientContext ? { ...data, clientContext } : data;
  return {
    currentRoom: (clientContext) => call('roomQuery', withContext({ action: 'current' }, clientContext)),
    snapshot: (roomId, clientContext) => call('roomQuery', withContext({ action: 'snapshot', roomId }, clientContext)),
    sync: (roomId, afterSeq, limit, clientContext) => call('roomQuery', withContext({
      action: 'sync', roomId, afterSeq, limit
    }, clientContext)),
    history: (roomId, query, clientContext) => call('roomQuery', withContext({
      action: 'history', roomId, ...(query || {})
    }, clientContext)),
    session: (roomId, sessionId, clientContext) => call('roomQuery', withContext({
      action: 'session', roomId, sessionId
    }, clientContext)),
    messages: (roomId, sessionId, query, clientContext) => call('roomQuery', withContext({
      action: 'messages', roomId, sessionId, ...(query || {})
    }, clientContext)),
    leaderboard: (roomId, sessionId, clientContext) => call('roomQuery', withContext({
      action: 'leaderboard', roomId, sessionId
    }, clientContext)),
    // Command 放在独立传输字段中，避免 CloudBase 注入的 tcbContext 污染严格协议对象。
    dispatch: (envelope, clientContext) => call('roomCommand', withContext({ command: envelope }, clientContext))
  };
}

function createRoomClient(options) {
  const gateway = options && options.gateway;
  if (!gateway) throw new Error('RoomGateway required');
  const requestedIntervalMs = Number(options.intervalMs);
  const intervalMs = requestedIntervalMs > 0
    ? Math.max(ROOM_POLL_INTERVAL_MS, requestedIntervalMs)
    : ROOM_POLL_INTERVAL_MS;
  const syncLimit = Math.min(MAX_INCREMENTAL_SYNC_EVENTS,
    Math.max(1, Number(options.syncLimit) || MAX_INCREMENTAL_SYNC_EVENTS));
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const now = typeof options.nowFn === 'function' ? options.nowFn : Date.now;
  const makeCommandId = options.commandIdFactory || defaultCommandId;
  const deviceSessionId = options.deviceSessionId || `device_${defaultCommandId()}`;

  let roomId = null;
  let view = null;
  let ephemeral = {};
  let appliedSeq = 0;
  let appliedStateVersion = 0;
  let stagingView = null;
  let stagingSeq = 0;
  let stagingStateVersion = 0;
  let status = 'IDLE';
  let error = null;
  let timer = null;
  let timerGeneration = 0;
  let disposed = false;
  let paused = false;
  let lastPresenceTouchAt = 0;
  let lastPresenceReadAt = 0;
  let consecutiveSyncFailures = 0;
  let serverClockOffsetMs = 0;
  let lastRequestCompletedAt = null;
  let listenerSeq = 0;
  let queue = Promise.resolve();
  let connectionPromise = null;
  const listeners = new Map();
  const uncertainCommands = new Map();

  function state() {
    return {
      roomId, view: clone(view), ephemeral: clone(ephemeral), seq: appliedSeq,
      stateVersion: appliedStateVersion, status, error: clone(error),
      serverClockOffsetMs, serverNow: now() + serverClockOffsetMs,
      lastRequestCompletedAt
    };
  }

  function observeServerTime(serverTime, requestedAt) {
    const receivedAt = now();
    const serverAt = Number(serverTime);
    if (!Number.isFinite(serverAt)) return;
    // 以请求往返中点估算时钟偏差，供倒计时展示使用；服务端仍是截止时间的唯一裁决者。
    const midpoint = Number.isFinite(requestedAt) ? (requestedAt + receivedAt) / 2 : receivedAt;
    serverClockOffsetMs = Math.round(serverAt - midpoint);
  }

  function publish() {
    const current = state();
    listeners.forEach((listener) => {
      try { listener(current.view, current); } catch (listenerError) { console.warn('RoomClient listener', listenerError); }
    });
  }

  function cancelTimer() {
    timerGeneration += 1;
    if (timer) clearTimeoutFn(timer);
    timer = null;
  }

  function getRequestContext(contextOptions) {
    const requestedAt = now();
    const touchPresence = requestedAt - lastPresenceTouchAt >= PRESENCE_TOUCH_INTERVAL_MS;
    if (touchPresence) lastPresenceTouchAt = requestedAt;
    const requestContext = { deviceSessionId, touchPresence };
    if (contextOptions && contextOptions.readPresence) {
      const readPresence = contextOptions.forcePresence === true
        || requestedAt - lastPresenceReadAt >= PRESENCE_READ_INTERVAL_MS;
      requestContext.readPresence = readPresence;
    }
    return requestContext;
  }

  function schedule(delay) {
    cancelTimer();
    if (disposed || paused || (!roomId && status !== 'DEGRADED')) return;
    const generation = timerGeneration;
    timer = setTimeoutFn(() => {
      timer = null;
      // 已经入队的 Command/Query 会推进 generation；到期的旧 poll 不得跟在它后面立即执行。
      if (generation !== timerGeneration || disposed || paused) return undefined;
      // 只有持有可信 View 才能消费增量事件；Snapshot 失败后不得退化成 sync(0)。
      const operation = roomId ? (view || stagingView ? syncUntilCurrent : resumeInternal) : openInternal;
      return enqueue(() => {
        if (generation !== timerGeneration || disposed || paused) return view;
        return operation();
      }).catch((syncError) => console.warn('RoomClient sync', syncError));
    }, delay == null ? intervalMs : delay);
  }

  function enqueue(operation) {
    // Promise.then 会把上一任务的返回值作为参数传入；syncUntilCurrent 的首参有协议语义，必须显式隔离。
    const execute = () => Promise.resolve().then(operation).finally(() => {
      lastRequestCompletedAt = now();
    });
    const run = queue.then(execute, execute);
    queue = run.catch(() => undefined);
    return run;
  }

  function nextPollDelay() {
    return status === 'DEGRADED'
      ? Math.min(15000, intervalMs * (2 ** Math.min(consecutiveSyncFailures, 4)))
      : intervalMs;
  }

  /**
   * 前台 Command/Query 共享同一请求通道。调用时立即作废旧 poll，执行完成后再开启完整静默窗口。
   * 必要的握手查询（current -> snapshot）仍可在同一个 operation 内连续完成。
   */
  function enqueueForeground(operation) {
    cancelTimer();
    return enqueue(async () => {
      cancelTimer();
      try {
        return await operation();
      } finally {
        schedule(nextPollDelay());
      }
    });
  }

  function enqueueConnection(operation) {
    if (connectionPromise) return connectionPromise;
    const request = enqueueForeground(operation);
    connectionPromise = request;
    const clear = () => {
      if (connectionPromise === request) connectionPromise = null;
    };
    request.then(clear, clear);
    return request;
  }

  function resetConnection(nextStatus) {
    cancelTimer();
    roomId = null;
    view = null;
    ephemeral = {};
    appliedSeq = 0;
    appliedStateVersion = 0;
    stagingView = null;
    stagingSeq = 0;
    stagingStateVersion = 0;
    consecutiveSyncFailures = 0;
    serverClockOffsetMs = 0;
    lastPresenceTouchAt = 0;
    lastPresenceReadAt = 0;
    status = nextStatus || 'IDLE';
    error = null;
  }

  /** 切换房间时先清空所有房间绑定状态，避免新房恢复失败后继续展示旧房数据。 */
  function resetRoomBoundState(nextRoomId) {
    cancelTimer();
    roomId = nextRoomId || null;
    view = null;
    ephemeral = {};
    appliedSeq = 0;
    appliedStateVersion = 0;
    stagingView = null;
    stagingSeq = 0;
    stagingStateVersion = 0;
    consecutiveSyncFailures = 0;
    serverClockOffsetMs = 0;
    lastPresenceTouchAt = 0;
    lastPresenceReadAt = 0;
  }

  function isTerminalRoomError(connectionError) {
    return [ERR.NOT_MEMBER, ERR.ROOM_DISSOLVED, ERR.ROOM_NOT_FOUND]
      .includes(connectionError && connectionError.code);
  }

  function disconnectFromError(connectionError) {
    const disconnectedRoomId = roomId;
    resetConnection('DISCONNECTED');
    error = { errCode: connectionError.code, errMsg: connectionError.message,
      roomId: disconnectedRoomId };
    publish();
  }

  function validateSnapshot(snapshot, targetRoomId) {
    return snapshot && snapshot.ok === true
      && snapshot.protocolVersion === PROTOCOL_VERSION
      && snapshot.viewSchemaVersion === VIEW_SCHEMA_VERSION
      && Number.isInteger(snapshot.seq)
      && Number.isInteger(snapshot.stateVersion)
      && snapshot.roomId === targetRoomId
      && validateMemberView(snapshot.view, targetRoomId);
  }

  function invalidSnapshotMessage(snapshot, targetRoomId) {
    if (!snapshot) return '无效的房间快照';
    if (snapshot.ok !== true) return snapshot.errMsg || '无效的房间快照';
    if (snapshot.protocolVersion !== PROTOCOL_VERSION) {
      return `房间协议版本不匹配（${snapshot.protocolVersion}）`;
    }
    if (snapshot.viewSchemaVersion !== VIEW_SCHEMA_VERSION) {
      return `房间视图版本不匹配，请重新部署云函数（${snapshot.viewSchemaVersion}/${VIEW_SCHEMA_VERSION}）`;
    }
    if (!Number.isInteger(snapshot.seq) || !Number.isInteger(snapshot.stateVersion)) {
      return '房间快照缺少版本水位';
    }
    if (snapshot.roomId !== targetRoomId) return '房间快照与当前房间不一致';
    if (!validateMemberView(snapshot.view, targetRoomId)) return '房间快照结构不完整';
    return '无效的房间快照';
  }

  function mergeEphemeral(previous, incoming) {
    const before = previous || {};
    const next = incoming || {};
    const stale = next.stale || {};
    return {
      presenceByMemberId: clone(stale.presence
        ? (before.presenceByMemberId || {}) : (next.presenceByMemberId || {})),
      signals: clone(stale.signals ? (before.signals || {}) : (next.signals || {})),
      stale: { presence: stale.presence === true, signals: stale.signals === true }
    };
  }

  function installSnapshot(snapshot, targetRoomId, requestedAt) {
    if (!validateSnapshot(snapshot, targetRoomId)) {
      const invalid = new Error(invalidSnapshotMessage(snapshot, targetRoomId));
      invalid.code = (snapshot && snapshot.errCode) || ERR.SNAPSHOT_REQUIRED;
      throw invalid;
    }
    const sameRoom = roomId === targetRoomId;
    roomId = targetRoomId;
    view = clone(snapshot.view);
    // 换房后的瞬时态必须从空状态开始，不能把上一房间的在线状态或信号带过来。
    ephemeral = mergeEphemeral(sameRoom ? ephemeral : {}, snapshot.ephemeral);
    if (snapshot.ephemeral && snapshot.ephemeral.stale
      && snapshot.ephemeral.stale.presence === false) lastPresenceReadAt = now();
    appliedSeq = snapshot.seq;
    appliedStateVersion = snapshot.stateVersion;
    stagingView = null;
    stagingSeq = 0;
    stagingStateVersion = 0;
    status = 'READY';
    error = null;
    consecutiveSyncFailures = 0;
    observeServerTime(snapshot.serverTime, requestedAt);
    publish();
    return view;
  }

  async function replaceFromSnapshot(targetRoomId) {
    const requestedAt = now();
    const snapshot = await gateway.snapshot(targetRoomId,
      getRequestContext({ readPresence: true, forcePresence: true }));
    return installSnapshot(snapshot, targetRoomId, requestedAt);
  }

  function consumeBatch(batch, requestedAt) {
    if (!batch || batch.ok !== true) {
      const failure = new Error((batch && batch.errMsg) || '同步失败');
      failure.code = batch && batch.errCode;
      throw failure;
    }
    if (batch.protocolVersion !== PROTOCOL_VERSION
      || batch.viewSchemaVersion !== VIEW_SCHEMA_VERSION
      || batch.eventSchemaVersion !== EVENT_SCHEMA_VERSION) {
      throw Object.assign(new Error('同步协议版本不兼容'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    if (batch.delivery === 'SNAPSHOT') {
      installSnapshot(batch.snapshot, roomId, requestedAt);
      return { snapshotApplied: true, hasMore: false };
    }
    if (batch.delivery !== 'EVENTS') {
      throw Object.assign(new Error('未知同步交付类型'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    const baseSeq = stagingView ? stagingSeq : appliedSeq;
    const baseStateVersion = stagingView ? stagingStateVersion : appliedStateVersion;
    if (Number(batch.afterSeq) !== baseSeq) throw Object.assign(new Error('同步水位不匹配'), { code: ERR.SNAPSHOT_REQUIRED });
    const roomCurrentSeq = Number(batch.roomCurrentSeq);
    if (!Number.isInteger(roomCurrentSeq) || roomCurrentSeq < baseSeq || typeof batch.hasMore !== 'boolean') {
      throw Object.assign(new Error('房间同步上限不可信'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    const events = Array.isArray(batch.events) ? batch.events : null;
    if (!events) throw Object.assign(new Error('事件列表不合法'), { code: ERR.SNAPSHOT_REQUIRED });
    if (batch.hasMore && events.length === 0) {
      throw Object.assign(new Error('同步未推进水位'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    const knownTypes = new Set(Object.values(EVENT_TYPES));
    if (events.some((item) => item.eventSchemaVersion !== EVENT_SCHEMA_VERSION
      || item.viewSchemaVersion !== VIEW_SCHEMA_VERSION
      || item.roomId !== roomId
      || typeof item.commandId !== 'string' || !item.commandId
      || !Array.isArray(item.publicEvents) || item.publicEvents.length === 0 || item.publicEvents.length > 32
      || item.publicEvents.some((publicEvent) => !isRecord(publicEvent)
        || Object.keys(publicEvent).length !== 1 || !knownTypes.has(publicEvent.type))
      || !validatePublicViewPatch(item.publicPatch)
      || (item.actorPatch != null && !validateActorViewPatch(item.actorPatch)))) {
      throw Object.assign(new Error('事件版本或类型不兼容'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    if (events.length && events[0].seq !== baseSeq + 1) throw Object.assign(new Error('事件不连续'), { code: ERR.SNAPSHOT_REQUIRED });
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].seq !== events[index - 1].seq + 1) throw Object.assign(new Error('事件不连续'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    let candidate = clone(stagingView || view);
    let candidateStateVersion = baseStateVersion;
    events.forEach((event) => {
      if (!Number.isInteger(event.stateVersion) || event.stateVersion !== candidateStateVersion + 1) {
        throw Object.assign(new Error('事件状态版本不连续'), { code: ERR.SNAPSHOT_REQUIRED });
      }
      candidate = applyProjectedEvent(candidate, event);
      candidateStateVersion = event.stateVersion;
    });
    const throughSeq = Number(batch.throughSeq);
    if (throughSeq !== (events.length ? events[events.length - 1].seq : baseSeq)) {
      throw Object.assign(new Error('throughSeq 不可信'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    if (throughSeq > roomCurrentSeq
      || (batch.hasMore && throughSeq >= roomCurrentSeq)
      || (!batch.hasMore && throughSeq !== roomCurrentSeq)) {
      throw Object.assign(new Error('同步完成水位不可信'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    if (batch.hasMore) {
      stagingView = candidate;
      stagingSeq = throughSeq;
      stagingStateVersion = candidateStateVersion;
      return { hasMore: true };
    }
    if (!validateMemberView(candidate, roomId)) {
      throw Object.assign(new Error('事件投影房间不可信'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    view = candidate;
    appliedSeq = throughSeq;
    appliedStateVersion = candidateStateVersion;
    ephemeral = mergeEphemeral(ephemeral, batch.ephemeral);
    if (batch.ephemeral && batch.ephemeral.stale
      && batch.ephemeral.stale.presence === false) lastPresenceReadAt = now();
    stagingView = null;
    stagingSeq = 0;
    stagingStateVersion = 0;
    status = 'READY';
    error = null;
    consecutiveSyncFailures = 0;
    observeServerTime(batch.serverTime, requestedAt);
    publish();
    return { hasMore: false };
  }

  async function syncUntilCurrent(initialBatch) {
    if (disposed || paused || !roomId) return view;
    cancelTimer();
    status = stagingView ? 'CATCHING_UP' : 'SYNCING';
    try {
      let requestedAt = now();
      let batch = initialBatch || await gateway.sync(roomId, stagingView ? stagingSeq : appliedSeq,
        syncLimit, getRequestContext({ readPresence: true }));
      while (true) {
        const consumed = consumeBatch(batch, initialBatch ? undefined : requestedAt);
        if (consumed.snapshotApplied) break;
        if (!consumed.hasMore) break;
        requestedAt = now();
        batch = await gateway.sync(roomId, stagingSeq, syncLimit,
          getRequestContext({ readPresence: true }));
      }
      return view;
    } catch (syncError) {
      if (isTerminalRoomError(syncError)) {
        disconnectFromError(syncError);
        return null;
      }
      if (syncError.code === ERR.SNAPSHOT_REQUIRED) {
        stagingView = null;
        stagingSeq = 0;
        stagingStateVersion = 0;
        try {
          return await replaceFromSnapshot(roomId);
        } catch (snapshotError) {
          if (isTerminalRoomError(snapshotError)) {
            disconnectFromError(snapshotError);
            return null;
          }
          syncError = snapshotError;
        }
      }
      status = 'DEGRADED';
      consecutiveSyncFailures += 1;
      error = { errCode: syncError.code || ERR.DEPENDENCY_UNAVAILABLE, errMsg: syncError.message || '同步失败' };
      publish();
      return view;
    } finally {
      schedule(nextPollDelay());
    }
  }

  async function openInternal() {
    disposed = false;
    paused = false;
    status = 'OPENING';
    error = null;
    let current;
    try {
      current = await gateway.currentRoom(getRequestContext());
    } catch (openError) {
      status = 'DEGRADED';
      consecutiveSyncFailures += 1;
      error = { errCode: openError.code || ERR.DEPENDENCY_UNAVAILABLE,
        errMsg: openError.message || '查询当前房间失败' };
      publish();
      schedule(Math.min(15000, intervalMs * (2 ** Math.min(consecutiveSyncFailures, 4))));
      return null;
    }
    if (!current || current.ok !== true) {
      status = 'DEGRADED';
      consecutiveSyncFailures += 1;
      error = { errCode: current && current.errCode, errMsg: current && current.errMsg };
      publish();
      schedule(Math.min(15000, intervalMs * (2 ** Math.min(consecutiveSyncFailures, 4))));
      return null;
    }
    if (!current.roomId) {
      resetConnection('READY');
      publish();
      return null;
    }
    try {
      if (roomId !== current.roomId) resetRoomBoundState(current.roomId);
      await replaceFromSnapshot(current.roomId);
      schedule(0);
      return view;
    } catch (snapshotError) {
      if (isTerminalRoomError(snapshotError)) {
        disconnectFromError(snapshotError);
        return null;
      }
      roomId = current.roomId;
      status = 'DEGRADED';
      error = { errCode: snapshotError.code || ERR.DEPENDENCY_UNAVAILABLE,
        errMsg: snapshotError.message || '打开房间失败' };
      publish();
      schedule(intervalMs);
      return null;
    }
  }

  async function resumeInternal() {
    if (disposed) return null;
    paused = false;
    if (!roomId) return openInternal();
    cancelTimer();
    status = 'RECOVERING';
    error = null;
    try {
      return await replaceFromSnapshot(roomId);
    } catch (resumeError) {
      if (isTerminalRoomError(resumeError)) {
        disconnectFromError(resumeError);
      } else {
        status = 'DEGRADED';
        consecutiveSyncFailures += 1;
        error = { errCode: resumeError.code || ERR.DEPENDENCY_UNAVAILABLE,
          errMsg: resumeError.message || '恢复房间失败' };
      }
      if (!isTerminalRoomError(resumeError)) publish();
      return view;
    } finally {
      schedule(nextPollDelay());
    }
  }

  async function dispatchCommand(input) {
    const signature = stableStringify({ roomId: input.type === 'CREATE_ROOM' ? '' : (input.roomId || roomId || ''),
      type: input.type, context: input.context || {}, payload: input.payload || {} });
    const uncertain = uncertainCommands.get(signature);
    const commandId = input.commandId || (uncertain && uncertain.commandId) || makeCommandId();
    const envelope = { protocolVersion: PROTOCOL_VERSION, commandId,
      roomId: input.type === 'CREATE_ROOM' ? '' : (input.roomId || roomId || ''),
      knownSeq: appliedSeq, type: input.type,
      context: clone(input.context || {}), payload: clone(input.payload || {}), clientSentAt: now() };
    let result;
    let attempts = 0;
    do {
      try { result = await gateway.dispatch(envelope, getRequestContext()); } catch (dispatchError) {
        attempts += 1;
        if (attempts >= 2) {
          // 响应丢失时不能判定服务端是否已提交；下次相同意图必须复用同一 ID。
          uncertainCommands.set(signature, { commandId });
          throw dispatchError;
        }
        continue;
      }
      if (!(result && result.retryable) || attempts >= 1) break;
      attempts += 1;
    } while (true);
    if (!result) {
      // 空响应与网络异常一样无法判断服务端是否已经提交，后续重试必须沿用 commandId。
      uncertainCommands.set(signature, { commandId });
      return { ok: false, errCode: ERR.DEPENDENCY_UNAVAILABLE, errMsg: '命令无响应', retryable: true };
    }
    if (result.retryable === true) uncertainCommands.set(signature, { commandId });
    else uncertainCommands.delete(signature);
    const outcome = result.outcome || {};
    if (result.ok && ['ROOM_CREATED', 'ROOM_JOINED'].includes(outcome.kind)) {
      if (roomId !== outcome.roomId) resetRoomBoundState(outcome.roomId);
      try {
        await replaceFromSnapshot(outcome.roomId);
        schedule(0);
      } catch (snapshotError) {
        // 写入结果已经明确成功；首次 Snapshot 失败只影响读模型恢复，不能把 Command 伪装成失败。
        roomId = outcome.roomId;
        status = 'DEGRADED';
        consecutiveSyncFailures += 1;
        error = { errCode: snapshotError.code || ERR.DEPENDENCY_UNAVAILABLE,
          errMsg: snapshotError.message || '房间已加入，正在恢复状态' };
        publish();
        schedule(Math.min(15000, intervalMs * (2 ** Math.min(consecutiveSyncFailures, 4))));
      }
    } else if (result.ok && ['LEFT_ROOM', 'ROOM_DISSOLVED'].includes(outcome.kind)) {
      resetConnection('READY');
      publish();
    } else if (roomId && result.ok !== true
      && [ERR.NOT_MEMBER, ERR.ROOM_DISSOLVED, ERR.ROOM_NOT_FOUND].includes(result.errCode)) {
      const terminalError = new Error(result.errMsg || '房间连接已经失效');
      terminalError.code = result.errCode;
      disconnectFromError(terminalError);
    } else if (result.sync && result.sync.ok === true) {
      await syncUntilCurrent(result.sync);
    }
    return result;
  }

  async function dispatchInternal(input) {
    cancelTimer();
    try {
      return await dispatchCommand(input);
    } finally {
      // Command 的网络异常、空响应或无附带 Sync 的拒绝都不能让房间轮询永久停止。
      if (roomId && !timer && !disposed && !paused) schedule(intervalMs);
    }
  }

  return {
    open: () => enqueueConnection(openInternal),
    subscribe(listener, subscribeOptions) {
      const id = ++listenerSeq;
      listeners.set(id, listener);
      if (!subscribeOptions || subscribeOptions.emitCurrent !== false) listener(clone(view), state());
      return () => listeners.delete(id);
    },
    dispatch(input) { return enqueueForeground(() => dispatchInternal(input || {})); },
    // refresh 与前后台 resume 共享同一恢复语义：终态错误会断开，可恢复错误会进入退避重试。
    refresh() { return enqueueConnection(resumeInternal); },
    history(query, targetRoomId) {
      return enqueueForeground(() => {
        const queryRoomId = targetRoomId || roomId;
        return queryRoomId && typeof gateway.history === 'function'
          ? gateway.history(queryRoomId, query || {}, getRequestContext())
          : { ok: false, errCode: ERR.NOT_MEMBER, errMsg: '当前没有房间' };
      });
    },
    sessionSnapshot(sessionId, targetRoomId) {
      return enqueueForeground(() => {
        const queryRoomId = targetRoomId || roomId;
        return queryRoomId && typeof gateway.session === 'function'
          ? gateway.session(queryRoomId, sessionId, getRequestContext())
          : { ok: false, errCode: ERR.NOT_MEMBER, errMsg: '当前没有房间' };
      });
    },
    messages(sessionId, query, targetRoomId) {
      return enqueueForeground(() => {
        const queryRoomId = targetRoomId || roomId;
        return queryRoomId && typeof gateway.messages === 'function'
          ? gateway.messages(queryRoomId, sessionId, query || {}, getRequestContext())
          : { ok: false, errCode: ERR.NOT_MEMBER, errMsg: '当前没有房间' };
      });
    },
    leaderboard(sessionId, targetRoomId) {
      return enqueueForeground(() => {
        const queryRoomId = targetRoomId || roomId;
        return queryRoomId && typeof gateway.leaderboard === 'function'
          ? gateway.leaderboard(queryRoomId, sessionId, getRequestContext())
          : { ok: false, errCode: ERR.NOT_MEMBER, errMsg: '当前没有房间' };
      });
    },
    getView() { return clone(view); },
    getState: state,
    getRequestContext,
    pause() { paused = true; cancelTimer(); },
    resume() { return enqueueConnection(resumeInternal); },
    close() { disposed = true; paused = false; resetConnection('CLOSED'); listeners.clear(); }
  };
}

module.exports = {
  ROOM_POLL_INTERVAL_MS, PRESENCE_TOUCH_INTERVAL_MS, PRESENCE_READ_INTERVAL_MS, ROOM_REQUEST_TIMEOUT_MS,
  createRoomClient, createCloudRoomGateway, defaultCommandId
};
