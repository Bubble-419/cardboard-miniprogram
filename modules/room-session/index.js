'use strict';

const { createRoomSession } = require('../../packages/room-client/index');
const { followSubScreenRoomPoll } = require('../../utils/subScreenRoomPoll');

function createLegacyTransport(roomId, options) {
  const defaultFull = !!(options && options.full);
  return {
    async fetchSnapshot({ full }) {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId, full: full === true || defaultFull }
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
  const intervalMs = (options && options.intervalMs) || 2000;
  const full = !!(options && options.full);

  if (existing && existing.roomId === roomId) {
    const needInterval = options && options.intervalMs != null
      && existing._intervalMs !== intervalMs;
    const needFull = options && options.full != null
      && existing._full !== full;
    // 同房间只升级 transport / 间隔，禁止 dispose 重建（gamepage 进页会触发，曾打坏横向头像）
    if (needInterval || needFull) {
      existing.reconfigure({
        intervalMs,
        transport: createLegacyTransport(roomId, { full })
      });
      existing._intervalMs = intervalMs;
      existing._full = full;
    }
    return existing;
  }

  if (existing) {
    existing.dispose();
    app.globalData.roomSession = null;
  }

  const session = createRoomSession({
    roomId,
    intervalMs,
    transport: createLegacyTransport(roomId, { full })
  });
  session._intervalMs = intervalMs;
  session._full = full;
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
 * @param {boolean} [options.full]
 * @param {boolean} [options.followNavigation] 是否对副屏走 followSubScreenRoomPoll
 * @param {boolean} [options.emitCurrent] 订阅时是否立刻回放当前快照（默认 true）
 *   gamepage 必须 false：进页同步 setData 会打坏 user-list 横向 scroll-view
 */
async function bindPageToRoomSession(page, options) {
  const getRoomId = options.getRoomId;
  const onSnapshot = options.onSnapshot;
  const roomId = typeof getRoomId === 'function' ? getRoomId.call(page) : '';
  if (!roomId) return null;

  const session = await openRoomSession(roomId, {
    intervalMs: options.intervalMs || 2000,
    full: options.full === true
  });

  if (page._roomSessionUnsub) {
    page._roomSessionUnsub();
    page._roomSessionUnsub = null;
  }

  const emitCurrent = options.emitCurrent !== false;
  page._roomSessionUnsub = session.subscribe((snapshot) => {
    if (!snapshot) return;
    if (typeof onSnapshot === 'function') {
      onSnapshot.call(page, snapshot);
    }
    // 解散 / 踢出时 getAddPlayerData 返回 ok:false；原先要求 snapshot.ok
    // 导致 followSubScreenRoomPoll 从不执行，成员页卡住不回首页
    if (options.followNavigation && snapshot.raw) {
      followSubScreenRoomPoll(snapshot.raw, roomId, {
        beforeNavigate: options.beforeNavigate
          ? (result, pageKey) => options.beforeNavigate.call(page, result, pageKey)
          : undefined
      });
    }
  }, { emitCurrent });

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
