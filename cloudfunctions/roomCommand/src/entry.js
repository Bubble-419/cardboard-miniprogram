'use strict';

const cloud = require('wx-server-sdk');
const { createRoomApplication } = require('@cardboard/room-application');
const { createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }));

/** V3 房间唯一业务写入口。调用者身份只取云函数上下文。 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID || '';

  const envelope = event && event.type
    ? event
    : (event && event.command) || event || {};

  try {
    return await app.executeCommand(envelope, { userId });
  } catch (e) {
    console.error('roomCommand error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'INTERNAL_ERROR',
      errMsg: e.errMsg || e.message || 'roomCommand failed',
      retryable: false
    };
  }
};
