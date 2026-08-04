'use strict';

const cloud = require('wx-server-sdk');
const { createRoomApplication } = require('@cardboard/room-application');
const { createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }));

/**
 * Presence 心跳：不修改成员资格、席位或业务 revision
 * event: { roomId, deviceSessionId? }
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID || '';
  const roomId = event && event.roomId;

  try {
    return await app.heartbeat(roomId, { userId }, {
      deviceSessionId: event && event.deviceSessionId
    });
  } catch (e) {
    console.error('roomPresence error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'INTERNAL_ERROR',
      errMsg: e.errMsg || e.message || 'roomPresence failed'
    };
  }
};
