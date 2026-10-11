'use strict';

const { withLocalScreens } = require('../room-navigation/localScreens');
const { getActiveRoomSession, followRoomRoute } = require('./index');

function withRoomLocalScreens(definition, screens) {
  return withLocalScreens(definition, screens, {
    subscribe(owner) {
      // 历史回顾不是当前场次，不能被活跃房间的订阅拉走。
      if (owner.data.isHistoryReview) return null;
      const session = getActiveRoomSession();
      if (!session) return null;
      return session.subscribe((snapshot) => {
        if (snapshot.view && snapshot.view.route) {
          followRoomRoute(snapshot, owner.data.roomId).catch((error) => console.warn('local screen authority', error));
        }
      });
    }
  });
}

module.exports = { withRoomLocalScreens };
