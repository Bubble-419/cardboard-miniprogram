'use strict';

const { commandEnvelopeFromEvent } = require('./transport');

let runtime;

function isRetryableCommandError(errCode, errMsg) {
  const code = String(errCode || '');
  const message = String(errMsg || '');
  return code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED' || code === '-501001'
    || /TransactionBusy|resource system error/i.test(message);
}

function commandFailure(error) {
  console.error('roomCommand error', error);
  const errCode = (error && (error.errCode || error.code)) || 'INTERNAL_ERROR';
  const errMsg = (error && (error.errMsg || error.message)) || 'roomCommand failed';
  return {
    ok: false,
    errCode,
    errMsg,
    retryable: isRetryableCommandError(errCode, errMsg)
  };
}

function getRuntime() {
  if (runtime) return runtime;
  const cloud = require('wx-server-sdk');
  const { createRoomApplication } = require('@cardboard/room-application');
  const { createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const db = cloud.database();
  const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }), {
    serverSecret: process.env.ROOM_PROTOCOL_SERVER_SECRET
  });
  runtime = { cloud, app };
  return runtime;
}

/** V3 房间唯一业务写入口。调用者身份只取云函数上下文。 */
exports.main = async (event) => {
  try {
    const { cloud, app } = getRuntime();
    const wxContext = cloud.getWXContext();
    const userId = wxContext.OPENID || '';
    const clientContext = event && event.clientContext || {};
    const envelope = commandEnvelopeFromEvent(event);
    return await app.executeCommand(envelope, {
      userId,
      deviceSessionId: clientContext.deviceSessionId,
      touchPresence: clientContext.touchPresence === true
    });
  } catch (e) {
    return commandFailure(e);
  }
};
