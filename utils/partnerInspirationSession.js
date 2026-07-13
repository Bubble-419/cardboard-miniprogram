/**
 * 当前脑暴对局内的灵感记录
 */

async function countSessionInspirations(roomId, brainstormSessionSeq) {
  if (!roomId) return 0;
  const seq = brainstormSessionSeq != null ? brainstormSessionSeq : 0;
  try {
    const res = await wx.cloud.callFunction({
      name: 'listInspirations',
      data: { roomId, brainstormSessionSeq: seq }
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
