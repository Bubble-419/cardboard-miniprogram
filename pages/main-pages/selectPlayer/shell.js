'use strict';

const { projectWaitScreenModel } = require('../../../utils/subAwaitRoutes');
const {
  ROOM_SHELL_OWNER,
  ROOM_SHELL_SCREEN,
  classifyRoomShellRoute
} = require('../../../modules/room-navigation/roomShellRoute');

const SELECT_PLAYER_SHELL_SCREEN = Object.freeze({
  LOADING: 'loading',
  WAITING: 'waiting',
  SELECTOR: 'selector',
  EXTERNAL: 'external'
});

function projectSelectPlayerWaiting(scene) {
  const normalizedScene = ['bg', 'player'].includes(scene) ? scene : 'bg';
  return projectWaitScreenModel(normalizedScene);
}

function projectSelectPlayerShell(snapshot) {
  const route = snapshot && snapshot.view && snapshot.view.route || {};
  const classification = classifyRoomShellRoute(route);
  const routeName = classification.routeName;
  const revision = Number(snapshot && snapshot.revision) || 0;
  const scene = classification.scene;

  if (classification.owner === ROOM_SHELL_OWNER.SELECT_PLAYER
    && classification.screen === ROOM_SHELL_SCREEN.WAITING) {
    return {
      screen: SELECT_PLAYER_SHELL_SCREEN.WAITING,
      routeName,
      revision,
      key: scene,
      waiting: projectSelectPlayerWaiting(scene),
      selector: null
    };
  }

  if (classification.owner === ROOM_SHELL_OWNER.SELECT_PLAYER
    && classification.screen === ROOM_SHELL_SCREEN.SELECTOR) {
    return {
      screen: SELECT_PLAYER_SHELL_SCREEN.SELECTOR,
      routeName,
      revision,
      key: 'selectPlayer',
      waiting: null,
      selector: {
        isHost: snapshot && snapshot.isHost === true,
        selectedModeId: String(snapshot && snapshot.selectedModeId || ''),
        members: Array.isArray(snapshot && snapshot.members) ? snapshot.members : []
      }
    };
  }

  return {
    screen: SELECT_PLAYER_SHELL_SCREEN.EXTERNAL,
    routeName,
    revision,
    key: routeName || 'external',
    waiting: null,
    selector: null
  };
}

module.exports = {
  SELECT_PLAYER_SHELL_SCREEN,
  projectSelectPlayerWaiting,
  projectSelectPlayerShell
};
