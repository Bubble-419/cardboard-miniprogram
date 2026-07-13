const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'inspirations';

/**
 * 保存 / 更新灵感
 */
exports.main = async (event) => {
  const {
    id,
    roomId,
    brainstormSessionSeq,
    type,
    content,
    imageUrl,
    imageUrls,
    isAIGenerated,
    referencedInspirations
  } = event || {};

  const text = typeof content === 'string' ? content : '';
  const photos = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
  const singleImage = imageUrl || photos[0] || '';
  if (!text.trim() && !singleImage && !photos.length) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: '内容不能为空' };
  }

  const wxContext = cloud.getWXContext();
  const userId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const now = Date.now();
    const doc = {
      type: type || 'text',
      content: text,
      isAIGenerated: isAIGenerated === true,
      referencedInspirations: Array.isArray(referencedInspirations) ? referencedInspirations : [],
      updateTime: now,
      userId
    };
    if (photos.length) {
      doc.imageUrls = photos;
      doc.imageUrl = photos[0];
    } else if (singleImage) {
      doc.imageUrl = singleImage;
      doc.imageUrls = [singleImage];
    }

    if (id) {
      const existing = await db.collection(COLLECTION).doc(id).get();
      const row = existing.data;
      if (!row) {
        return { ok: false, errCode: 'NOT_FOUND', errMsg: '灵感不存在' };
      }
      if (row.userId && row.userId !== userId) {
        return { ok: false, errCode: 'NO_PERMISSION', errMsg: '无权编辑该灵感' };
      }
      await db.collection(COLLECTION).doc(id).update({ data: doc });
      return { ok: true, id };
    }

    doc.createTime = now;
    if (roomId) {
      doc.roomId = roomId;
      doc.brainstormSessionSeq = brainstormSessionSeq != null ? brainstormSessionSeq : 0;
    }

    const addRes = await db.collection(COLLECTION).add({ data: doc });
    return { ok: true, id: addRes._id };
  } catch (e) {
    console.error('saveInspiration error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'SAVE_ERROR',
      errMsg: e.errMsg || e.message || '保存失败'
    };
  }
};
