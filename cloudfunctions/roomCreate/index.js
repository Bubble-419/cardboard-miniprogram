const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

/** 成员头像随机颜色池（兼容旧逻辑） */
const AVATAR_COLORS = ['#5EC159', '#4A90E2', '#E24A4A', '#E2B84A', '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB'];

function isLocalTempAvatar(url) {
  if (typeof url !== 'string' || !url) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith('wxfile://') ||
    lower.startsWith('file://') ||
    lower.startsWith('http://tmp/') ||
    lower.startsWith('https://tmp/') ||
    lower.indexOf('://tmp/') !== -1
  );
}

function normalizeShareableAvatarUrl(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.trim()) return null;
  const trimmed = avatarUrl.trim();
  if (isLocalTempAvatar(trimmed)) return null;
  return trimmed;
}

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
      if (res && res.errCode && Number(res.errCode) !== 0) {
        throw new Error(res.errMsg || res.errmsg || `errcode: ${res.errCode}`);
      }
      let buffer = (res && (res.buffer || res.fileContent)) || res;
      if (!buffer || (Buffer.isBuffer(buffer) && buffer.length === 0)) {
        const errMsg = (res && (res.errMsg || res.errmsg)) || '';
        throw new Error(errMsg || `生成小程序码失败(${envVersion})`);
      }
      const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      if (buf[0] === 0x7b) {
        const json = JSON.parse(buf.toString('utf8'));
        throw new Error(json.errmsg || json.errMsg || `生成小程序码失败(${envVersion})`);
      }
      return buf;
    } catch (e) {
      lastError = e;
      console.warn(`generateWxacode ${envVersion} failed`, e.message || e);
    }
  }
  throw lastError || new Error('生成小程序码失败');
}

exports.main = async (event, context) => {
  const { clientCreateId, avatarUrl, nickName: clientNickName } = event || {};
  const normalizedAvatarUrl = normalizeShareableAvatarUrl(avatarUrl);
  const normalizedNickName = typeof clientNickName === 'string' && clientNickName.trim()
    ? clientNickName.trim()
    : '玩家1';

  if (!clientCreateId) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'clientCreateId is required'
    };
  }

  const wxContext = cloud.getWXContext();
  // 跨账号共享时调用方用户需用 FROM_OPENID
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

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
    const creatorAvatarIndex = normalizedAvatarUrl ? null : 0;

    // 使用事务同时写 Room 与 RoomMember（创建者，role=GOD，playerIndex=1）
    await db.runTransaction(async (transaction) => {
      await transaction.collection(ROOMS_COLLECTION).add({
        data: {
          roomId,
          status: 'CREATED',
          creatorId: currentUserId,
          createdAt: now,
          updatedAt: now,
          clientCreateId
        }
      });

      await transaction.collection(ROOM_MEMBERS_COLLECTION).add({
        data: {
          roomId,
          userId: currentUserId,
          role: 'GOD',
          nickName: normalizedNickName,
          avatarUrl: normalizedAvatarUrl,
          avatarColor: creatorColor,
          avatarIndex: creatorAvatarIndex,
          joinedAt: now,
          lastSeenAt: now,
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

