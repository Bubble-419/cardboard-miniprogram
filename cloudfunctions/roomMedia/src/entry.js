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

function collectCloudFileRefs(value, refs = new Set()) {
  if (typeof value === 'string') {
    if (value.indexOf('cloud://') === 0) refs.add(value);
    return refs;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectCloudFileRefs(item, refs));
    return refs;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => collectCloudFileRefs(value[key], refs));
  }
  return refs;
}

async function tempUrls(fileList, actorContext, scope) {
  if (!Array.isArray(fileList) || fileList.length < 1 || fileList.length > 50
    || fileList.some((id) => typeof id !== 'string' || id.indexOf('cloud://') !== 0)) {
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'fileList 不合法' };
  }
  const ids = Array.from(new Set(fileList));
  const roomId = String(scope && scope.roomId || '');
  const sessionId = String(scope && scope.sessionId || '');
  let snapshot;
  if (sessionId) {
    if (!/^\d{8}$/.test(roomId) || sessionId.length > 128) {
      return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'roomId/sessionId 不合法' };
    }
    snapshot = await app.readSessionSnapshot(roomId, sessionId, {
      ...actorContext,
      touchPresence: false
    });
  } else if (roomId) {
    if (!/^\d{8}$/.test(roomId)) {
      return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'roomId 不合法' };
    }
    snapshot = await app.readSnapshot(roomId, actorContext);
  } else {
    const current = await app.readCurrentRoom(actorContext);
    if (!current.ok) return current;
    if (!current.roomId) {
      return { ok: false, errCode: 'NOT_MEMBER', errMsg: '当前没有可访问的房间' };
    }
    snapshot = await app.readSnapshot(current.roomId, { ...actorContext, touchPresence: false });
  }
  if (!snapshot.ok) return snapshot;
  // 只允许把当前用户 MemberView 已经可见的媒体引用转换为临时 URL，避免管理员云函数越权签名任意文件。
  const allowedRefs = collectCloudFileRefs(snapshot.view);
  if (ids.some((id) => !allowedRefs.has(id))) {
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'fileList 包含不可访问的文件' };
  }
  const response = await cloud.getTempFileURL({ fileList: ids });
  return { ok: true, fileList: (response && response.fileList) || [] };
}

/** 二维码属于可再生媒体，不改变房间业务版本。 */
exports.main = async (event) => {
  const action = String(event && event.action || 'qrcode');
  const wxContext = cloud.getWXContext();
  const userId = wxContext.OPENID || '';
  const clientContext = event && event.clientContext || {};
  const actorContext = { userId,
    deviceSessionId: clientContext.deviceSessionId,
    touchPresence: clientContext.touchPresence === true };
  if (!userId) return { ok: false, errCode: 'UNAUTHENTICATED', errMsg: '未登录' };
  if (action === 'tempUrls') {
    try {
      return await tempUrls(event && event.fileList, actorContext, {
        roomId: event && event.roomId,
        sessionId: event && event.sessionId
      });
    } catch (e) {
      console.error('roomMedia tempUrls error', e);
      return { ok: false, errCode: e.code || 'INTERNAL_ERROR', errMsg: e.message || 'tempUrls failed' };
    }
  }
  const roomId = String(event && event.roomId || '');
  if (!roomId || action !== 'qrcode') {
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: 'roomId/action 不合法' };
  }
  try {
    const snapshot = await app.readSnapshot(roomId, actorContext);
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
