'use strict';

const { COMMAND_CONTEXT, ERR } = require('../../packages/room-contracts/index');
const {
  ROOM_POLL_INTERVAL_MS, createRoomClient, createCloudRoomGateway
} = require('../../packages/room-client/index');
const { createNavigationCoordinator } = require('../room-navigation/index');
const { projectPageSnapshot } = require('./page-model');

const navigation = createNavigationCoordinator();

function currentView() {
  const session = getActiveRoomSession();
  return session && session.getView();
}

function missingContextToken(value) {
  return value == null || value === '';
}

function commandContext(type, explicit) {
  const context = { ...(explicit || {}) };
  const view = currentView();
  const session = view && view.session;
  const partner = session && session.publicModeState;
  const spy = session && session.mode === 'SPY' ? session.publicModeState : null;
  const tokens = COMMAND_CONTEXT[type] || [];
  if (tokens.includes('sessionId') && missingContextToken(context.sessionId) && session) {
    context.sessionId = session.sessionId;
  }
  if (tokens.includes('turnId') && missingContextToken(context.turnId) && session) {
    if (session.activeTurn) context.turnId = session.activeTurn.turnId;
    else if (partner && partner.closing) context.turnId = partner.closing.sourceTurnId;
  }
  if (tokens.includes('workflowStep') && missingContextToken(context.workflowStep) && session) {
    context.workflowStep = session.workflow.step;
  }
  if (tokens.includes('closingVoteSessionId') && missingContextToken(context.closingVoteSessionId)
    && partner && partner.closing) {
    context.closingVoteSessionId = partner.closing.closingVoteSessionId;
  }
  if (tokens.includes('gameId') && missingContextToken(context.gameId) && spy) context.gameId = spy.gameId;
  if (tokens.includes('speakerTurnId') && missingContextToken(context.speakerTurnId) && spy) {
    context.speakerTurnId = spy.speakerTurnId;
  }
  if (tokens.includes('voteSessionId') && missingContextToken(context.voteSessionId) && spy) {
    context.voteSessionId = spy.voteSessionId;
  }
  if (tokens.includes('roundNo') && missingContextToken(context.roundNo) && spy) context.roundNo = spy.roundNo;
  return context;
}

function normalizeCommand(input) {
  const type = input.type;
  return { type, roomId: input.roomId,
    context: commandContext(type, input.context), payload: { ...(input.payload || {}) } };
}

function capabilityDenied(cap) {
  const reason = cap && cap.reason;
  const messages = {
    HOST_REQUIRED: '仅房主可操作',
    HOST_CANNOT_LEAVE: '房主不能离开房间',
    NOT_MEMBER: '您已不在该房间',
    INVALID_TRANSITION: '当前不能执行该操作',
    SELF_SCORE: '不能给自己打分',
    LIMIT_EXCEEDED: '当前场次内容已达到上限，请结束场次'
  };
  return { ok: false, errCode: reason || 'FORBIDDEN', errMsg: messages[reason] || '当前不能执行该操作' };
}

function createFacade(client) {
  const facade = {
    _client: client,
    subscribe(listener, options) {
      return client.subscribe((view, state) => {
        if (!view && !(state && state.error)) return;
        const snapshot = projectPageSnapshot(view, state);
        listener(snapshot);
        if (!view && state && state.error && typeof wx !== 'undefined') {
          const terminalCodes = ['NOT_MEMBER', 'ROOM_DISSOLVED', 'ROOM_NOT_FOUND'];
          if (terminalCodes.includes(state.error.errCode)) {
            // 终态错误必须关闭当前 Room View，不能让页面停在已经失效的游戏画面。
            const { handleRoomGoneFromResult } = require('../../utils/roomDissolved');
            handleRoomGoneFromResult(snapshot, state.error.roomId || state.roomId || '', {
              allowToastOnHome: true
            });
          }
        }
      }, options);
    },
    async open() { await client.open(); return projectPageSnapshot(client.getView(), client.getState()); },
    async refresh() { await client.refresh(); return projectPageSnapshot(client.getView(), client.getState()); },
    dispatch(input) { return client.dispatch(normalizeCommand(input || {})); },
    getView: () => client.getView(),
    getState: () => client.getState(),
    getSnapshot: () => projectPageSnapshot(client.getView(), client.getState()),
    getAppliedRevision: () => client.getState().seq,
    getRequestContext: () => client.getRequestContext(),
    history: (query, roomId) => client.history(query, roomId),
    sessionSnapshot: (sessionId, roomId) => client.sessionSnapshot(sessionId, roomId),
    messages: (sessionId, query, roomId) => client.messages(sessionId, query, roomId),
    leaderboard: (sessionId, roomId) => client.leaderboard(sessionId, roomId),
    pause: () => client.pause(),
    resume: () => client.resume(),
    dispose: () => client.close(),
    reconfigure() {}
  };
  Object.defineProperty(facade, 'roomId', { get: () => client.getState().roomId });
  return facade;
}

