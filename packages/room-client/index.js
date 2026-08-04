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
  // 无 revision 时不要用 Date.now()：每次轮询都会被当成「更新」而 emit，
  // 游戏页高频 setData 会打爆 scroll-view 横向布局。
  const revision = result.revision != null
    ? Number(result.revision)
    : (roomState.revision != null ? Number(roomState.revision) : 0);

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
  const prevRev = Number(prev.revision) || 0;
  const nextRev = Number(next.revision) || 0;
  // 已建立正 revision 水位后，禁止 revision=0 的未知/旧快照回写（否则会把 play 打回 discussion）
  if (prevRev > 0 && nextRev === 0) return false;
  if (prevRev > 0 && nextRev > 0 && nextRev < prevRev) return false;
  return true;
}

/**
 * 用命令结果乐观补丁本地快照（含 raw.roomState），避免只抬 revision、roomState 仍是旧 phase。
 */
function patchSnapshotFromCommand(prev, result) {
  if (!result || result.ok !== true) return prev;
  const effects = result.effects || {};
  const rev = Number(result.appliedRevision);
  const base = prev && prev.ok === true
    ? prev
    : {
      ok: true,
      roomId: result.roomId || '',
      revision: 0,
      roomState: {},
      raw: { ok: true, roomState: {} },
      members: [],
      memberCount: 0
    };

  const nextRev = Number.isFinite(rev) && rev > 0
    ? Math.max(Number(base.revision) || 0, rev)
    : Number(base.revision) || 0;
  const roomState = { ...(base.roomState || {}) };
  const raw = base.raw && typeof base.raw === 'object' ? { ...base.raw } : { ok: true };
  const rawRoomState = { ...(raw.roomState || {}) };

  if (effects.advancedTurn === true || (effects.activeSeatNo != null && effects.legacyPage === 'gamepage')) {
    roomState.partnerGamePhase = 'play';
    rawRoomState.partnerGamePhase = 'play';
    roomState.partnerMasterMode = false;
    rawRoomState.partnerMasterMode = false;
    if (effects.activeSeatNo != null) {
      roomState.currentPlayerIndex = effects.activeSeatNo;
      rawRoomState.currentPlayerIndex = effects.activeSeatNo;
    }
    if (effects.roundNo != null) {
      roomState.currentRound = effects.roundNo;
      rawRoomState.currentRound = effects.roundNo;
    }
    roomState.currentPage = 'gamepage';
    rawRoomState.currentPage = 'gamepage';
    // 换轮必须清零评分快照，否则 emit 瞬间仍带上一回合满分 → 误亮「开始表态」
    const seat = effects.activeSeatNo != null
      ? effects.activeSeatNo
      : roomState.currentPlayerIndex;
    const round = effects.roundNo != null
      ? effects.roundNo
      : roomState.currentRound;
    const freshProgress = {
      scoredCount: 0,
      requiredScoreCount: 0,
      votedCount: 0,
      requiredVoteCount: 0,
      turnId: (effects.turnId
        || (seat != null && round != null ? `turn_r${round}_s${seat}` : null))
    };
    roomState.scoredCount = 0;
    roomState.totalRequired = 0;
    roomState.progress = freshProgress;
    rawRoomState.scoredCount = 0;
    rawRoomState.totalRequired = 0;
    rawRoomState.progress = { ...freshProgress };
  }

  if (nextRev > 0) {
    roomState.revision = nextRev;
    rawRoomState.revision = nextRev;
  }

  raw.roomState = rawRoomState;
  if (nextRev > 0) raw.revision = nextRev;

  return {
    ...base,
    revision: nextRev,
    roomState,
    raw,
    syncedAt: Date.now()
  };
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
  let transport = options.transport;
  let intervalMs = options.intervalMs != null ? options.intervalMs : 2000;
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

  async function pullOnce(opts) {
    const force = !!(opts && opts.force);
    if (disposed || paused || !transport || typeof transport.fetchSnapshot !== 'function') {
      return snapshot;
    }
    if (inFlight) {
      if (!force) return snapshot;
      // 等待当前请求结束后再强制拉一次，避免 dispatch 后读到旧 revision
      await new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
          if (!inFlight || disposed || Date.now() - started > 4000) {
            resolve();
            return;
          }
          setTimeout(tick, 24);
        };
        tick();
      });
      if (disposed || paused) return snapshot;
      if (inFlight) return snapshot;
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
    /**
     * @param {Function} listener
     * @param {{ emitCurrent?: boolean }} [subOpts] emitCurrent 默认 true；
     *   gamepage 应传 false，避免进页同步 setData 打坏 scroll-view 横向头像
     */
    subscribe(listener, subOpts) {
      const id = ++subscriberSeq;
      subscribers.set(id, listener);
      const emitCurrent = !subOpts || subOpts.emitCurrent !== false;
      if (emitCurrent && snapshot) {
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
    async refresh(opts) {
      return pullOnce(opts);
    },
    /**
     * 同房间内升级轮询参数（不 dispose），避免 gamepage 进页重建会话触发布局抖动
     */
    reconfigure(next) {
      if (disposed) return;
      if (next && next.transport) {
        transport = next.transport;
      }
      if (next && next.intervalMs != null && next.intervalMs !== intervalMs) {
        intervalMs = next.intervalMs;
        const wasPolling = !!pollTimer && !paused;
        stopPolling();
        if (wasPolling) startPolling();
      }
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
        // 先按 effects 补丁 roomState/raw（含 phase），再抬水位并 emit，最后强制拉齐
        snapshot = patchSnapshotFromCommand(snapshot, result);
        appliedRevision = Math.max(
          appliedRevision,
          Number(snapshot && snapshot.revision) || 0,
          Number(result.appliedRevision) || 0
        );
        emit();
        await pullOnce({ force: true });
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
    },
    _getIntervalMs() {
      return intervalMs;
    }
  };
}

module.exports = {
  createRoomSession,
  normalizeLegacyResult,
  shouldApplySnapshot,
  patchSnapshotFromCommand
};
