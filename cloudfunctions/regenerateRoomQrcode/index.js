const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';

/**
 * 云调用生成小程序码（无需 APP_SECRET，云开发环境自动鉴权）
 */
async function generateWxacode(roomId) {
  const scene = roomId.length <= 30 ? `rid=${roomId}` : `rid=${roomId.slice(0, 30)}`;
  const envVersion = process.env.QR_ENV_VERSION || 'release'; // release | trial | develop
  const res = await cloud.openapi.wxacode.getUnlimited({
    page: 'pages/main-pages/addPlayer/index',
    scene,
    width: 430,
    check_path: false,
    env_version: envVersion
  });
  const buffer = res.buffer || res;
  if (!buffer || (Buffer.isBuffer(buffer) && buffer.length === 0)) {
    const errMsg = res.errMsg || res.errmsg || (res.errcode ? `errcode: ${res.errcode}` : '');
    throw new Error(errMsg || '生成小程序码失败');
  }
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
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
    const { OPENID } = cloud.getWXContext();

    if (room.creatorId && room.creatorId !== OPENID) {
      return {
        ok: false,
        errCode: 'NO_PERMISSION',
        errMsg: '仅创建者可补生成二维码'
      };
    }

    const qrBuffer = await generateWxacode(roomId);

    if (!qrBuffer || !Buffer.isBuffer(qrBuffer) || qrBuffer.length === 0) {
      return {
        ok: false,
        errCode: 'QR_GEN_FAILED',
        errMsg: '生成小程序码失败'
      };
    }

    const cloudPath = `qrcodes/${roomId}.png`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: qrBuffer
    });

    const qrcodeFileID = uploadRes && uploadRes.fileID ? uploadRes.fileID : null;
    if (qrcodeFileID) {
      await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
        data: { qrcodeFileID, updatedAt: Date.now() }
      });
    }

    return {
      ok: true,
      qrcodeFileID
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