function ensureRoomSession() {
  const app = getApp();
  app.globalData = app.globalData || {};
  if (app.globalData.roomSession) return app.globalData.roomSession;
  const gateway = createCloudRoomGateway({ callFunction: (request) => wx.cloud.callFunction(request) });
  const facade = createFacade(createRoomClient({ gateway, intervalMs: ROOM_POLL_INTERVAL_MS }));
  app.globalData.roomSession = facade;
  return facade;
}

function getActiveRoomSession() {
  const app = getApp();
  return app.globalData && app.globalData.roomSession || null;
}

function getRoomRequestContext() {
  return ensureRoomSession().getRequestContext();
}

async function openRoomSession(roomId) {
  const session = ensureRoomSession();
  const state = session.getState();
  if (state.status === 'READY' && (!roomId || state.roomId === roomId)) return session;
  await session.open();
  const current = session.getState().roomId;
  if (roomId && current && roomId !== current) throw new Error('当前账号属于其他房间');
  if (current) getApp().globalData.roomId = current;
  return session;
}

async function dispatchRoomCommand(type, payload, context, options) {
  const session = ensureRoomSession();
  if (type !== 'CREATE_ROOM' && type !== 'JOIN_ROOM') {
    const view = session.getView && session.getView();
    const cap = view && view.actor && view.actor.capabilities && view.actor.capabilities[type];
    if (cap && cap.allowed !== true) return capabilityDenied(cap);
  }
  const validRoomId = (value) => typeof value === 'string' && /^\d{8}$/.test(value.trim());
  const explicitRoomId = options && options.roomId;
  let targetRoomId;
  if (type === 'CREATE_ROOM') {
    targetRoomId = undefined;
  } else if (type === 'JOIN_ROOM') {
    if (!validRoomId(explicitRoomId)) {
      return { ok: false, errCode: ERR.INVALID_ARGUMENT, errMsg: '请输入 8 位房间号', retryable: false };
    }
    targetRoomId = explicitRoomId.trim();
  } else {
    // 当前连接是房间 Command 的权威作用域；URL/全局缓存只在连接尚未恢复时兜底。
    // `undefined`、`null` 等脏路由值不能穿透到云端并显示成无关的协议校验错误。
    const candidates = [session.roomId, explicitRoomId,
      getApp().globalData && getApp().globalData.roomId];
    targetRoomId = candidates.find(validRoomId);
    if (!targetRoomId) {
      return { ok: false, errCode: ERR.DEPENDENCY_UNAVAILABLE,
        errMsg: '房间状态正在恢复，请稍后重试', retryable: true };
    }
    targetRoomId = targetRoomId.trim();
  }
  const result = await session.dispatch({
    type,
    roomId: targetRoomId,
    context,
    payload
  });
  if (result && result.ok && result.outcome && result.outcome.roomId) {
    getApp().globalData.roomId = result.outcome.roomId;
  }
  return result;
}

async function getRoomPageSnapshot(roomId, options) {
  let session;
  try {
    session = await openRoomSession(roomId);
    if (options && options.refresh) await session.refresh();
  } catch (error) {
    return { ok: false, roomId, errCode: error.code || error.errCode || 'DEPENDENCY_UNAVAILABLE',
      errMsg: error.message || error.errMsg || '读取房间失败', members: [], memberCount: 0,
      roomState: null, view: null, ephemeral: {} };
  }
  const snapshot = session.getSnapshot();
  if (snapshot.ok === false) return snapshot;
  if (roomId && session.roomId !== roomId) {
    return { ok: false, roomId,
      errCode: session.roomId ? 'ALREADY_IN_ROOM' : 'NOT_MEMBER',
      errMsg: session.roomId ? '当前账号属于其他房间' : '您已不在该房间',
      members: [], memberCount: 0, roomState: null, view: null, ephemeral: {} };
  }
  return snapshot;
}

async function getCurrentRoomPageSnapshot() {
  const session = ensureRoomSession();
  return session.open();
}

async function getRoomHistory(roomId, query) {
  const session = ensureRoomSession();
  return session.history(query || {}, roomId);
}

async function getRoomSessionMessages(roomId, sessionId, options) {
  const session = ensureRoomSession();
  const messages = [];
  let beforeSeq = null;
  const pageSize = Math.min(100, Math.max(1, Number(options && options.limit) || 100));
  do {
    const result = await session.messages(sessionId, { limit: pageSize, beforeSeq }, roomId);
    if (!result || result.ok !== true) return result;
    messages.push(...(result.messages || []));
    if (!result.hasMore) break;
    if (!Number.isInteger(result.nextBeforeSeq) || result.nextBeforeSeq === beforeSeq) {
      return { ok: false, errCode: 'INTERNAL_ERROR', errMsg: '消息分页游标未推进' };
    }
    beforeSeq = result.nextBeforeSeq;
  } while (true);
  messages.sort((a, b) => a.commitSeq - b.commitSeq);
  return { ok: true, roomId, sessionId, messages };
}

