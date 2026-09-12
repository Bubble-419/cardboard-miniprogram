'use strict';

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const { createRoomApplication } = require('@cardboard/room-application');
const { createCloudBaseRoomRepository } = require('@cardboard/room-cloudbase-adapter');

const AsrClient = tencentcloud.asr.v20190614.Client;

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }));

async function recognizeMp3(buffer) {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('请配置 TENCENT_SECRET_ID 与 TENCENT_SECRET_KEY');
  }
  const client = new AsrClient({
    credential: { secretId, secretKey },
    region: process.env.TENCENT_ASR_REGION || 'ap-shanghai',
    profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } }
  });
  const response = await client.SentenceRecognition({
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: '16k_zh',
    SourceType: 1,
    VoiceFormat: 'mp3',
    UsrAudioKey: String(Date.now()),
    Data: buffer.toString('base64'),
    DataLen: buffer.length
  });
  return response && response.Result ? String(response.Result).trim() : '';
}

/**
 * 只负责当前 Partner Turn 的音频鉴权与转写；业务写入由客户端随后提交 APPEND_ARTIFACT。
 */
exports.main = async (event) => {
  const roomId = String(event && event.roomId || '');
  const sessionId = String(event && event.sessionId || '');
  const turnId = String(event && event.turnId || '');
  const fileID = String(event && event.fileID || '');
  const phase = String(event && event.phase || '');
  if (!roomId || !sessionId || !turnId || !fileID || !['play', 'discussion'].includes(phase)) {
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'roomId/sessionId/turnId/fileID/phase 不合法' };
  }
  if (!fileID.includes(`/partner-voice/${roomId}/`)) {
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: '音频不属于当前房间' };
  }

  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID || '';
  try {
    const snapshot = await app.readSnapshot(roomId, { userId });
    if (!snapshot.ok) return snapshot;
    const view = snapshot.view;
    const session = view && view.session;
    const turn = session && session.activeTurn;
    if (!view.actor || view.actor.role !== 'HOST') {
      return { ok: false, errCode: 'HOST_REQUIRED', errMsg: '仅房主可上传语音转写' };
    }
    if (!session || session.mode !== 'PARTNER' || session.sessionId !== sessionId
      || !turn || turn.turnId !== turnId
      || !['PARTNER_TURN', 'PARTNER_STATEMENT'].includes(session.workflow.step)) {
      return { ok: false, errCode: 'STALE_CONTEXT', errMsg: '语音所属行动轮已经变化' };
    }
    const expectedStep = phase === 'discussion' ? 'PARTNER_STATEMENT' : 'PARTNER_TURN';
    if (session.workflow.step !== expectedStep) {
      return { ok: false, errCode: 'STALE_CONTEXT', errMsg: '语音所属阶段已经变化' };
    }

    const download = await cloud.downloadFile({ fileID });
    const buffer = download && download.fileContent;
    if (!buffer || !buffer.length) {
      return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: '音频文件为空' };
    }
    if (buffer.length > 10 * 1024 * 1024) {
      return { ok: false, errCode: 'LIMIT_EXCEEDED', errMsg: '音频文件超过 10MB' };
    }
    const text = await recognizeMp3(buffer);
    return { ok: true, text, fileRef: fileID, phase, skipped: !text };
  } catch (error) {
    console.error('speechToText error', error && (error.code || error.message));
    return { ok: false, errCode: error.errCode || error.code || 'DEPENDENCY_UNAVAILABLE',
      errMsg: error.errMsg || error.message || '语音识别失败' };
  }
};
