'use strict';

const {
  PROTOCOL_VERSION, VIEW_SCHEMA_VERSION, EVENT_SCHEMA_VERSION, EVENT_TYPES, ERR
} = require('../room-contracts/index');
const { clone, applyEventGroup } = require('../room-projection/index');

function defaultCommandId() {
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function unwrapCloudResult(response) {
  return response && Object.prototype.hasOwnProperty.call(response, 'result') ? response.result : response;
}

/** 将 wx.cloud.callFunction 收敛为 RoomClient 唯一传输端口。 */
function createCloudRoomGateway(options) {
  const callFunction = options && options.callFunction;
  if (typeof callFunction !== 'function') throw new Error('callFunction required');
  const call = async (name, data) => unwrapCloudResult(await callFunction({ name, data }));
  return {
    currentRoom: () => call('roomQuery', { action: 'current' }),
    snapshot: (roomId) => call('roomQuery', { action: 'snapshot', roomId }),
    sync: (roomId, afterSeq, limit) => call('roomQuery', { action: 'sync', roomId, afterSeq, limit }),
    history: (roomId, query) => call('roomQuery', { action: 'history', roomId, ...(query || {}) }),
    session: (roomId, sessionId) => call('roomQuery', { action: 'session', roomId, sessionId }),
    messages: (roomId, sessionId, query) => call('roomQuery', {
      action: 'messages', roomId, sessionId, ...(query || {})
    }),
    leaderboard: (roomId, sessionId) => call('roomQuery', { action: 'leaderboard', roomId, sessionId }),
    // Command 放在独立传输字段中，避免 CloudBase 注入的 tcbContext 污染严格协议对象。
    dispatch: (envelope) => call('roomCommand', { command: envelope }),
    presence: (roomId, deviceSessionId) => call('roomPresence', { roomId, deviceSessionId })
  };
}

function groupEvents(events) {
  const groups = [];
  (events || []).forEach((item) => {
    const last = groups[groups.length - 1];
    if (!last || last[0].commandId !== item.commandId) groups.push([item]);
    else last.push(item);
  });
  return groups;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validPublicPatch(value) {
  if (!isRecord(value) || !Array.isArray(value.remove)) return false;
  const validPath = (path) => typeof path === 'string' && path.length > 0 && path.length <= 512;
  const validSet = Array.isArray(value.set)
    ? value.set.every((item) => isRecord(item)
      && Object.keys(item).every((key) => key === 'path' || key === 'value')
      && Object.prototype.hasOwnProperty.call(item, 'value')
      && validPath(item.path))
    : isRecord(value.set) && Object.keys(value.set).every(validPath);
  return validSet && value.remove.every(validPath);
}

function createRoomClient(options) {
  const gateway = options && options.gateway;
  if (!gateway) throw new Error('RoomGateway required');
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 1200;
  const presenceIntervalMs = Number(options.presenceIntervalMs) > 0 ? Number(options.presenceIntervalMs) : 10000;
  const syncLimit = Math.min(100, Math.max(1, Number(options.syncLimit) || 100));
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
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
  let disposed = false;
  let paused = false;
  let lastPresenceAt = 0;
  let consecutiveSyncFailures = 0;
  let serverClockOffsetMs = 0;
  let listenerSeq = 0;
  let queue = Promise.resolve();
  const listeners = new Map();

  function state() {
    return {
      roomId, view: clone(view), ephemeral: clone(ephemeral), seq: appliedSeq,
      stateVersion: appliedStateVersion, status, error: clone(error),
      serverClockOffsetMs, serverNow: Date.now() + serverClockOffsetMs
    };
  }

  function observeServerTime(serverTime, requestedAt) {
    const receivedAt = Date.now();
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
    if (timer) clearTimeoutFn(timer);
    timer = null;
  }

  function schedule(delay) {
    cancelTimer();
    if (disposed || paused || (!roomId && status !== 'DEGRADED')) return;
    timer = setTimeoutFn(() => {
      const operation = roomId ? syncUntilCurrent : openInternal;
      return enqueue(operation).catch((syncError) => console.warn('RoomClient sync', syncError));
    }, delay == null ? intervalMs : delay);
  }

  function enqueue(operation) {
    // Promise.then 会把上一任务的返回值作为参数传入；syncUntilCurrent 的首参有协议语义，必须显式隔离。
    const run = queue.then(() => operation(), () => operation());
    queue = run.catch(() => undefined);
    return run;
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
    status = nextStatus || 'IDLE';
    error = null;
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
      && snapshot.view && snapshot.view.room && snapshot.view.room.roomId === targetRoomId
      && snapshot.view.actor && snapshot.view.route;
  }

  async function replaceFromSnapshot(targetRoomId) {
    const requestedAt = Date.now();
    const snapshot = await gateway.snapshot(targetRoomId);
    if (!validateSnapshot(snapshot, targetRoomId)) {
      const invalid = new Error((snapshot && snapshot.errMsg) || '无效的房间快照');
      invalid.code = (snapshot && snapshot.errCode) || ERR.SNAPSHOT_REQUIRED;
      throw invalid;
    }
    roomId = targetRoomId;
    view = clone(snapshot.view);
    ephemeral = clone(snapshot.ephemeral || {});
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
    if (batch.snapshotRequired) return { snapshotRequired: true };
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
      || item.roomId !== roomId || !knownTypes.has(item.type))) {
      throw Object.assign(new Error('事件版本或类型不兼容'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    if (events.length && events[0].seq !== baseSeq + 1) throw Object.assign(new Error('事件不连续'), { code: ERR.SNAPSHOT_REQUIRED });
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].seq !== events[index - 1].seq + 1) throw Object.assign(new Error('事件不连续'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    let candidate = clone(stagingView || view);
    let candidateStateVersion = baseStateVersion;
    groupEvents(events).forEach((group) => {
      const commandId = group[0] && group[0].commandId;
      if (!commandId || group.some((item) => item.commandId !== commandId)) {
        throw Object.assign(new Error('事件组不合法'), { code: ERR.SNAPSHOT_REQUIRED });
      }
      const groupStateVersion = group[0].stateVersion;
      const lastIndex = group.length - 1;
      if (!Number.isInteger(groupStateVersion)
        || groupStateVersion !== candidateStateVersion + 1
        || group.some((item) => item.stateVersion !== groupStateVersion)
        || group.some((item, index) => index !== lastIndex && item.payload && item.payload.publicPatch)
        || !validPublicPatch(group[lastIndex] && group[lastIndex].payload
          && group[lastIndex].payload.publicPatch)) {
        throw Object.assign(new Error('事件组缺少可信公开补丁'), { code: ERR.SNAPSHOT_REQUIRED });
      }
      candidate = applyEventGroup(candidate, group);
      candidateStateVersion = groupStateVersion;
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
    if (!batch.actorView || !batch.actorView.actor || !batch.actorView.route) {
      throw Object.assign(new Error('最终同步批缺少成员私有投影'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    if (!candidate || !candidate.room || candidate.room.roomId !== roomId) {
      throw Object.assign(new Error('事件投影房间不可信'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    view = { ...candidate, actor: clone(batch.actorView.actor), route: clone(batch.actorView.route) };
    appliedSeq = throughSeq;
    appliedStateVersion = candidateStateVersion;
    ephemeral = clone(batch.ephemeral || {});
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

  async function maybePresence() {
    if (typeof gateway.presence !== 'function' || Date.now() - lastPresenceAt < presenceIntervalMs) return;
    lastPresenceAt = Date.now();
    gateway.presence(roomId, deviceSessionId).catch(() => undefined);
  }

  async function syncUntilCurrent(initialBatch) {
    if (disposed || paused || !roomId) return view;
    cancelTimer();
    status = stagingView ? 'CATCHING_UP' : 'SYNCING';
    try {
      let requestedAt = Date.now();
      let batch = initialBatch || await gateway.sync(roomId, stagingView ? stagingSeq : appliedSeq, syncLimit);
      while (true) {
        const consumed = consumeBatch(batch, initialBatch ? undefined : requestedAt);
        if (consumed.snapshotRequired) {
          await replaceFromSnapshot(roomId);
          break;
        }
        if (!consumed.hasMore) break;
        requestedAt = Date.now();
        batch = await gateway.sync(roomId, stagingSeq, syncLimit);
      }
      await maybePresence();
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
      const retryDelay = status === 'DEGRADED'
        ? Math.min(15000, intervalMs * (2 ** Math.min(consecutiveSyncFailures, 4)))
        : intervalMs;
      schedule(retryDelay);
    }
  }

  async function openInternal() {
    disposed = false;
    paused = false;
    status = 'OPENING';
    error = null;
    let current;
    try {
      current = await gateway.currentRoom();
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
      const retryDelay = status === 'DEGRADED'
        ? Math.min(15000, intervalMs * (2 ** Math.min(consecutiveSyncFailures, 4)))
        : intervalMs;
      schedule(retryDelay);
    }
  }

  async function dispatchInternal(input) {
    const commandId = input.commandId || makeCommandId();
    const envelope = { protocolVersion: PROTOCOL_VERSION, commandId,
      roomId: input.type === 'CREATE_ROOM' ? '' : (input.roomId || roomId || ''),
      knownSeq: appliedSeq, type: input.type,
      context: clone(input.context || {}), payload: clone(input.payload || {}), clientSentAt: Date.now() };
    let result;
    let attempts = 0;
    do {
      try { result = await gateway.dispatch(envelope); } catch (dispatchError) {
        attempts += 1;
        if (attempts >= 2) throw dispatchError;
        continue;
      }
      if (!(result && result.retryable) || attempts >= 1) break;
      attempts += 1;
    } while (true);
    if (!result) return { ok: false, errCode: ERR.DEPENDENCY_UNAVAILABLE, errMsg: '命令无响应', retryable: true };
    const outcome = result.outcome || {};
    if (result.ok && ['ROOM_CREATED', 'ROOM_JOINED'].includes(outcome.kind)) {
      await replaceFromSnapshot(outcome.roomId);
      schedule(0);
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

  return {
    open: () => enqueue(openInternal),
    subscribe(listener, subscribeOptions) {
      const id = ++listenerSeq;
      listeners.set(id, listener);
      if (!subscribeOptions || subscribeOptions.emitCurrent !== false) listener(clone(view), state());
      return () => listeners.delete(id);
    },
    dispatch(input) { return enqueue(() => dispatchInternal(input || {})); },
    // refresh 与前后台 resume 共享同一恢复语义：终态错误会断开，可恢复错误会进入退避重试。
    refresh() { return enqueue(resumeInternal); },
    history(query, targetRoomId) {
      const queryRoomId = targetRoomId || roomId;
      return queryRoomId && typeof gateway.history === 'function'
        ? gateway.history(queryRoomId, query || {})
        : Promise.resolve({ ok: false, errCode: ERR.NOT_MEMBER, errMsg: '当前没有房间' });
    },
    sessionSnapshot(sessionId, targetRoomId) {
      const queryRoomId = targetRoomId || roomId;
      return queryRoomId && typeof gateway.session === 'function'
        ? gateway.session(queryRoomId, sessionId)
        : Promise.resolve({ ok: false, errCode: ERR.NOT_MEMBER, errMsg: '当前没有房间' });
    },
    messages(sessionId, query, targetRoomId) {
      const queryRoomId = targetRoomId || roomId;
      return queryRoomId && typeof gateway.messages === 'function'
        ? gateway.messages(queryRoomId, sessionId, query || {})
        : Promise.resolve({ ok: false, errCode: ERR.NOT_MEMBER, errMsg: '当前没有房间' });
    },
    leaderboard(sessionId, targetRoomId) {
      const queryRoomId = targetRoomId || roomId;
      return queryRoomId && typeof gateway.leaderboard === 'function'
        ? gateway.leaderboard(queryRoomId, sessionId)
        : Promise.resolve({ ok: false, errCode: ERR.NOT_MEMBER, errMsg: '当前没有房间' });
    },
    getView() { return clone(view); },
    getState: state,
    pause() { paused = true; cancelTimer(); },
    resume() { return enqueue(resumeInternal); },
    close() { disposed = true; paused = false; resetConnection('CLOSED'); listeners.clear(); }
  };
}

module.exports = { createRoomClient, createCloudRoomGateway, groupEvents, defaultCommandId };
