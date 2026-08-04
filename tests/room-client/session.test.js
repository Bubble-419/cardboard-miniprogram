'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createRoomSession,
  normalizeLegacyResult,
  shouldApplySnapshot
} = require('@cardboard/room-client');
const {
  projectRoute,
  createNavigationCoordinator
} = require('../../modules/room-navigation/index');

describe('room-client RoomSession', () => {
  it('normalizes legacy poll and drops stale revision', () => {
    const a = normalizeLegacyResult({
      ok: true,
      isHost: true,
      members: [{ playerIndex: 1, isMe: true }],
      roomState: { currentPage: 'modeIndex', revision: 5 }
    }, '1');
    assert.equal(a.ok, true);
    assert.equal(a.revision, 5);

    const newer = normalizeLegacyResult({
      ok: true,
      roomState: { currentPage: 'selectPlayer', revision: 6 }
    }, '1');
    assert.equal(shouldApplySnapshot(a, newer), true);

    const stale = normalizeLegacyResult({
      ok: true,
      roomState: { currentPage: 'modeIndex', revision: 4 }
    }, '1');
    assert.equal(shouldApplySnapshot(newer, stale), false);
  });

  it('rejects revision=0 snapshot after positive revision watermark', () => {
    const keyed = normalizeLegacyResult({
      ok: true,
      revision: 11,
      roomState: { currentPage: 'gamepage', partnerGamePhase: 'play', revision: 11 }
    }, '1');
    const unknown = normalizeLegacyResult({
      ok: true,
      roomState: { currentPage: 'gamepage', partnerGamePhase: 'discussion' }
    }, '1');
    assert.equal(keyed.revision, 11);
    assert.equal(unknown.revision, 0);
    assert.equal(shouldApplySnapshot(keyed, unknown), false);
  });

  it('patches ADVANCE_TURN effects into snapshot roomState and raw', () => {
    const {
      patchSnapshotFromCommand
    } = require('@cardboard/room-client');
    const prev = normalizeLegacyResult({
      ok: true,
      revision: 3,
      members: [{ playerIndex: 1 }],
      roomState: {
        currentPage: 'gamepage',
        partnerGamePhase: 'discussion',
        currentPlayerIndex: 1,
        revision: 3
      }
    }, 'room-x');
    const next = patchSnapshotFromCommand(prev, {
      ok: true,
      appliedRevision: 4,
      roomId: 'room-x',
      effects: {
        advancedTurn: true,
        activeSeatNo: 2,
        roundNo: 2,
        legacyPage: 'gamepage'
      }
    });
    assert.equal(next.revision, 4);
    assert.equal(next.roomState.partnerGamePhase, 'play');
    assert.equal(next.roomState.currentPlayerIndex, 2);
    assert.equal(next.roomState.scoredCount, 0);
    assert.equal(next.roomState.progress && next.roomState.progress.scoredCount, 0);
    assert.equal(next.raw.roomState.partnerGamePhase, 'play');
    assert.equal(next.raw.revision, 4);
  });

  it('runs a single poll loop with in-flight guard', async () => {
    let calls = 0;
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const timers = [];
    const session = createRoomSession({
      roomId: 'room-1',
      intervalMs: 10000,
      setIntervalFn: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearIntervalFn: () => {},
      transport: {
        async fetchSnapshot() {
          calls += 1;
          if (calls === 1) {
            return fetchPromise;
          }
          return {
            ok: true,
            roomState: { currentPage: 'addPlayer', revision: 2 }
          };
        }
      }
    });

    const openDone = session.open();
    // 第二次 pull 应被 inFlight 挡住
    const second = session.refresh();
    resolveFetch({
      ok: true,
      isHost: false,
      members: [],
      roomState: { currentPage: 'addPlayer', revision: 1 }
    });
    await openDone;
    await second;
    assert.equal(calls, 1);
    assert.equal(session.getSnapshot().revision, 1);
    assert.equal(session._isPolling(), true);

    let notified = 0;
    session.subscribe(() => {
      notified += 1;
    });
    assert.ok(notified >= 1);

    session.pause();
    assert.equal(session._isPaused(), true);
    session.dispose();
  });
  it('skips sync emit when emitCurrent is false', async () => {
    const session = createRoomSession({
      roomId: 'room-2',
      intervalMs: 10000,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      transport: {
        async fetchSnapshot() {
          return {
            ok: true,
            members: [],
            roomState: { currentPage: 'gamepage', revision: 3 }
          };
        }
      }
    });
    await session.open();
    let notified = 0;
    session.subscribe(() => {
      notified += 1;
    }, { emitCurrent: false });
    assert.equal(notified, 0);
    await session.refresh();
    assert.equal(notified, 1);
    session.dispose();
  });

  it('reconfigure upgrades interval without dropping snapshot', async () => {
    const timers = [];
    const session = createRoomSession({
      roomId: 'room-3',
      intervalMs: 2000,
      setIntervalFn: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearIntervalFn: () => {},
      transport: {
        async fetchSnapshot() {
          return {
            ok: true,
            members: [{ playerIndex: 1 }],
            roomState: { currentPage: 'gamepage', revision: 1 }
          };
        }
      }
    });
    await session.open();
    assert.equal(session.getSnapshot().revision, 1);
    session.reconfigure({ intervalMs: 800 });
    assert.equal(session._getIntervalMs(), 800);
    assert.equal(session.getSnapshot().revision, 1);
    session.dispose();
  });

  it('missing revision normalizes to 0 instead of Date.now()', () => {
    const a = normalizeLegacyResult({
      ok: true,
      members: [],
      roomState: { currentPage: 'gamepage' }
    }, '1');
    assert.equal(a.revision, 0);
  });

  it('emits ok:false dissolve poll so pages can exit home', async () => {
    const seen = [];
    const session = createRoomSession({
      roomId: 'room-gone',
      intervalMs: 10000,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      transport: {
        async fetchSnapshot() {
          return {
            ok: false,
            errCode: 'ROOM_DISSOLVED',
            errMsg: '房间已解散',
            roomDissolved: true,
            event: 'room_dissolved',
            roomId: 'room-gone'
          };
        }
      }
    });
    session.subscribe((snap) => {
      seen.push(snap);
    }, { emitCurrent: false });
    await session.open();
    assert.equal(seen.length >= 1, true);
    const last = seen[seen.length - 1];
    assert.equal(last.ok, false);
    assert.equal(last.errCode, 'ROOM_DISSOLVED');
    assert.equal(last.raw && last.raw.roomDissolved, true);
    session.dispose();
  });
});

describe('room-navigation projector', () => {
  it('projects legacy page to route descriptor', () => {
    const route = projectRoute({
      legacyPage: 'confirmFirstPlayer',
      actorRole: 'HOST'
    });
    assert.equal(route.pageKey, 'confirmfirstplayer');
    assert.ok(route.path.indexOf('confirmFirstPlayer') >= 0);
  });

  it('coordinator ignores stale revision', async () => {
    const opened = [];
    const nav = createNavigationCoordinator({
      openUrl: (desc) => {
        opened.push(desc.path);
      }
    });
    await nav.reconcile(projectRoute({ legacyPage: 'selectPlayer' }), 2);
    const stale = await nav.reconcile(projectRoute({ legacyPage: 'modeIndex' }), 1);
    assert.equal(stale.skipped, true);
    assert.equal(opened.length, 1);
  });
});
