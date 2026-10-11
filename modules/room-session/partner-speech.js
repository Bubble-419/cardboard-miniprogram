'use strict';

const { dispatchRoomCommand, getRoomRequestContext } = require('./index');

/** 私有 MP3 策略：只接受录音开始时冻结的上下文，绝不重新读取当前 Turn。 */
function createPartnerSpeechSink(api) {
  return async function uploadAndRecognize(context, tempFilePath) {
    const app = getApp();
    if (app && app.globalData && app.globalData.cloudReady) await app.globalData.cloudReady;
    const cloud = app && app.globalData && app.globalData.cloud;
    if (!cloud) throw new Error('云开发未初始化');
    const uploadRes = await cloud.uploadFile({
      cloudPath: `partner-voice/${context.roomId}/${Date.now()}_${Math.floor(Math.random() * 1000)}.mp3`,
      filePath: tempFilePath
    });
    const fileID = uploadRes && uploadRes.fileID;
    if (!fileID) throw new Error('上传录音失败');
    const callRes = await api.cloud.callFunction({ name: 'speechToText', data: {
      roomId: context.roomId, sessionId: context.sessionId, turnId: context.turnId,
      fileID, phase: context.phase, clientContext: getRoomRequestContext()
    } });
    const result = callRes && callRes.result || {};
    if (result.ok !== true) throw new Error(result.errMsg || '语音识别失败');
    const text = String(result.text || '').trim();
    if (!text) return '';
    const appended = await dispatchRoomCommand('APPEND_ARTIFACT', {
      operationId: `voice_${context.turnId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'VOICE', text, fileRef: result.fileRef || fileID
    }, { sessionId: context.sessionId, turnId: context.turnId, workflowStep: context.workflowStep });
    if (!appended || appended.ok !== true) throw new Error(appended && appended.errMsg || '语音纪要入房间失败');
    return text;
  };
}

module.exports = { createPartnerSpeechSink };
