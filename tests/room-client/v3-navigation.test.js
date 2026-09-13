'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNavigationCoordinator } = require('../../modules/room-navigation/index');

test('导航事件水位按 roomId 隔离，换房后低 seq 仍可驱动页面', async () => {
  const previousGetCurrentPages = global.getCurrentPages;
  global.getCurrentPages = () => [];
  const opened = [];
  try {
    const navigation = createNavigationCoordinator({
      open: async (descriptor) => { opened.push(descriptor.url); }
    });
    await navigation.reconcile({ name: 'modeIndex', params: {} }, 100, { roomId: '11111111' });
    await navigation.reconcile({ name: 'addPlayer', params: {} }, 1, { roomId: '22222222' });
    assert.deepEqual(opened, [
      '/pages/main-pages/modeIndex/index?roomId=11111111',
      '/pages/main-pages/addPlayer/index?roomId=22222222'
    ]);
    assert.equal(navigation.getLastRoomId(), '22222222');
    assert.equal(navigation.getLastSeq(), 1);
  } finally {
    global.getCurrentPages = previousGetCurrentPages;
  }
});
