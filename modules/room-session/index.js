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
  if (tokens.includes('closingVoteSessionId') && context.closingVoteSessionId == null && partner && partner.closing) {
    context.closingVoteSessionId = partner.closing.closingVoteSessionId;
  }
  if (tokens.includes('gameId') && context.gameId == null && spy) context.gameId = spy.gameId;
  if (tokens.includes('speakerTurnId') && context.speakerTurnId == null && spy) context.speakerTurnId = spy.speakerTurnId;
  if (tokens.includes('voteSessionId') && context.voteSessionId == null && spy) context.voteSessionId = spy.voteSessionId;
  return context;
}

function normalizeCommand(input) {
  const aliases = { START_STATEMENT: 'START_PARTNER_STATEMENT', ADVANCE_TURN: 'ADVANCE_PARTNER_TURN' };
  const type = aliases[input.type] || input.type;
  const payload = { ...(input.payload || {}) };
  if (type === 'REORDER_SEATS' && !payload.orderedMemberIds && Array.isArray(payload.userIdOrder)) {
    payload.orderedMemberIds = payload.userIdOrder.slice();
    delete payload.userIdOrder;
  }
  return { type, roomId: input.roomId, commandId: input.commandId,
    context: commandContext(type, input.context), payload };
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
    history: (query) => client.history(query),
    sessionSnapshot: (sessionId) => client.sessionSnapshot(sessionId),
    leaderboard: (sessionId) => client.leaderboard(sessionId),
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
  const session = await openRoomSession(roomId);
  if (options && options.refresh) await session.refresh();
  return session.getSnapshot();
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
  getRoomPageSnapshot, disposeRoomSession, pauseRoomSession, resumeRoomSession,
  bindPageToRoomSession, unbindPageFromRoomSession, commandContext };
