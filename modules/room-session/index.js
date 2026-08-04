'use strict';

const { createRoomSession } = require('../../packages/room-client/index');
const { followSubScreenRoomPoll } = require('../../utils/subScreenRoomPoll');

function createLegacyTransport(roomId) {
  return {
    async fetchSnapshot({ full }) {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId, full: full === true }
      });
      return (res && res.result) || {};
    },
    async dispatchCommand(command) {
      if (!command || !command.type) {
        return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'command.type 必填' };
      }
      // Phase 4：通用流程仍主要走 updateRoomState；V2 roomCommand 后续接入
      if (command.type === 'UPDATE_ROOM_STATE' || command.legacy === 'updateRoomState') {
        const res = await wx.cloud.callFunction({
          name: 'updateRoomState',
          data: Object.assign({ roomId }, command.payload || {})
        });
        return (res && res.result) || { ok: false };
      }
      const res = await wx.cloud.callFunction({
        name: 'roomCommand',
        data: Object.assign({ roomId }, command)
      });
      return (res && res.result) || { ok: false };
    }
  };
}

/**
 * App 级 RoomSession 管理：同一 roomId 复用，切换房间先 dispose
 */
function getActiveRoomSession() {
  const app = getApp();
  return (app.globalData && app.globalData.roomSession) || null;
}

async function openRoomSession(roomId, options) {
  if (!roomId) {
    throw new Error('roomId required');
  }
  const app = getApp();
  app.globalData = app.globalData || {};
  const existing = app.globalData.roomSession;
  if (existing && existing.roomId === roomId) {
    if (options && options.intervalMs && existing._intervalMs !== options.intervalMs) {
      // 间隔变化时重建，避免大厅/流程页互相拖慢
      existing.dispose();
      app.globalData.roomSession = null;
    } else {
      return existing;
    }
  }
  if (existing) {
    existing.dispose();
    app.globalData.roomSession = null;
  }

  const intervalMs = (options && options.intervalMs) || 2000;
  const session = createRoomSession({
    roomId,
    intervalMs,
    transport: createLegacyTransport(roomId)
  });
  session._intervalMs = intervalMs;
  app.globalData.roomSession = session;
  app.globalData.roomId = roomId;
  await session.open();
  return session;
}

function disposeRoomSession() {
  const app = getApp();
  if (app.globalData && app.globalData.roomSession) {
    app.globalData.roomSession.dispose();
    app.globalData.roomSession = null;
  }
}

function pauseRoomSession() {
  const session = getActiveRoomSession();
  if (session) session.pause();
}

function resumeRoomSession() {
  const session = getActiveRoomSession();
  if (session) session.resume();
}

/**
 * 页面绑定：onShow 订阅，onHide 退订（不 dispose 会话）
 * @param {object} page this
 * @param {object} options
 * @param {() => string} options.getRoomId
 * @param {(snapshot: object) => void} options.onSnapshot
 * @param {number} [options.intervalMs]
 * @param {boolean} [options.followNavigation] 是否对副屏走 followSubScreenRoomPoll
 */
async function bindPageToRoomSession(page, options) {
  const getRoomId = options.getRoomId;
  const onSnapshot = options.onSnapshot;
  const roomId = typeof getRoomId === 'function' ? getRoomId.call(page) : '';
  if (!roomId) return null;

  const session = await openRoomSession(roomId, {
    intervalMs: options.intervalMs || 2000
  });

  if (page._roomSessionUnsub) {
    page._roomSessionUnsub();
    page._roomSessionUnsub = null;
  }

  page._roomSessionUnsub = session.subscribe((snapshot) => {
    if (!snapshot) return;
    if (typeof onSnapshot === 'function') {
      onSnapshot.call(page, snapshot);
    }
    if (options.followNavigation && snapshot.ok && snapshot.raw) {
      followSubScreenRoomPoll(snapshot.raw, roomId, {
        beforeNavigate: options.beforeNavigate
          ? (result, pageKey) => options.beforeNavigate.call(page, result, pageKey)
          : undefined
      });
    }
  });

  page._boundRoomSession = session;
  return session;
}

function unbindPageFromRoomSession(page) {
  if (page && page._roomSessionUnsub) {
    page._roomSessionUnsub();
    page._roomSessionUnsub = null;
  }
  page._boundRoomSession = null;
}

module.exports = {
  getActiveRoomSession,
  openRoomSession,
  disposeRoomSession,
  pauseRoomSession,
  resumeRoomSession,
  bindPageToRoomSession,
  unbindPageFromRoomSession,
  createLegacyTransport
};
