const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

/** 成员头像随机颜色池（兼容旧逻辑） */
const AVATAR_COLORS = ['#5EC159', '#4A90E2', '#E24A4A', '#E2B84A', '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB'];

function pickAvatarColor(usedColors) {
  const available = AVATAR_COLORS.filter(c => !usedColors.includes(c));
  return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : AVATAR_COLORS[0];
}

/**
 * 生成不超过 8 位数字的房间号，并尽量避免与已有房间重复
 * @param {number} maxRetry
 * @returns {Promise<string>}
 */
async function generateNumericRoomId(maxRetry = 5) {
  for (let i = 0; i < maxRetry; i++) {
    // 生成 8 位纯数字（10000000 - 99999999）
    const n = Math.floor(10000000 + Math.random() * 90000000);
    const roomId = String(n);
    // 检查是否已存在同名房间，避免冲突
    const exist = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!exist.data || exist.data.length === 0) {
      return roomId;
    }
  }
  // 退化兜底：多次重试后依然冲突，仍返回一个 8 位数字（极小概率重复）
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

/**
 * 云调用生成小程序码（无需 APP_SECRET，云开发环境自动鉴权）
 * scene 最多 32 字符，使用 rid=roomId
 * @param {string} roomId
 * @returns {Promise<Buffer>} 小程序码图片 buffer
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

exports.main = async (event, context) => {
  const { clientCreateId } = event || {};

  if (!clientCreateId) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'clientCreateId is required'
    };
  }

  const { OPENID } = cloud.getWXContext();

  try {
    // 幂等：根据 clientCreateId 查询是否已创建过房间
    const existing = await db
      .collection(ROOMS_COLLECTION)
      .where({ clientCreateId })
      .limit(1)
      .get();

    if (existing.data && existing.data.length > 0) {
      const room = existing.data[0];
      const roomId = room.roomId;
      // 已有二维码则直接返回
      if (room.qrcodeFileID) {
        return {
          ok: true,
          roomId,
          qrcodeFileID: room.qrcodeFileID
        };
      }
      // 房间存在但无二维码：尝试补生成
      let qrBuffer;
      try {
        qrBuffer = await generateWxacode(roomId);
      } catch (e) {
        console.error('补生成二维码失败', e.message || e);
        return { ok: true, roomId, qrcodeFileID: null };
      }
      if (!qrBuffer || !Buffer.isBuffer(qrBuffer) || qrBuffer.length === 0) {
        console.error('getWxacodeUnlimit 无有效 buffer');
        return { ok: true, roomId, qrcodeFileID: null };
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
        roomId,
        qrcodeFileID
      };
    }

    const now = Date.now();
    // 生成 8 位数字的房间号，满足「不超过 8 位数字」的要求
    const roomId = await generateNumericRoomId();
    const creatorColor = pickAvatarColor([]);

    // 使用事务同时写 Room 与 RoomMember（创建者，role=GOD，playerIndex=1，随机头像色）
    await db.runTransaction(async (transaction) => {
      await transaction.collection(ROOMS_COLLECTION).add({
        data: {
          roomId,
          status: 'CREATED',
          creatorId: OPENID,
          createdAt: now,
          updatedAt: now,
          clientCreateId
        }
      });

      await transaction.collection(ROOM_MEMBERS_COLLECTION).add({
        data: {
          roomId,
          userId: OPENID,
          role: 'GOD',
          nickName: '玩家1',
          avatarUrl: null,
          avatarColor: creatorColor,
          avatarIndex: 0,
          joinedAt: now,
          playerIndex: 1
        }
      });
    });

    // 生成小程序码：云调用 wxacode.getUnlimited（无需 APP_SECRET）
    let qrBuffer;
    try {
      qrBuffer = await generateWxacode(roomId);
    } catch (e) {
      console.error('generateWxacode error', e.message || e);
      return { ok: true, roomId, qrcodeFileID: null };
    }
    if (!qrBuffer || !Buffer.isBuffer(qrBuffer) || qrBuffer.length === 0) {
      console.error('getWxacodeUnlimit no buffer');
      return { ok: true, roomId, qrcodeFileID: null };
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
      roomId,
      qrcodeFileID
    };
  } catch (e) {
    console.error('roomCreate error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'ROOM_CREATE_ERROR',
      errMsg: e.errMsg || e.message || 'roomCreate failed'
    };
  }
};

