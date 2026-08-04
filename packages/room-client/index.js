'use strict';

/**
 * 将 legacy getAddPlayerData 结果规整为 RoomViewSnapshot
 */
function normalizeLegacyResult(result, roomId) {
  if (!result || result.ok !== true) {
    return {
      ok: false,
      roomId,
      errCode: (result && result.errCode) || 'LEGACY_POLL_ERROR',
      errMsg: (result && result.errMsg) || '同步失败',
      raw: result || null
    };
  }
  const roomState = result.roomState || {};
  const protocolVersion = result.protocolVersion != null
    ? Number(result.protocolVersion)
    : (roomState.protocolVersion != null ? Number(roomState.protocolVersion) : 1);
  const revision = result.revision != null
    ? Number(result.revision)
    : (roomState.revision != null ? Number(roomState.revision) : Date.now());

  return {
    ok: true,
    roomId: roomId || result.roomId,
    protocolVersion,
    revision,
    isHost: result.isHost === true,
    members: result.members || [],
    memberCount: result.memberCount != null ? result.memberCount : (result.members || []).length,
    roomState,
    workshopName: result.workshopName,
    selectedModeId: result.selectedModeId != null ? result.selectedModeId : roomState.selectedModeId,
    hasSelectedMode: result.hasSelectedMode === true,
    selectedBG: result.selectedBG || null,
    selectedDesignProblem: result.selectedDesignProblem || roomState.selectedDesignProblem || null,
    qrcodeFileID: result.qrcodeFileID || null,
    qrcodeUrl: result.qrcodeUrl || null,
    lastEvent: result.lastEvent || null,
    role: result.role || null,
    raw: result,
    syncedAt: Date.now()
  };
}

function shouldApplySnapshot(prev, next) {
  if (!next || next.ok !== true) return false;
  if (!prev || prev.ok !== true) return true;
  if (next.revision < prev.revision) return false;
  return true;
}

/**
 * @param {object} options
 * @param {string} options.roomId
 * @param {{ fetchSnapshot: (ctx) => Promise<object>, dispatchCommand?: Function }} options.transport
 * @param {number} [options.intervalMs]
 * @param {(ms: number, fn: Function) => any} [options.setIntervalFn]
 * @param {(id: any) => void} [options.clearIntervalFn]
 */
function createRoomSession(options) {
  const roomId = options.roomId;
  const transport = options.transport;
  const intervalMs = options.intervalMs != null ? options.intervalMs : 2000;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;

  let snapshot = null;
  let appliedRevision = 0;
  let pollTimer = null;
  let inFlight = false;
  let seq = 0;
  let appliedSeq = 0;
  let paused = false;
  let disposed = false;
  let subscriberSeq = 0;
  const subscribers = new Map();

  function emit() {
    subscribers.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (e) {
        console.warn('RoomSession subscriber error', e);
      }
    });
  }

  async function pullOnce() {
    if (disposed || paused || inFlight || !transport || typeof transport.fetchSnapshot !== 'function') {
      return snapshot;
    }
    inFlight = true;
    const mySeq = ++seq;
    try {
      const raw = await transport.fetchSnapshot({
        roomId,
        appliedRevision,
        full: false
      });
      if (disposed || mySeq < appliedSeq) return snapshot;
      const next = normalizeLegacyResult(raw, roomId);
      if (next.ok && shouldApplySnapshot(snapshot, next)) {
        snapshot = next;
        appliedRevision = next.revision;
        appliedSeq = mySeq;
        emit();
      } else if (!next.ok) {
        snapshot = next;
        appliedSeq = mySeq;
        emit();
      }
      return snapshot;
    } finally {
      inFlight = false;
    }
  }

  function startPolling() {
    if (disposed || pollTimer) return;
    pollTimer = setIntervalFn(() => {
      pullOnce().catch((e) => console.warn('RoomSession poll', e));
    }, intervalMs);
  }

  function stopPolling() {
    if (pollTimer) {
      clearIntervalFn(pollTimer);
      pollTimer = null;
    }
  }

  return {
    roomId,
    async open() {
      disposed = false;
      paused = false;
      await pullOnce();
      startPolling();
      return snapshot;
    },
    subscribe(listener) {
      const id = ++subscriberSeq;
      subscribers.set(id, listener);
      if (snapshot) {
        try {
          listener(snapshot);
        } catch (e) {
          // ignore
        }
      }
      return () => {
        subscribers.delete(id);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    getAppliedRevision() {
      return appliedRevision;
    },
    async refresh() {
      return pullOnce();
    },
    pause() {
      paused = true;
      stopPolling();
    },
    resume() {
      if (disposed) return;
      paused = false;
      // 恢复时立即校准一次，再进入周期轮询
      pullOnce().catch((e) => console.warn('RoomSession resume', e));
      startPolling();
    },
    async dispatch(command) {
      if (!transport || typeof transport.dispatchCommand !== 'function') {
        return { ok: false, errCode: 'NOT_SUPPORTED', errMsg: 'transport 不支持命令' };
      }
      const result = await transport.dispatchCommand(command);
      if (result && result.ok === true) {
        await pullOnce();
      }
      return result;
    },
    dispose() {
      disposed = true;
      stopPolling();
      subscribers.clear();
      snapshot = null;
    },
    /** @private test helpers */
    _isPolling() {
      return !!pollTimer;
    },
    _isPaused() {
      return paused;
    }
  };
}

module.exports = {
  createRoomSession,
  normalizeLegacyResult,
  shouldApplySnapshot
};
