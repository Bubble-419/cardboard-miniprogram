'use strict';

const ROOM_SHELL_OWNER = Object.freeze({
  PARTNER: 'partner',
  SELECT_PLAYER: 'selectPlayer',
  EXTERNAL: 'external'
});

const ROOM_SHELL_SCREEN = Object.freeze({
  WAITING: 'waiting',
  GAME: 'game',
  CLOSING_VOTE: 'closingVote',
  SELECTOR: 'selector',
  EXTERNAL: 'external'
});

/**
 * 统一解释权威 route 属于哪个稳定 RoomShell。
 * 导航与各 Shell projector 必须复用这里，避免对 subAwait.scene 的理解漂移。
 */
function classifyRoomShellRoute(route) {
  const value = route || {};
  const routeName = String(value.name || '');
  const params = value.params || {};
  const scene = String(params.scene || '');

  if (routeName === 'subAwait' && scene === 'confirmFirstPlayer') {
    return {
      owner: ROOM_SHELL_OWNER.PARTNER,
      screen: ROOM_SHELL_SCREEN.WAITING,
      routeName,
      scene
    };
  }
  if (routeName === 'partnerGame') {
    return {
      owner: ROOM_SHELL_OWNER.PARTNER,
      screen: ROOM_SHELL_SCREEN.GAME,
      routeName,
      scene: ''
    };
  }
  if (routeName === 'closingStatement') {
    return {
      owner: ROOM_SHELL_OWNER.PARTNER,
      screen: ROOM_SHELL_SCREEN.CLOSING_VOTE,
      routeName,
      scene: ''
    };
  }
  if (routeName === 'subAwait' && ['bg', 'player'].includes(scene)) {
    return {
      owner: ROOM_SHELL_OWNER.SELECT_PLAYER,
      screen: ROOM_SHELL_SCREEN.WAITING,
      routeName,
      scene
    };
  }
  if (routeName === 'selectPlayer') {
    return {
      owner: ROOM_SHELL_OWNER.SELECT_PLAYER,
      screen: ROOM_SHELL_SCREEN.SELECTOR,
      routeName,
      scene: ''
    };
  }
  return {
    owner: ROOM_SHELL_OWNER.EXTERNAL,
    screen: ROOM_SHELL_SCREEN.EXTERNAL,
    routeName,
    scene
  };
}

module.exports = {
  ROOM_SHELL_OWNER,
  ROOM_SHELL_SCREEN,
  classifyRoomShellRoute
};
