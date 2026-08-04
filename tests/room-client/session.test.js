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
