'use strict';

const cloud = require('wx-server-sdk');
const { createRoomApplication } = require('@cardboard/room-application');
const { createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }));

/**
 * V2 房间只读查询
 * event.action: 'head' | 'snapshot'（默认 head）
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID || '';
  const roomId = event && event.roomId;
  const action = (event && event.action) || 'head';

  try {
    if (action === 'snapshot') {
      return await app.readSnapshot(roomId, { userId }, {
        domains: event.domains,
        domainRevisions: event.domainRevisions
      });
    }
    return await app.readHead(roomId, { userId });
  } catch (e) {
    console.error('roomQuery error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'INTERNAL_ERROR',
      errMsg: e.errMsg || e.message || 'roomQuery failed'
    };
  }
};
