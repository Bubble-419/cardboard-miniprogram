'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRoomClient } = require('@cardboard/room-client');

function inertTimers() {
  let id = 0;
  return { setTimeoutFn: () => ++id, clearTimeoutFn: () => {} };
}

test('READY 后 refresh 仍再拉完整 Snapshot，而不是用已有 View', async () => {
  let snapshotCalls = 0;
  const view = {
    room: { roomId: '12345678', workshopName: '已在内存' },
    session: { sessionId: 'sess-1' },
    actor: { memberId: 'm1' },
    route: { name: 'gamepage', params: {} }
  };
  const gateway = {
    currentRoom: async () => ({ ok: true, roomId: '12345678' }),
    snapshot: async () => {
      snapshotCalls += 1;
      return {
        ok: true,
        protocolVersion: 3,
        viewSchemaVersion: 1,
        roomId: '12345678',
        seq: snapshotCalls,
        stateVersion: snapshotCalls,
        view,
        ephemeral: {},
        minAvailableSeq: 1
      };
    },
    sync: async () => ({
      ok: true,
      protocolVersion: 3,
      viewSchemaVersion: 1,
      eventSchemaVersion: 3,
      afterSeq: snapshotCalls,
      throughSeq: snapshotCalls,
      roomCurrentSeq: snapshotCalls,
      hasMore: false,
      snapshotRequired: false,
      events: []
    })
  };
  const client = createRoomClient({ gateway, ...inertTimers() });
  await client.open();
  assert.equal(snapshotCalls, 1);
  await client.refresh();
  assert.equal(snapshotCalls, 2, 'refresh() 在已有 READY View 时仍走完整 Snapshot');
});

test('gamepage 首屏把正确状态挡在多次 Snapshot 和串行云调用之后', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/gamepage/index.js'),
    'utf8'
  );
  assert.match(source, /getRoomPageSnapshot\(roomId, \{ refresh: true \}\)/);
  assert.match(source, /emitCurrent:\s*false/);
  assert.match(source, /await this\._ensureSharedRoundTimerOnEnter\(\)/);
  assert.match(source, /getRoomPageSnapshot\(this\.data\.roomId, \{ refresh: true \}\)/);
  assert.match(source, /await this\._syncRoundSpeech\(\)/);
  assert.match(source, /await this\._syncRoundContentToRoom\(\)/);
  assert.match(source, /await this\._refreshInspirationCount\(\)/);
});
