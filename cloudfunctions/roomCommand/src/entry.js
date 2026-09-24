'use strict';

const { commandEnvelopeFromEvent } = require('./transport');

let runtime;
let initializationError;

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

function reportCommandMetrics(metrics) {
  // 只记录指令类型、房间号、脱敏 Command ID 和分段耗时，不输出 Payload/OpenID。
  console.info('[roomCommand:perf]', JSON.stringify(metrics));
}

function createRuntime() {
  const cloud = require('wx-server-sdk');
  const { createRoomApplication } = require('@cardboard/room-application');
  const { createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const db = cloud.database();
  const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }), {
    serverSecret: process.env.ROOM_PROTOCOL_SERVER_SECRET,
    onCommandMetrics: reportCommandMetrics
  });
  return { cloud, app };
}

// 初始化阶段预热 SDK、Repository 与 Application。异常被保留下来交给 main 结构化返回，
// 既缩短首次业务处理的关键路径，也不让依赖错误退化为平台级 -504002。
try {
  runtime = createRuntime();
} catch (error) {
  initializationError = error;
}

/** V3 房间唯一业务写入口。调用者身份只取云函数上下文。 */
exports.main = async (event) => {
  try {
    if (initializationError) throw initializationError;
    const { cloud, app } = runtime;
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
