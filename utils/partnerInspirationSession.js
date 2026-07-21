/**
 * 灵感计数 / 保存字段：与灵感空间同口径（本人 + 房间）
 */

async function countSessionInspirations(roomId) {
  if (!roomId) return 0;
  try {
    const res = await wx.cloud.callFunction({
      name: 'listInspirations',
      data: { roomId, workshopOnly: true }
    });
    const result = (res && res.result) || {};
    if (result.ok !== true) return 0;
    return result.total != null ? result.total : (result.inspirations || []).length;
  } catch (e) {
    console.warn('countSessionInspirations', e);
    return 0;
  }
}

function withSessionFields(data, roomId, brainstormSessionSeq) {
  const payload = { ...(data || {}) };
  if (roomId) {
    payload.roomId = roomId;
    payload.brainstormSessionSeq = brainstormSessionSeq != null ? brainstormSessionSeq : 0;
  }
  return payload;
}

module.exports = {
  countSessionInspirations,
  withSessionFields
};
