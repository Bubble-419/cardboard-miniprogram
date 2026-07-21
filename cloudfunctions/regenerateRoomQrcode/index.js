const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';

function extractWxacodeBuffer(res, envVersion) {
  if (!res) {
    throw new Error(`生成小程序码失败(${envVersion}): 空响应`);
  }
  if (res.errCode && Number(res.errCode) !== 0) {
    throw new Error(res.errMsg || res.errmsg || `errcode: ${res.errCode}`);
  }

  let buffer = res.buffer || res.fileContent;
  if (!buffer && Buffer.isBuffer(res)) buffer = res;
  if (!buffer) {
    const errMsg = res.errMsg || res.errmsg || (res.errcode ? `errcode: ${res.errcode}` : '');
    throw new Error(errMsg || `生成小程序码失败(${envVersion}): 无图片数据`);
  }

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!buf.length) {
    throw new Error(`生成小程序码失败(${envVersion}): 空图片`);
  }

  // 接口失败时偶尔返回 JSON 字节，误当成图片上传后客户端无法显示
  if (buf[0] === 0x7b /* { */) {
    try {
      const json = JSON.parse(buf.toString('utf8'));
      throw new Error(json.errmsg || json.errMsg || json.message || JSON.stringify(json));
    } catch (e) {
      if (e && e.message && !/Unexpected|JSON/i.test(e.message)) throw e;
      throw new Error(`生成小程序码失败(${envVersion}): 返回非图片数据`);
    }
  }

  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpg) {
    throw new Error(`生成小程序码失败(${envVersion}): 非图片格式`);
  }
  return buf;
}

/**
 * 云调用生成小程序码（无需 APP_SECRET）
 * 开发版/体验版优先，避免未正式发布时仅用 release 失败
 */
async function generateWxacode(roomId) {
  const scene = roomId.length <= 30 ? `rid=${roomId}` : `rid=${roomId.slice(0, 30)}`;
  const preferred = process.env.QR_ENV_VERSION || '';
  const envVersions = [preferred, 'develop', 'trial', 'release']
    .filter((v, i, arr) => v && arr.indexOf(v) === i);
  let lastError = null;

  for (let i = 0; i < envVersions.length; i++) {
    const envVersion = envVersions[i];
    try {
      const res = await cloud.openapi.wxacode.getUnlimited({
        page: 'pages/main-pages/addPlayer/index',
        scene,
        width: 430,
        check_path: false,
        env_version: envVersion
      });
      return extractWxacodeBuffer(res, envVersion);
    } catch (e) {
      lastError = e;
      console.warn(`generateWxacode ${envVersion} failed`, e.message || e);
    }
  }

  throw lastError || new Error('生成小程序码失败');
}

/**
 * 为已有房间补生成小程序码（用于此前创建失败时补救）
 */
exports.main = async (event, context) => {
  const { roomId } = event || {};

  if (!roomId || typeof roomId !== 'string') {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId is required'
    };
  }

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      return {
        ok: false,
        errCode: 'ROOM_NOT_FOUND',
        errMsg: '房间不存在'
      };
    }

    const room = roomRes.data[0];
    const wxContext = cloud.getWXContext();
    const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

    if (room.creatorId && String(room.creatorId) !== String(currentUserId)) {
      return {
        ok: false,
        errCode: 'NO_PERMISSION',
        errMsg: '仅创建者可补生成二维码'
      };
    }

    const qrBuffer = await generateWxacode(roomId);
    const cloudPath = `qrcodes/${roomId}.png`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: qrBuffer
    });

    const qrcodeFileID = uploadRes && uploadRes.fileID ? uploadRes.fileID : null;
    if (!qrcodeFileID) {
      return {
        ok: false,
        errCode: 'QR_UPLOAD_FAILED',
        errMsg: '二维码上传云存储失败'
      };
    }

    await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
      data: { qrcodeFileID, updatedAt: Date.now() }
    });

    let qrcodeUrl = '';
    try {
      const tempRes = await cloud.getTempFileURL({ fileList: [qrcodeFileID] });
      const first = tempRes && tempRes.fileList && tempRes.fileList[0];
      if (first && first.tempFileURL) qrcodeUrl = first.tempFileURL;
    } catch (e) {
      console.warn('getTempFileURL after regenerate failed', e);
    }

    return {
      ok: true,
      qrcodeFileID,
      qrcodeUrl
    };
  } catch (e) {
    console.error('regenerateRoomQrcode error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'REGENERATE_ERROR',
      errMsg: e.errMsg || e.message || '补生成二维码失败'
    };
  }
};
