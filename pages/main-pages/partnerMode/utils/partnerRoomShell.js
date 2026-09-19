'use strict';

const { projectWaitScreenModel } = require('../../../../utils/subAwaitRoutes');
const {
  ROOM_SHELL_OWNER,
  ROOM_SHELL_SCREEN,
  classifyRoomShellRoute
} = require('../../../../modules/room-navigation/roomShellRoute');

/**
 * Partner 稳定 Shell 的屏幕标识。
 * Shell 只解释服务端投影的 route，不从 workflow 或本地页面状态猜路由。
 */
const PARTNER_SHELL_SCREEN = Object.freeze({
  LOADING: 'loading',
  LEAVING: 'leaving',
  WAITING: 'waiting',
  GAME: 'game',
  CLOSING_VOTE: 'closingVote',
  EXTERNAL: 'external'
});

const PARTNER_SHELL_ROUTES = new Set(['partnerGame', 'closingStatement']);

function projectPartnerWaiting(scene) {
  const normalizedScene = scene === 'confirmFirstPlayer' ? scene : 'confirmFirstPlayer';
  return projectWaitScreenModel(normalizedScene);
}

function projectClosingVote(snapshot) {
  const roomState = snapshot && snapshot.roomState || {};
  const actor = snapshot && snapshot.view && snapshot.view.actor || {};
  const voteStatus = actor.voteStatus || {};
  const isInitiator = Number(roomState.closingVoteInitiatorIndex) === Number(actor.seatNo);
  return {
    sessionId: String(roomState.sessionId || ''),
    closingVoteSessionId: String(roomState.closingVoteSessionId || ''),
    isInitiator,
    hasVoted: isInitiator || voteStatus.submitted === true,
    voteResult: isInitiator ? 'pass' : String(voteStatus.vote || '')
  };
}

/**
 * 将任意来源的完整 PageSnapshot 投影成 Shell Model。
 * Snapshot 完整替换与 Event 归约后的 View 在这里走完全相同的路径。
 */
function projectPartnerRoomShell(snapshot) {
  const route = snapshot && snapshot.view && snapshot.view.route || {};
  const classification = classifyRoomShellRoute(route);
  const routeName = classification.routeName;
  const revision = Number(snapshot && snapshot.revision) || 0;
  if (classification.owner === ROOM_SHELL_OWNER.PARTNER
    && classification.screen === ROOM_SHELL_SCREEN.WAITING) {
    const scene = classification.scene;
    return {
      screen: PARTNER_SHELL_SCREEN.WAITING,
      routeName,
      revision,
      key: scene,
      waiting: projectPartnerWaiting(scene),
      closingVote: null
    };
  }
  if (classification.owner === ROOM_SHELL_OWNER.PARTNER
    && classification.screen === ROOM_SHELL_SCREEN.GAME) {
    const sessionId = String(snapshot && snapshot.roomState && snapshot.roomState.sessionId || '');
    return {
      screen: PARTNER_SHELL_SCREEN.GAME,
      routeName,
      revision,
      key: sessionId || 'partnerGame',
      waiting: null,
      closingVote: null
    };
  }
  if (classification.owner === ROOM_SHELL_OWNER.PARTNER
    && classification.screen === ROOM_SHELL_SCREEN.CLOSING_VOTE) {
    const closingVote = projectClosingVote(snapshot);
    return {
      screen: PARTNER_SHELL_SCREEN.CLOSING_VOTE,
      routeName,
      revision,
      key: `${closingVote.sessionId}:${closingVote.closingVoteSessionId}`,
      waiting: null,
      closingVote
    };
  }
  return {
    screen: PARTNER_SHELL_SCREEN.EXTERNAL,
    routeName,
    revision,
    key: routeName || 'external',
    waiting: null,
    closingVote: null
  };
}

function isPartnerShellRoute(routeName) {
  return PARTNER_SHELL_ROUTES.has(String(routeName || ''));
}

module.exports = {
  PARTNER_SHELL_SCREEN,
  PARTNER_SHELL_ROUTES,
  isPartnerShellRoute,
  projectPartnerWaiting,
  projectPartnerRoomShell
};
