const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'inspirations';

/**
 * 获取灵感列表（可按脑暴对局筛选）
 */
exports.main = async (event) => {
  const { roomId, brainstormSessionSeq, workshopOnly } = event || {};

  try {
    let query = db.collection(COLLECTION);
    if (roomId) {
      if (workshopOnly === true) {
        query = query.where({ roomId });
      } else {
        query = query.where({
          roomId,
          brainstormSessionSeq: brainstormSessionSeq != null ? brainstormSessionSeq : 0
        });
      }
    }

    const res = await query.limit(100).get();
    const list = (res.data || [])
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
