const { getCloudDatabase } = require('./cloudDb');

const COLLECTION = 'designProblems';
const ENTRY_TYPE = 'designProblem';

function mapProblemDoc(item) {
  return {
    id: item._id,
    text: item.text || item.problemText || '',
    playerIndex: item.playerIndex,
    nickName: item.nickName || '',
    userId: item.userId || '',
    submitTime: item.updateTime || item.createTime || item.submitTime || 0
  };
}

async function clearRoomProblems(roomId) {
  const db = await getCloudDatabase();
  try {
    await db.collection(COLLECTION).where({ roomId, entryType: ENTRY_TYPE }).remove();
  } catch (e) {
    const res = await db.collection(COLLECTION).where({ roomId, entryType: ENTRY_TYPE }).get();
    const docs = res.data || [];
    await Promise.all(docs.map((doc) => db.collection(COLLECTION).doc(doc._id).remove()));
  }
}

async function listProblems(roomId) {
  const res = await wx.cloud.callFunction({
    name: 'getDesignProblems',
    data: { roomId }
  });
  const result = (res && res.result) || {};
  if (result.ok !== true) {
    throw new Error(result.errMsg || '获取设计问题失败');
  }
  return (result.problems || []).map((item) => ({
    id: item.id,
    text: item.text || '',
    playerIndex: item.playerIndex,
    nickName: item.nickName || '',
    userId: item.userId || '',
    submitTime: item.submitTime || 0
  }));
}

async function submitProblem(roomId, { playerIndex, nickName, text }) {
  const db = await getCloudDatabase();
  const problemText = (text || '').trim();
  if (!roomId || playerIndex == null || !problemText) {
    throw new Error('提交参数不完整');
  }

  const where = { roomId, playerIndex, entryType: ENTRY_TYPE };
  const existsRes = await db.collection(COLLECTION).where(where).get();
  const nowData = {
    roomId,
    playerIndex,
    entryType: ENTRY_TYPE,
    nickName: nickName || `玩家${playerIndex}`,
    text: problemText,
    problemText,
    updateTime: db.serverDate()
  };

  if (existsRes.data && existsRes.data.length) {
    await db.collection(COLLECTION).doc(existsRes.data[0]._id).update({ data: nowData });
  } else {
    await db.collection(COLLECTION).add({
      data: {
        ...nowData,
        createTime: db.serverDate()
      }
    });
  }
}

async function updateProblemText(docId, text) {
  const problemText = (text || '').trim();
  if (!docId || !problemText) return;
  const res = await wx.cloud.callFunction({
    name: 'updateDesignProblem',
    data: { problemId: docId, text: problemText }
  });
  const result = (res && res.result) || {};
  if (result.ok !== true) {
    throw new Error(result.errMsg || '更新设计问题失败');
  }
}

async function getSubmitStatus(roomId, myPlayerIndex, totalMembers) {
  const problems = await listProblems(roomId);
  const mine = problems.find((item) => item.playerIndex === myPlayerIndex) || null;
  const submittedCount = problems.length;
  const memberTotal = totalMembers || submittedCount;
  return {
    problems,
    submittedCount,
    totalMembers: memberTotal,
    allSubmitted: memberTotal > 0 && submittedCount >= memberTotal,
    hasSubmitted: !!mine,
    myProblemText: mine ? mine.text : ''
  };
}

module.exports = {
  COLLECTION,
  ENTRY_TYPE,
  clearRoomProblems,
  listProblems,
  submitProblem,
  updateProblemText,
  getSubmitStatus
};
