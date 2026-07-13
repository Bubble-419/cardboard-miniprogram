const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'inspirations';

exports.main = async (event) => {
  const { id } = event || {};
  if (!id) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'id is required' };
  }

  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const res = await db.collection(COLLECTION).doc(id).get();
    const item = res.data;
    if (!item) {
      return { ok: false, errCode: 'NOT_FOUND', errMsg: '灵感不存在' };
    }
    if (item.userId && item.userId !== userId) {
      return { ok: false, errCode: 'NO_PERMISSION', errMsg: '无权查看该灵感' };
    }

    const imageUrls = Array.isArray(item.imageUrls) && item.imageUrls.length
      ? item.imageUrls
      : (item.imageUrl ? [item.imageUrl] : []);

    return {
      ok: true,
      inspiration: {
        id: item._id,
        type: item.type || 'text',
        content: item.content || '',
        imageUrl: item.imageUrl || '',
        imageUrls,
        isAIGenerated: item.isAIGenerated === true,
        createTime: item.createTime || item.updateTime || 0,
        updateTime: item.updateTime || item.createTime || 0
      }
    };
  } catch (e) {
    console.error('getInspiration error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'GET_ERROR',
      errMsg: e.errMsg || e.message || '加载失败'
    };
  }
};
