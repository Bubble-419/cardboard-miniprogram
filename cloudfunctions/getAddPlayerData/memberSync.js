/**
 * 成员离开后的房间同步（供 roomLeave / roomKickMember 复用）
 * - 广播语义：写入 rooms.lastEvent，客户端轮询 getAddPlayerData 消费
 * - room_members_updated：成员列表变化
 * - game_returned_to_room：有效人数 ≤1，回退房间等待
 */

function samePlayerIndex(a, b) {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

function isActiveBrainstorm(room) {
  if (!room) return false;
  if (room.brainstormSessionEnded === true) return false;
  const modeId = room.selectedModeId;
  if (modeId == null || modeId === '') return false;
  const page = String(room.currentPage || '').toLowerCase();
  if (!page || page === 'addplayer') return false;
  return true;
}

function pruneSpyGameAfterLeave(spyGame, removedPlayerIndex) {
  if (!spyGame || typeof spyGame !== 'object') return null;
  const next = { ...spyGame };
  const removed = Number(removedPlayerIndex);

  next.players = (Array.isArray(spyGame.players) ? spyGame.players : []).map((p) => {
    if (!p) return p;
    if (!samePlayerIndex(p.playerIndex, removed)) return p;
    return { ...p, alive: false, leftRoom: true };
  });

  next.speakOrder = (Array.isArray(spyGame.speakOrder) ? spyGame.speakOrder : [])
    .filter((idx) => !samePlayerIndex(idx, removed));

  const alive = next.players.filter((p) => p && p.alive !== false && p.leftRoom !== true);
  const aliveIndexes = new Set(alive.map((p) => Number(p.playerIndex)));

  // 当前发言人已离开：切到下一位仍在房间内的玩家
  if (next.phase === 'speak') {
    const order = next.speakOrder || [];
    let i = Math.max(0, Number(next.currentSpeakIndex) || 0);
    // 若原发言人离开，从当前位置找下一位存活
    while (i < order.length && !aliveIndexes.has(Number(order[i]))) {
      i += 1;
    }
    if (i >= order.length) {
      // 无人可发言 → 进入投票
      next.phase = 'vote';
      next.currentSpeakIndex = order.length;
      next.voteStartedAt = Date.now();
      next.voteStatus = {
        votedPlayerIndexes: [],
        abstainPlayerIndexes: [],
        votes: {}
      };
    } else {
      next.currentSpeakIndex = i;
      next.speakTurnStartedAt = Date.now();
    }
  }

  if (next.phase === 'vote' && next.voteStatus && typeof next.voteStatus === 'object') {
    const vs = { ...(next.voteStatus || {}) };
    vs.votedPlayerIndexes = (vs.votedPlayerIndexes || [])
      .filter((idx) => !samePlayerIndex(idx, removed));
    if (vs.votes && typeof vs.votes === 'object') {
      const votes = { ...vs.votes };
      delete votes[String(removed)];
      vs.votes = votes;
    }
    next.voteStatus = vs;
  }

  return next;
}

/**
 * @param {object} db cloud.database()
 * @param {object} room 房间文档（含 _id）
 * @param {string} roomId
 * @param {object} removedMember { userId, playerIndex }
 * @param {Array} remainingMembers 移除后的成员列表
 */
async function syncRoomAfterMemberRemoved(db, room, roomId, removedMember, remainingMembers) {
  const now = Date.now();
  const members = Array.isArray(remainingMembers) ? remainingMembers : [];
  const memberCount = members.length;
  const removedPlayerIndex = removedMember && removedMember.playerIndex != null
    ? removedMember.playerIndex
    : null;

  const updateData = {
    currentMemberCount: memberCount,
    updatedAt: now,
    lastEvent: {
      type: 'room_members_updated',
      at: now,
      memberCount,
      removedUserId: (removedMember && removedMember.userId) || '',
      removedPlayerIndex
    }
  };

  if (room.selectedModeId === 'spy' && room.spyGame) {
    const nextSpy = pruneSpyGameAfterLeave(room.spyGame, removedPlayerIndex);
    if (nextSpy) updateData.spyGame = nextSpy;
  }

  // 局内有效人数 ≤1：回退房间等待，广播 game_returned_to_room
  if (memberCount <= 1 && isActiveBrainstorm(room)) {
    updateData.currentPage = 'addPlayer';
    updateData.brainstormProgressPage = '';
    updateData.brainstormSessionEnded = true;
    updateData.selectedModeId = null;
    updateData.selectedModeTitle = '';
    updateData.selectedModeDesc = '';
    // 用 remove 而非 null：云库对 null 对象字段后续整对象写入会失败
    // （Cannot create field 'function' in element {selectedBG: null}）
    updateData.selectedBG = db.command.remove();
    updateData.spyGame = db.command.remove();
    updateData.spyAssignments = db.command.remove();
    updateData.partnerGamePhase = 'play';
    updateData.partnerMasterMode = false;
    updateData.partnerClosingStep = 'rune';
    updateData.partnerCurrentRoundContent = {
      playHistory: [],
      discussionNotes: [],
      playImages: [],
      discussionImages: [],
      images: [],
      voiceLines: [],
      turnRecords: [],
      aiSummary: { status: 'pending' }
    };
    updateData.lastEvent = {
      type: 'game_returned_to_room',
      at: now,
      reason: 'only_one_member',
      memberCount,
      removedUserId: (removedMember && removedMember.userId) || '',
      removedPlayerIndex
    };
  }

  await db.collection('rooms').doc(room._id).update({ data: updateData });

  return {
    ok: true,
    memberCount,
    event: updateData.lastEvent
  };
}

module.exports = {
  samePlayerIndex,
  isActiveBrainstorm,
  pruneSpyGameAfterLeave,
  syncRoomAfterMemberRemoved
};