/** 将归档场次的 MemberView 投影为现有页面唯一消费的 PageSnapshot。 */
async function getRoomSessionPageSnapshot(roomId, sessionId) {
  // 历史读取不绑定当前活跃房间；离房、被踢或已加入新房间后仍可读取自己参与过的归档场次。
  const session = ensureRoomSession();
  const result = await session.sessionSnapshot(sessionId, roomId);
  if (!result || result.ok !== true) return result;
  if (result.view && result.view.session && result.view.session.mode === 'PARTNER') {
    try {
      const history = await getRoomSessionMessages(roomId, sessionId);
      if (history && history.ok === true) {
        result.view.session.recentMessages = history.messages;
      }
    } catch (error) {
      console.warn('getRoomSessionPageSnapshot messages', error);
    }
  }
  return projectPageSnapshot(result.view, {
    roomId: result.roomId,
    seq: result.seq || 0,
    stateVersion: result.stateVersion || 0,
    status: 'READY',
    historical: true,
    ephemeral: {},
    serverNow: result.serverTime
  });
}

function disposeRoomSession() {
  const app = getApp();
  if (app.globalData && app.globalData.roomSession) app.globalData.roomSession.dispose();
  if (app.globalData) app.globalData.roomSession = null;
}

function pauseRoomSession() { const session = getActiveRoomSession(); if (session) session.pause(); }
function resumeRoomSession() { const session = getActiveRoomSession(); if (session) session.resume(); }

async function bindPageToRoomSession(page, options) {
  const roomId = typeof options.getRoomId === 'function' ? options.getRoomId.call(page) : '';
  if (!roomId) return null;
  const generation = (page._roomSessionBindGen || 0) + 1;
  page._roomSessionBindGen = generation;
  const session = await openRoomSession(roomId);
  if (page._roomSessionBindGen !== generation) return null;
  if (page._roomSessionUnsub) page._roomSessionUnsub();
  let first = true;
  page._roomSessionUnsub = session.subscribe((snapshot) => {
    if (page._roomSessionBindGen !== generation) return;
    if (first && options.emitCurrent === false) { first = false; return; }
    first = false;
    if (typeof options.onSnapshot === 'function') options.onSnapshot.call(page, snapshot);
    const view = snapshot.view;
    if (options.followNavigation && view && view.route) {
      navigation.reconcile(view.route, snapshot.revision, { roomId,
        pageSnapshot: snapshot,
        beforeNavigate: options.beforeNavigate
          ? (model, pageKey) => options.beforeNavigate.call(page, model, pageKey)
          : null }).catch((error) => console.warn('room navigation', error));
    }
  });
  page._boundRoomSession = session;
  return session;
}

function unbindPageFromRoomSession(page) {
  if (!page) return;
  page._roomSessionBindGen = (page._roomSessionBindGen || 0) + 1;
  if (page._roomSessionUnsub) page._roomSessionUnsub();
  page._roomSessionUnsub = null;
  page._boundRoomSession = null;
}

function followRoomRoute(snapshot, roomId, extra) {
  const view = snapshot && snapshot.view;
  if (!view || !view.route) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'NO_ROUTE' });
  }
  return navigation.reconcile(view.route, snapshot.revision, {
    roomId: roomId || snapshot.roomId || '',
    pageSnapshot: snapshot,
    ...(extra || {})
  });
}

/**
 * 写指令成功后只跟随服务端已经发布的权威 route。
 * 若附带 Event 同步没有追到该指令水位，先用 Snapshot 恢复，避免页面猜测下一地址。
 */
async function followRoomRouteAfterCommand(result, roomId, extra) {
  if (!result || result.ok !== true) {
    return { ok: false, skipped: true, reason: 'COMMAND_FAILED' };
  }
  const session = getActiveRoomSession();
  if (!session || typeof session.getSnapshot !== 'function') {
    return { ok: false, skipped: true, reason: 'NO_SESSION' };
  }
  const committedThroughSeq = Number(result.outcome && result.outcome.committedThroughSeq);
  let snapshot = session.getSnapshot();
  if (Number.isInteger(committedThroughSeq) && committedThroughSeq > 0
    && Number(snapshot && snapshot.revision) < committedThroughSeq
    && typeof session.refresh === 'function') {
    snapshot = await session.refresh();
  }
  if (Number.isInteger(committedThroughSeq) && committedThroughSeq > 0
    && Number(snapshot && snapshot.revision) < committedThroughSeq) {
    return { ok: false, skipped: true, reason: 'VIEW_NOT_COMMITTED' };
  }
  return followRoomRoute(snapshot, roomId, extra);
}

function canRoomCommand(type) {
  const session = getActiveRoomSession();
  const view = session && session.getView();
  const cap = view && view.actor && view.actor.capabilities && view.actor.capabilities[type];
  return !!(cap && cap.allowed === true);
}

module.exports = { getActiveRoomSession, getRoomRequestContext, ensureRoomSession, openRoomSession, dispatchRoomCommand,
  getRoomPageSnapshot, getCurrentRoomPageSnapshot, getRoomHistory, getRoomSessionMessages, getRoomSessionPageSnapshot,
  disposeRoomSession, pauseRoomSession, resumeRoomSession,
  bindPageToRoomSession, unbindPageFromRoomSession, followRoomRoute, followRoomRouteAfterCommand,
  canRoomCommand, commandContext };
