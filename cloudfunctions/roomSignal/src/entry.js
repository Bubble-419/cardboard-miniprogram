'use strict';

const cloud = require('wx-server-sdk');
const { createRoomApplication } = require('@cardboard/room-application');
const { createCloudBaseRoomRepository, COLLECTIONS, docId } = require('@cardboard/room-cloudbase-adapter');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const app = createRoomApplication(createCloudBaseRoomRepository({ db, cloud }));

/** 可丢失的秒级信号：只写独立集合，不推进 eventSeq/stateVersion。 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const userId = wxContext.OPENID || '';
  const roomId = String(event && event.roomId || '');
  const signalType = String(event && event.signalType || '');
  const sessionId = String(event && event.sessionId || '');
  const turnId = String(event && event.turnId || '');
  const rawValue = event && event.value;
  if (!roomId || !sessionId || !turnId || signalType !== 'PARTNER_SILENT_SOUND'
    || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return { ok: false, errCode: 'INVALID_ARGUMENT', errMsg: '未知瞬时信号' };
  }
  try {
    const snapshot = await app.readSnapshot(roomId, { userId });
    if (!snapshot.ok) return snapshot;
    const session = snapshot.view && snapshot.view.session;
    const actor = snapshot.view && snapshot.view.actor;
    const turn = session && session.activeTurn;
    const now = Date.now();
    if (!turn || !actor || session.sessionId !== sessionId || turn.turnId !== turnId
      || turn.activeMemberId !== actor.memberId || Number(turn.silentDeadlineAt) <= now) {
      return { ok: false, errCode: 'INVALID_TRANSITION', errMsg: '当前不能发布静默声贝' };
    }
    const value = Math.min(1, Math.max(0, rawValue));
    const row = { roomId, signalType, value, memberId: actor.memberId,
      sessionId: session.sessionId, turnId: turn.turnId,
      updatedAt: now, expiresAt: Math.min(turn.silentDeadlineAt, now + 3000) };
    await db.collection(COLLECTIONS.signals).doc(docId(`${roomId}:${signalType}`)).set({ data: row });
    return { ok: true, signal: row };
  } catch (e) {
    console.error('roomSignal error', e);
    return { ok: false, errCode: e.code || 'INTERNAL_ERROR', errMsg: e.message || 'roomSignal failed' };
  }
};
