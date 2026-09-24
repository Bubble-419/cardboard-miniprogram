const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'inspirations';

function isWorkshopScope(workshopOnly) {
  return workshopOnly === true || workshopOnly === 'true' || workshopOnly === 1 || workshopOnly === '1';
}

/**
 * 获取灵感列表（仅当前用户；可按房间 / 对局筛选）
 * 灵感空间为个人空间，不与其他玩家共用
 */
exports.main = async (event) => {
  const { roomId, sessionId, workshopOnly } = event || {};

  const wxContext = cloud.getWXContext();
  const userId = wxContext.OPENID;
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
    // 所有过滤与排序都下推到数据库，避免先扫描 100 条再在云函数内丢弃大部分结果。
    const condition = { userId };
    if (roomId) {
      condition.roomId = String(roomId);
      if (!isWorkshopScope(workshopOnly)) condition.sessionId = String(sessionId || '');
    }
    const res = await db.collection(COLLECTION).where(condition)
      .orderBy('updateTime', 'desc').limit(100).get();
    const rows = res.data || [];

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
      });

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
