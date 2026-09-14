'use strict';

const { COMMAND_CONTEXT } = require('../../packages/room-contracts/index');
const { createRoomClient, createCloudRoomGateway } = require('../../packages/room-client/index');
const { createNavigationCoordinator } = require('../room-navigation/index');
const { projectPageSnapshot } = require('./page-model');

const navigation = createNavigationCoordinator();

function currentView() {
  const session = getActiveRoomSession();
  return session && session.getView();
}

function commandContext(type, explicit) {
  const context = { ...(explicit || {}) };
  const view = currentView();
  const session = view && view.session;
  const partner = session && session.publicModeState;
  const spy = session && session.mode === 'SPY' ? session.publicModeState : null;
  const tokens = COMMAND_CONTEXT[type] || [];
  if (tokens.includes('sessionId') && context.sessionId == null && session) context.sessionId = session.sessionId;
  if (tokens.includes('turnId') && context.turnId == null && session) {
    if (session.activeTurn) context.turnId = session.activeTurn.turnId;
    else if (partner && partner.closing) context.turnId = partner.closing.sourceTurnId;
  }
  if (tokens.includes('workflowStep') && context.workflowStep == null && session) {
    context.workflowStep = session.workflow.step;
  }
  if (tokens.includes('closingVoteSessionId') && context.closingVoteSessionId == null && partner && partner.closing) {
    context.closingVoteSessionId = partner.closing.closingVoteSessionId;
  }
  if (tokens.includes('gameId') && context.gameId == null && spy) context.gameId = spy.gameId;
  if (tokens.includes('speakerTurnId') && context.speakerTurnId == null && spy) context.speakerTurnId = spy.speakerTurnId;
  if (tokens.includes('voteSessionId') && context.voteSessionId == null && spy) context.voteSessionId = spy.voteSessionId;
  if (tokens.includes('roundNo') && context.roundNo == null && spy) context.roundNo = spy.roundNo;
  return context;
}

function normalizeCommand(input) {
  const type = input.type;
  return { type, roomId: input.roomId, commandId: input.commandId,
    context: commandContext(type, input.context), payload: { ...(input.payload || {}) } };
}

function createFacade(client) {
  const facade = {
    _client: client,
    subscribe(listener, options) {
      return client.subscribe((view, state) => {
        if (!view && !(state && state.error)) return;
        listener(projectPageSnapshot(view, state));
      }, options);
    },
    async open() { await client.open(); return projectPageSnapshot(client.getView(), client.getState()); },
    async refresh() { await client.refresh(); return projectPageSnapshot(client.getView(), client.getState()); },
    dispatch(input) { return client.dispatch(normalizeCommand(input || {})); },
    getView: () => client.getView(),
    getState: () => client.getState(),
    getSnapshot: () => projectPageSnapshot(client.getView(), client.getState()),
    getAppliedRevision: () => client.getState().seq,
    history: (query, roomId) => client.history(query, roomId),
    sessionSnapshot: (sessionId, roomId) => client.sessionSnapshot(sessionId, roomId),
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
  const facade = createFacade(createRoomClient({ gateway, intervalMs: 1000 }));
  app.globalData.roomSession = facade;
  return facade;
}

function getActiveRoomSession() {
  const app = getApp();
  return app.globalData && app.globalData.roomSession || null;
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
  const result = await session.dispatch({ type, roomId: options && options.roomId,
    commandId: options && options.commandId, context, payload });
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

/** 将归档场次的 MemberView 投影为现有页面唯一消费的 PageSnapshot。 */
async function getRoomSessionPageSnapshot(roomId, sessionId) {
  // 历史读取不绑定当前活跃房间；离房、被踢或已加入新房间后仍可读取自己参与过的归档场次。
  const session = ensureRoomSession();
  const result = await session.sessionSnapshot(sessionId, roomId);
  if (!result || result.ok !== true) return result;
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

module.exports = { getActiveRoomSession, ensureRoomSession, openRoomSession, dispatchRoomCommand,
  getRoomPageSnapshot, getCurrentRoomPageSnapshot, getRoomHistory, getRoomSessionPageSnapshot,
  disposeRoomSession, pauseRoomSession, resumeRoomSession,
  bindPageToRoomSession, unbindPageFromRoomSession, commandContext };
