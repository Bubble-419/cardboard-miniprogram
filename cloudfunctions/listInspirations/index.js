const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'inspirations';

function isWorkshopScope(workshopOnly) {
  return workshopOnly === true || workshopOnly === 'true' || workshopOnly === 1 || workshopOnly === '1';
}

function isOwnInspiration(item, userId) {
  if (!item || !userId) return false;
  // 兼容显式 userId 与云库默认 _openid
  if (item.userId && String(item.userId) === String(userId)) return true;
  if (item._openid && String(item._openid) === String(userId)) return true;
  return false;
}

/**
 * 获取灵感列表（仅当前用户；可按房间 / 对局筛选）
 * 灵感空间为个人空间，不与其他玩家共用
 */
exports.main = async (event) => {
  const { roomId, brainstormSessionSeq, workshopOnly } = event || {};

  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID;
  if (!userId) {
    return {
      ok: false,
      errCode: 'NO_AUTH',
      errMsg: '未登录',
      inspirations: [],
      total: 0
    };
  }

  try {
    // 先按本人拉取（兼容 userId / _openid），再按房间/对局过滤
    let rows = [];
    try {
      const res = await db.collection(COLLECTION).where(_.or([
        { userId },
        { _openid: userId }
      ])).limit(100).get();
      rows = res.data || [];
    } catch (queryErr) {
      // 无复合查询权限时降级：按房间拉再内存过滤
      console.warn('listInspirations or-query fallback', queryErr);
      if (roomId) {
        const res = await db.collection(COLLECTION).where({ roomId }).limit(100).get();
        rows = (res.data || []).filter((item) => isOwnInspiration(item, userId));
      } else {
        const res = await db.collection(COLLECTION).limit(100).get();
        rows = (res.data || []).filter((item) => isOwnInspiration(item, userId));
      }
    }

    rows = rows.filter((item) => isOwnInspiration(item, userId));

    if (roomId) {
      if (isWorkshopScope(workshopOnly)) {
        rows = rows.filter((item) => item && item.roomId === roomId);
      } else {
        const seq = brainstormSessionSeq != null ? Number(brainstormSessionSeq) : 0;
        rows = rows.filter((item) => {
          if (!item || item.roomId !== roomId) return false;
          return Number(item.brainstormSessionSeq != null ? item.brainstormSessionSeq : 0) === seq;
        });
      }
    }

    const list = rows
      .map((item) => {
        const imageUrls = Array.isArray(item.imageUrls) && item.imageUrls.length
          ? item.imageUrls
          : (item.imageUrl ? [item.imageUrl] : []);
        return {
          id: item._id,
          type: item.type || 'text',
          content: item.content || '',
          imageUrl: item.imageUrl || imageUrls[0] || '',
          imageUrls,
          duration: item.duration || '',
          isAIGenerated: item.isAIGenerated === true,
          createTime: item.createTime || item.updateTime || 0,
          updateTime: item.updateTime || item.createTime || 0
        };
      })
      .sort((a, b) => (b.updateTime || b.createTime || 0) - (a.updateTime || a.createTime || 0));

    return {
      ok: true,
      inspirations: list,
      total: list.length
    };
  } catch (e) {
    console.error('listInspirations error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'LIST_ERROR',
      errMsg: e.errMsg || e.message || '加载失败',
      inspirations: [],
      total: 0
    };
  }
};
