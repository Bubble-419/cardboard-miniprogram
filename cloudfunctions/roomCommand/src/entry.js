'use strict';

const cloud = require('wx-server-sdk');
const { createRoomApplication } = require('@cardboard/room-application');
const { createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');
const { commandEnvelopeFromEvent } = require('./transport');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }), {
  serverSecret: process.env.ROOM_PROTOCOL_SERVER_SECRET
});

/** V3 房间唯一业务写入口。调用者身份只取云函数上下文。 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID || '';

  const envelope = commandEnvelopeFromEvent(event);

  try {
    return await app.executeCommand(envelope, { userId });
  } catch (e) {
    console.error('roomCommand error', e);
    const errCode = e.errCode || e.code || 'INTERNAL_ERROR';
    return {
      ok: false,
      errCode,
      errMsg: e.errMsg || e.message || 'roomCommand failed',
      retryable: ['DEPENDENCY_UNAVAILABLE', 'RATE_LIMITED'].includes(errCode)
    };
  }
};
