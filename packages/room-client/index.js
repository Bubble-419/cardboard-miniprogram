'use strict';

const { PROTOCOL_VERSION, VIEW_SCHEMA_VERSION, ERR } = require('@cardboard/room-contracts');
const { clone, applyEventGroup } = require('@cardboard/room-projection');

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
    dispatch: (envelope) => call('roomCommand', envelope),
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
  let stagingView = null;
  let stagingSeq = 0;
  let status = 'IDLE';
  let error = null;
  let timer = null;
  let disposed = false;
  let paused = false;
  let lastPresenceAt = 0;
  let listenerSeq = 0;
  let queue = Promise.resolve();
  const listeners = new Map();

  function state() {
    return { roomId, view: clone(view), ephemeral: clone(ephemeral), seq: appliedSeq, status, error: clone(error) };
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
    if (disposed || paused || !roomId) return;
    timer = setTimeoutFn(() => {
      enqueue(syncUntilCurrent).catch((syncError) => console.warn('RoomClient sync', syncError));
    }, delay == null ? intervalMs : delay);
  }

  function enqueue(operation) {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run;
  }

  function resetConnection(nextStatus) {
    cancelTimer();
    roomId = null;
    view = null;
    ephemeral = {};
    appliedSeq = 0;
    stagingView = null;
    stagingSeq = 0;
    status = nextStatus || 'IDLE';
    error = null;
  }

  function validateSnapshot(snapshot) {
    return snapshot && snapshot.ok === true
      && snapshot.protocolVersion === PROTOCOL_VERSION
      && snapshot.viewSchemaVersion === VIEW_SCHEMA_VERSION
      && Number.isInteger(snapshot.seq)
      && snapshot.view;
  }

  async function replaceFromSnapshot(targetRoomId) {
    const snapshot = await gateway.snapshot(targetRoomId);
    if (!validateSnapshot(snapshot)) {
      const invalid = new Error((snapshot && snapshot.errMsg) || '无效的房间快照');
      invalid.code = (snapshot && snapshot.errCode) || ERR.SNAPSHOT_REQUIRED;
      throw invalid;
    }
    roomId = targetRoomId;
    view = clone(snapshot.view);
    ephemeral = clone(snapshot.ephemeral || {});
    appliedSeq = snapshot.seq;
    stagingView = null;
    stagingSeq = 0;
    status = 'READY';
    error = null;
    publish();
    return view;
  }

  function consumeBatch(batch) {
    if (!batch || batch.ok !== true) {
      const failure = new Error((batch && batch.errMsg) || '同步失败');
      failure.code = batch && batch.errCode;
      throw failure;
    }
    if (batch.snapshotRequired) return { snapshotRequired: true };
    const baseSeq = stagingView ? stagingSeq : appliedSeq;
    if (Number(batch.afterSeq) !== baseSeq) throw Object.assign(new Error('同步水位不匹配'), { code: ERR.SNAPSHOT_REQUIRED });
    const events = batch.events || [];
    if (events.length && events[0].seq !== baseSeq + 1) throw Object.assign(new Error('事件不连续'), { code: ERR.SNAPSHOT_REQUIRED });
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].seq !== events[index - 1].seq + 1) throw Object.assign(new Error('事件不连续'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    let candidate = clone(stagingView || view);
    groupEvents(events).forEach((group) => { candidate = applyEventGroup(candidate, group); });
    const throughSeq = Number(batch.throughSeq);
    if (throughSeq !== (events.length ? events[events.length - 1].seq : baseSeq)) {
      throw Object.assign(new Error('throughSeq 不可信'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    if (batch.hasMore) {
      stagingView = candidate;
      stagingSeq = throughSeq;
      return { hasMore: true };
    }
    if (!batch.actorView || !batch.actorView.actor || !batch.actorView.route) {
      throw Object.assign(new Error('最终同步批缺少成员私有投影'), { code: ERR.SNAPSHOT_REQUIRED });
    }
    view = { ...candidate, actor: clone(batch.actorView.actor), route: clone(batch.actorView.route) };
    appliedSeq = throughSeq;
    ephemeral = clone(batch.ephemeral || {});
    stagingView = null;
    stagingSeq = 0;
    status = 'READY';
    error = null;
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
      let batch = initialBatch || await gateway.sync(roomId, stagingView ? stagingSeq : appliedSeq, syncLimit);
      while (true) {
        const consumed = consumeBatch(batch);
        if (consumed.snapshotRequired) {
          await replaceFromSnapshot(roomId);
          break;
        }
        if (!consumed.hasMore) break;
        batch = await gateway.sync(roomId, stagingSeq, syncLimit);
      }
      await maybePresence();
      return view;
    } catch (syncError) {
      if ([ERR.NOT_MEMBER, ERR.ROOM_DISSOLVED, ERR.ROOM_NOT_FOUND].includes(syncError.code)) {
        resetConnection('DISCONNECTED');
        error = { errCode: syncError.code, errMsg: syncError.message };
        publish();
        return null;
      }
      if (syncError.code === ERR.SNAPSHOT_REQUIRED) {
        stagingView = null;
        stagingSeq = 0;
        try { return await replaceFromSnapshot(roomId); } catch (snapshotError) { syncError = snapshotError; }
      }
      status = 'DEGRADED';
      error = { errCode: syncError.code || ERR.DEPENDENCY_UNAVAILABLE, errMsg: syncError.message || '同步失败' };
      publish();
      return view;
    } finally {
      schedule();
    }
  }

  async function openInternal() {
    disposed = false;
    paused = false;
    status = 'OPENING';
    error = null;
    const current = await gateway.currentRoom();
    if (!current || current.ok !== true) {
      status = 'DEGRADED';
      error = { errCode: current && current.errCode, errMsg: current && current.errMsg };
      publish();
      return null;
    }
    if (!current.roomId) {
      resetConnection('READY');
      publish();
      return null;
    }
    await replaceFromSnapshot(current.roomId);
    schedule(0);
    return view;
  }

  async function dispatchInternal(input) {
    const commandId = input.commandId || makeCommandId();
    const envelope = { protocolVersion: PROTOCOL_VERSION, commandId,
      roomId: input.roomId || roomId || '', knownSeq: appliedSeq, type: input.type,
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
    } else if (result.sync && result.sync.ok === true) {
      await syncUntilCurrent(result.sync);
    }
    return result;
  }

  return {
    open: () => enqueue(openInternal),
    subscribe(listener) {
      const id = ++listenerSeq;
      listeners.set(id, listener);
      if (options.emitCurrent !== false) listener(clone(view), state());
      return () => listeners.delete(id);
    },
    dispatch(input) { return enqueue(() => dispatchInternal(input || {})); },
    refresh() { return enqueue(() => roomId ? replaceFromSnapshot(roomId) : openInternal()); },
    getView() { return clone(view); },
    getState: state,
    pause() { paused = true; cancelTimer(); },
    resume() { if (!disposed) { paused = false; schedule(0); } },
    close() { disposed = true; paused = false; resetConnection('CLOSED'); listeners.clear(); }
  };
}

module.exports = { createRoomClient, createCloudRoomGateway, groupEvents, defaultCommandId };
