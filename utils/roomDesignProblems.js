'use strict';

const { dispatchRoomCommand, getRoomPageSnapshot, getActiveRoomSession } = require('../modules/room-session/index');

function mapProblem(item, snapshot) {
  const member = (snapshot.members || []).find((row) => row.memberId === item.memberId) || {};
  return { id: item.contributionId, contributionId: item.contributionId, text: item.text,
    playerIndex: member.playerIndex, nickName: member.nickName || '', userId: item.memberId,
    entityVersion: item.entityVersion, createTime: item.createdAt, updateTime: item.createdAt,
    submitTime: item.createdAt };
}

async function currentSnapshot(roomId, refresh) {
  return getRoomPageSnapshot(roomId, { refresh: refresh === true });
}

async function clearRoomProblems() {
  // 问题按 sessionId 隔离，新场次天然为空，无需客户端执行删除。
  return { ok: true };
}

async function listProblems(roomId) {
  const snapshot = await currentSnapshot(roomId, true);
  const session = snapshot && snapshot.view && snapshot.view.session;
  return ((session && session.setup.designProblems) || []).map((item) => mapProblem(item, snapshot));
}

async function submitProblem(roomId, { text }) {
  const result = await dispatchRoomCommand('SUBMIT_DESIGN_PROBLEM', { text }, null, { roomId });
  if (!result || result.ok !== true) throw Object.assign(new Error(result && result.errMsg || '提交设计问题失败'), result);
  return result;
}

async function updateProblemText(docId, text) {
  const session = getActiveRoomSession();
  const view = session && session.getView();
  const problem = view && view.session && view.session.setup.designProblems
    .find((item) => item.contributionId === docId);
  if (!problem) throw new Error('设计问题已经变化，请刷新后重试');
  const result = await dispatchRoomCommand('UPDATE_DESIGN_PROBLEM',
    { contributionId: docId, text }, { entityVersion: problem.entityVersion });
  if (!result || result.ok !== true) throw Object.assign(new Error(result && result.errMsg || '更新设计问题失败'), result);
  return result;
}

async function getSubmitStatus(roomId, myPlayerIndex, totalMembers) {
  const snapshot = await currentSnapshot(roomId, true);
  const session = snapshot && snapshot.view && snapshot.view.session;
  const progress = session && session.progress && session.progress.contributionProgress || {};
  const actor = snapshot && snapshot.view && snapshot.view.actor;
  const problems = await listProblems(roomId);
  return { problems, submittedCount: progress.submittedCount || 0,
    totalMembers: progress.requiredCount || totalMembers || 0,
    allSubmitted: progress.requiredCount > 0 && progress.submittedCount >= progress.requiredCount,
    hasSubmitted: !!(actor && actor.contributionStatus.submitted),
    myProblemText: actor && actor.contributionStatus.text || '', myPlayerIndex };
}

module.exports = { clearRoomProblems, listProblems, submitProblem, updateProblemText, getSubmitStatus };
