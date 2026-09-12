'use strict';

const cloud = require('wx-server-sdk');
const { createRoomApplication } = require('@cardboard/room-application');
const {
  createCloudBaseRoomRepository, COLLECTIONS, docId, safeGet
} = require('@cardboard/room-cloudbase-adapter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }));

function extractImageBuffer(response) {
  const raw = response && (response.buffer || response.fileContent) || (Buffer.isBuffer(response) ? response : null);
  const buffer = Buffer.isBuffer(raw) ? raw : raw && Buffer.from(raw);
  if (!buffer || !buffer.length || !((buffer[0] === 0x89 && buffer[1] === 0x50)
    || (buffer[0] === 0xff && buffer[1] === 0xd8))) throw new Error('小程序码返回内容无效');
  return buffer;
}

async function generate(roomId) {
  const versions = [process.env.QR_ENV_VERSION, 'develop', 'trial', 'release']
    .filter((value, index, list) => value && list.indexOf(value) === index);
  let lastError;
  for (const envVersion of versions) {
    try {
      const response = await cloud.openapi.wxacode.getUnlimited({
        page: 'pages/main-pages/addPlayer/index', scene: `rid=${roomId}`,
        width: 430, check_path: false, env_version: envVersion
      });
      return extractImageBuffer(response);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('生成小程序码失败');
}

async function tempUrl(fileRef) {
  if (!fileRef) return '';
  const response = await cloud.getTempFileURL({ fileList: [fileRef] });
  return response && response.fileList && response.fileList[0] && response.fileList[0].tempFileURL || '';
}

/** 二维码属于可再生媒体，不改变房间业务版本。 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID || '';
  const roomId = String(event && event.roomId || '');
  if (!roomId || String(event && event.action || 'qrcode') !== 'qrcode') {
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'roomId/action 不合法' };
  }
  try {
    const snapshot = await app.readSnapshot(roomId, { userId });
    if (!snapshot.ok) return snapshot;
    const mediaId = docId(`${roomId}:QRCODE`);
    const media = await safeGet(db, COLLECTIONS.media, mediaId);
    const force = event && event.force === true;
    if ((!media || !media.fileRef || force) && snapshot.view.actor.role !== 'HOST') {
      return { ok: false, errCode: 'HOST_REQUIRED', errMsg: '请等待房主生成二维码' };
    }
    if (!media || !media.fileRef || force) {
      const fileContent = await generate(roomId);
      const upload = await cloud.uploadFile({ cloudPath: `room-v3/qrcodes/${roomId}.png`, fileContent });
      const nextMedia = { roomId, mediaType: 'QRCODE', fileRef: upload.fileID, updatedAt: Date.now() };
      await db.collection(COLLECTIONS.media).doc(mediaId).set({ data: nextMedia });
      return { ok: true, qrcodeFileID: nextMedia.fileRef, qrcodeUrl: await tempUrl(nextMedia.fileRef) };
    }
    return { ok: true, qrcodeFileID: media.fileRef, qrcodeUrl: await tempUrl(media.fileRef) };
  } catch (e) {
    console.error('roomMedia error', e);
    return { ok: false, errCode: e.code || 'INTERNAL_ERROR', errMsg: e.message || 'roomMedia failed' };
  }
};
