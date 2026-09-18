'use strict';

const cloud = require('wx-server-sdk');
const { createRoomApplication } = require('@cardboard/room-application');
const { createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }));

/** 可丢失的秒级信号：只写独立集合，不推进 eventSeq/stateVersion。 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const userId = wxContext.OPENID || '';
  const roomId = String(event && event.roomId || '');
  const signalType = String(event && event.signalType || '');
  const sessionId = String(event && event.sessionId || '');
  const turnId = String(event && event.turnId || '');
  const clientContext = event && event.clientContext || {};
  try {
    return await app.writeSignal({ roomId, signalType, sessionId, turnId,
      workflowRevision: event && event.workflowRevision,
      value: event && event.value }, { userId,
      deviceSessionId: clientContext.deviceSessionId,
      touchPresence: clientContext.touchPresence === true });
  } catch (e) {
    console.error('roomSignal error', e);
    return { ok: false, errCode: e.code || 'INTERNAL_ERROR', errMsg: e.message || 'roomSignal failed' };
  }
};
