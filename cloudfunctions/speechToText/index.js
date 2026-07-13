const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');

const AsrClient = tencentcloud.asr.v20190614.Client;
const {
  normalizePartnerRoundContent
} = require('./partnerRoundContent');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';

async function assertHost(roomId, userId) {
  const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
  if (!roomRes.data || !roomRes.data.length) {
    return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  }
  const room = roomRes.data[0];
  const creatorId = room.creatorId || room.creator_id;
  if (!creatorId || String(creatorId) !== String(userId)) {
    return { ok: false, errCode: 'NO_PERMISSION', errMsg: '仅房主可上传语音转写' };
  }
  return { ok: true, room };
}

async function recognizeMp3(buffer) {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('请在云函数环境变量中配置 TENCENT_SECRET_ID 与 TENCENT_SECRET_KEY');
  }

  const client = new AsrClient({
    credential: { secretId, secretKey },
    region: process.env.TENCENT_ASR_REGION || 'ap-shanghai',
    profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } }
  });

  const params = {
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: '16k_zh',
    SourceType: 1,
    VoiceFormat: 'mp3',
    UsrAudioKey: String(Date.now()),
    Data: buffer.toString('base64'),
    DataLen: buffer.length
  };

  const res = await client.SentenceRecognition(params);
  return (res && res.Result ? String(res.Result) : '').trim();
}

exports.main = async (event) => {
  const { roomId, fileID, phase } = event || {};

  if (!roomId || !fileID) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId 与 fileID 必填' };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const hostCheck = await assertHost(roomId, currentUserId);
    if (!hostCheck.ok) return hostCheck;
    const room = hostCheck.room;

    const downloadRes = await cloud.downloadFile({ fileID });
    const buffer = downloadRes.fileContent;
    if (!buffer || !buffer.length) {
      return { ok: false, errCode: 'EMPTY_AUDIO', errMsg: '音频文件为空' };
    }

    const text = await recognizeMp3(buffer);
    if (!text) {
      return { ok: true, text: '', skipped: true };
    }

    const safePhase = phase === 'discussion' ? 'discussion' : 'play';
    const content = normalizePartnerRoundContent(room.partnerCurrentRoundContent);
    content.voiceLines.push({
      text,
      at: Date.now(),
      phase: safePhase
    });

    await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
      data: {
        partnerCurrentRoundContent: content,
        updatedAt: Date.now()
      }
    });

    return { ok: true, text, voiceLines: content.voiceLines };
  } catch (e) {
    console.error('speechToText error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'SPEECH_TO_TEXT_ERROR',
      errMsg: e.errMsg || e.message || '语音识别失败'
    };
  }
};
