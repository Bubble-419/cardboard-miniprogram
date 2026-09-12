'use strict';

const cloud = require('wx-server-sdk');
const { createRoomApplication } = require('@cardboard/room-application');
const { createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }));

/** V3 房间只读入口：current / snapshot / sync / history / session / leaderboard。 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID || '';
  const roomId = event && event.roomId;
  const action = (event && event.action) || 'current';

  try {
    if (action === 'current') return await app.readCurrentRoom({ userId });
    if (action === 'snapshot') return await app.readSnapshot(roomId, { userId });
    if (action === 'sync') return await app.sync(roomId, event && event.afterSeq, { userId }, {
      limit: event && event.limit
    });
    if (action === 'history') return await app.readHistory(roomId, { userId }, {
      limit: event && event.limit,
      beforeStartedAt: event && event.beforeStartedAt
    });
    if (action === 'session') return await app.readSessionSnapshot(roomId, event && event.sessionId, { userId });
    if (action === 'leaderboard') return await app.readLeaderboard(roomId, event && event.sessionId, { userId });
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: `未知查询 action: ${action}` };
  } catch (e) {
    console.error('roomQuery error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'INTERNAL_ERROR',
      errMsg: e.errMsg || e.message || 'roomQuery failed'
    };
  }
};
