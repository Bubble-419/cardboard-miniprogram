'use strict';

const {
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  MAX_SEATS,
  LIFECYCLE,
  COMMAND_TYPES,
  ERR,
  fail,
  okResult,
  emptyDomainRevisions,
  isNonEmptyString
} = require('@cardboard/room-contracts');
const { executeSpyCommand } = require('./spy');

const AVATAR_COLORS = [
  '#5EC159', '#4A90E2', '#E24A4A', '#E2B84A',
  '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB'
];

function allocateSeatNo(seatMap) {
  const used = new Set(
    Object.keys(seatMap || {})
      .map((k) => parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
  );
  for (let seat = 1; seat <= MAX_SEATS; seat += 1) {
    if (!used.has(seat)) return seat;
  }
  return null;
}

function pickAvatarColor(seatMap, membersByUserId) {
  const used = [];
  Object.values(seatMap || {}).forEach((userId) => {
    const m = membersByUserId[userId];
    if (m && m.avatarColor) used.push(m.avatarColor);
  });
  const available = AVATAR_COLORS.filter((c) => !used.includes(c));
  return available.length ? available[0] : AVATAR_COLORS[0];
}

function buildCapabilities(room, actorUserId) {
  const seatNo = findSeatNo(room.seatMap, actorUserId);
  const isHost = room.hostUserId && String(room.hostUserId) === String(actorUserId);
  const isMember = !!(seatNo || isHost);
  const inLobby = room.lifecycle === LIFECYCLE.LOBBY;
  return {
    joinRoom: {
      allowed: room.lifecycle !== LIFECYCLE.DISSOLVED && memberCount(room.seatMap) < MAX_SEATS,
      reason: room.lifecycle === LIFECYCLE.DISSOLVED ? 'ROOM_DISSOLVED' : (memberCount(room.seatMap) >= MAX_SEATS ? 'ROOM_FULL' : null)
    },
    leaveRoom: {
      allowed: isMember && !isHost,
      reason: !isMember ? 'NOT_MEMBER' : (isHost ? 'HOST_CANNOT_LEAVE' : null)
    },
    reorderSeats: {
      allowed: isHost && inLobby,
      reason: !isHost ? 'HOST_ONLY' : (!inLobby ? 'INVALID_TRANSITION' : null)
    },
    dissolveRoom: {
      allowed: isHost,
      reason: isHost ? null : 'HOST_ONLY'
    },
    submitScore: {
      allowed: isMember && !(room.workflow && room.workflow.activeSeatNo != null && Number(seatNo) === Number(room.workflow.activeSeatNo)),
      reason: !isMember
        ? 'NOT_MEMBER'
        : (room.workflow && Number(seatNo) === Number(room.workflow.activeSeatNo) ? 'SELF_SCORE' : null)
    },
    startStatement: {
      allowed: (() => {
        if (!isHost || !room.progress) return false;
        const actingSeat = room.workflow && room.workflow.activeSeatNo != null
          ? Number(room.workflow.activeSeatNo)
          : (room.currentPlayerIndex != null ? Number(room.currentPlayerIndex) : null);
        const roundNo = room.workflow && room.workflow.roundNo != null
          ? Number(room.workflow.roundNo)
          : (room.currentRound != null ? Number(room.currentRound) : 1);
        const expectedTurnId = (room.workflow && room.workflow.turnId)
          || (actingSeat != null ? `turn_r${roundNo}_s${actingSeat}` : null);
        const progressFresh = !!(
          expectedTurnId
          && room.progress.turnId
          && room.progress.turnId === expectedTurnId
        );
        if (!progressFresh) return false;
        const required = Math.max(
          Number(room.progress.requiredScoreCount) || 0,
          Math.max(0, memberCount(room.seatMap) - 1)
        );
        return required > 0 && (room.progress.scoredCount || 0) >= required;
      })(),
      reason: !isHost
        ? 'HOST_ONLY'
        : 'SCORES_INCOMPLETE'
    }
  };
}

function buildHead(room, actorUserId) {
  const seatNo = findSeatNo(room.seatMap, actorUserId);
  const isHost = room.hostUserId && String(room.hostUserId) === String(actorUserId);
  return {
    protocolVersion: room.protocolVersion || PROTOCOL_VERSION,
    roomId: room.roomId,
    schemaVersion: room.schemaVersion || SCHEMA_VERSION,
    revision: room.revision,
    lifecycle: room.lifecycle,
    activeSessionId: room.activeSessionId || null,
    workflow: room.workflow || null,
    domainRevisions: room.domainRevisions || emptyDomainRevisions(),
    progress: room.progress || {
      scoredCount: 0,
      requiredScoreCount: 0,
      votedCount: 0,
      requiredVoteCount: 0
    },
    actor: {
      role: isHost ? 'HOST' : (seatNo ? 'PLAYER' : 'NONE'),
      seatNo: seatNo || null
    },
    capabilities: buildCapabilities(room, actorUserId),
    serverTime: Date.now()
  };
}

function projectMembersDomain(room, actorUserId) {
  const list = [];
  const seatMap = room.seatMap || {};
  Object.keys(seatMap)
    .map((k) => parseInt(k, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .forEach((seatNo) => {
      const userId = seatMap[String(seatNo)];
      const m = (room.membersByUserId && room.membersByUserId[userId]) || {};
      list.push({
        seatNo,
        nickName: m.nickName || `玩家${seatNo}`,
        avatarColor: m.avatarColor || '#5EC159',
        avatarUrl: m.avatarUrl || null,
        avatarIndex: m.avatarIndex != null ? m.avatarIndex : null,
        role: m.role === 'HOST' || seatNo === 1 ? 'HOST' : 'PLAYER',
        isMe: String(userId) === String(actorUserId),
        online: m.online !== false
        // 不返回 userId / openid
      });
    });
  return list;
}

/**
 * 按域投影快照；仅返回 clientDomainRevisions 落后或缺失的域。
 * @param {object} room
 * @param {object} options
 * @param {string} options.actorUserId
 * @param {string[]} [options.domains]
 * @param {object} [options.clientDomainRevisions]
 * @param {object} [options.extraDomainData] 仓储预加载的域数据 { scores, messages, ... }
 */
function projectSnapshot(room, options) {
  const actorUserId = options && options.actorUserId;
  const requested = (options && options.domains && options.domains.length)
    ? options.domains
    : ['members'];
  const clientRevs = (options && options.clientDomainRevisions) || {};
  const serverRevs = room.domainRevisions || emptyDomainRevisions();
  const extra = (options && options.extraDomainData) || {};

  const domains = {};
  requested.forEach((name) => {
    const serverRev = serverRevs[name] != null ? serverRevs[name] : 0;
    const clientRev = clientRevs[name] != null ? clientRevs[name] : -1;
    if (clientRev >= serverRev && clientRev >= 0) {
      return;
    }
    let data = null;
    if (name === 'members') {
      data = projectMembersDomain(room, actorUserId);
    } else if (Object.prototype.hasOwnProperty.call(extra, name)) {
      data = extra[name];
    } else {
      data = name === 'scores' || name === 'votes' ? {} : [];
    }
    domains[name] = { revision: serverRev, data };
  });

  return {
    roomId: room.roomId,
    revision: room.revision,
    domains,
    serverTime: Date.now()
  };
}

/**
 * 查询侧授权：成员或房主可读；解散房仅房主可读 head。
 */
function authorizeRoomRead(room, actorUserId) {
  if (!isNonEmptyString(actorUserId)) {
    return fail(ERR.UNAUTHENTICATED);
  }
  if (!room) {
    return fail(ERR.ROOM_NOT_FOUND);
  }
  if (room.lifecycle === LIFECYCLE.DISSOLVED || room.status === 'DISSOLVED') {
    return fail(ERR.ROOM_DISSOLVED);
  }
  const seatNo = findSeatNo(room.seatMap, actorUserId);
  const isHost = room.hostUserId && String(room.hostUserId) === String(actorUserId);
  if (!seatNo && !isHost) {
    return fail(ERR.NOT_MEMBER);
  }
  return okResult({ room });
}

function findSeatNo(seatMap, userId) {
  if (!userId || !seatMap) return null;
  const entries = Object.entries(seatMap);
  for (let i = 0; i < entries.length; i += 1) {
    if (String(entries[i][1]) === String(userId)) {
      return parseInt(entries[i][0], 10);
    }
  }
  return null;
}

function memberCount(seatMap) {
  return Object.keys(seatMap || {}).length;
}

function assertActor(actorUserId) {
  if (!isNonEmptyString(actorUserId)) {
    return fail(ERR.UNAUTHENTICATED);
  }
  return null;
}

function createRoomAggregate({ roomId, actorUserId, payload, now }) {
  const nickName = isNonEmptyString(payload.nickName)
    ? String(payload.nickName).trim()
    : '玩家1';
  const avatarUrl = payload.avatarUrl || null;
  const avatarColor = pickAvatarColor({}, {});
  const member = {
    userId: actorUserId,
    seatNo: 1,
    role: 'HOST',
    nickName,
    avatarUrl,
    avatarColor,
    avatarIndex: avatarUrl ? null : 0,
    joinedAt: now
  };
  return {
    roomId,
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    lifecycle: LIFECYCLE.LOBBY,
    // 兼容旧字段
    status: 'CREATED',
    hostUserId: actorUserId,
    creatorId: actorUserId,
    seatMap: { '1': actorUserId },
    activeSessionId: null,
    revision: 1,
    workflow: null,
    domainRevisions: { ...emptyDomainRevisions(), members: 1 },
    progress: {
      scoredCount: 0,
      requiredScoreCount: 0,
      votedCount: 0,
      requiredVoteCount: 0
    },
    workshopName: isNonEmptyString(payload.workshopName)
      ? String(payload.workshopName).trim()
      : '脑暴工作坊',
    membersByUserId: { [actorUserId]: member },
    createdAt: now,
    updatedAt: now
  };
}

/**
 * 纯领域执行：输入当前房间聚合（可为 null）与命令，输出下一状态或错误。
 * 不访问数据库；幂等由 application 层处理。
 */
function executeCommand({
  room,
  envelope,
  actorUserId,
  roomIdFactory,
  now,
  wordPairPicker,
  random
}) {
  const authErr = assertActor(actorUserId);
  if (authErr) return authErr;

  const ts = now || Date.now();
  const { type, payload, expectedRevision, commandId, roomId } = envelope;

  if (type === COMMAND_TYPES.CREATE_ROOM) {
    if (room) {
      return fail(ERR.INVALID_ARGUMENT, '房间已存在');
    }
    const newRoomId = roomIdFactory ? roomIdFactory() : null;
    if (!isNonEmptyString(newRoomId)) {
      return fail(ERR.INTERNAL_ERROR, '无法生成 roomId');
    }
    const next = createRoomAggregate({
      roomId: newRoomId,
      actorUserId,
      payload: payload || {},
      now: ts
    });
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { created: true }
    });
  }

  if (!room) {
    return fail(ERR.ROOM_NOT_FOUND);
  }
  if (room.lifecycle === LIFECYCLE.DISSOLVED || room.status === 'DISSOLVED') {
    return fail(ERR.ROOM_DISSOLVED);
  }

  if (type === COMMAND_TYPES.JOIN_ROOM) {
    const existingSeat = findSeatNo(room.seatMap, actorUserId);
    if (existingSeat) {
      const membersByUserId = { ...room.membersByUserId };
      const prev = membersByUserId[actorUserId] || {};
      const nextMember = { ...prev };
      if (isNonEmptyString(payload.nickName)) {
        nextMember.nickName = String(payload.nickName).trim();
      }
      if (payload.avatarUrl !== undefined) {
        nextMember.avatarUrl = payload.avatarUrl || null;
      }
      membersByUserId[actorUserId] = nextMember;
      const next = {
        ...room,
        membersByUserId,
        updatedAt: ts
      };
      return okResult({
        commandId,
        appliedRevision: room.revision,
        changedDomains: [],
        room: next,
        head: buildHead(next, actorUserId),
        effects: { alreadyMember: true, seatNo: existingSeat }
      });
    }
    if (memberCount(room.seatMap) >= MAX_SEATS) {
      return fail(ERR.ROOM_FULL);
    }
    if (room.lifecycle !== LIFECYCLE.LOBBY && room.lifecycle !== LIFECYCLE.ACTIVE) {
      return fail(ERR.INVALID_TRANSITION);
    }
    const seatNo = allocateSeatNo(room.seatMap);
    if (seatNo == null) return fail(ERR.ROOM_FULL);

    const nickName = isNonEmptyString(payload.nickName)
      ? String(payload.nickName).trim()
      : `玩家${seatNo}`;
    const avatarUrl = payload.avatarUrl || null;
    const avatarColor = pickAvatarColor(room.seatMap, room.membersByUserId || {});
    const member = {
      userId: actorUserId,
      seatNo,
      role: 'PLAYER',
      nickName,
      avatarUrl,
      avatarColor,
      avatarIndex: avatarUrl ? null : Math.min(seatNo - 1, 8),
      joinedAt: ts
    };
    const seatMap = { ...room.seatMap, [String(seatNo)]: actorUserId };
    const membersByUserId = { ...(room.membersByUserId || {}), [actorUserId]: member };
    const domainRevisions = {
      ...(room.domainRevisions || emptyDomainRevisions()),
      members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
    };
    const next = {
      ...room,
      seatMap,
      membersByUserId,
      domainRevisions,
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { joined: true, seatNo }
    });
  }

  // 并发事实命令：需成员，不要求全局 revision CAS（独立文档幂等）
  {
    const factTypes = [
      COMMAND_TYPES.SUBMIT_SCORE,
      COMMAND_TYPES.POST_MESSAGE,
      COMMAND_TYPES.SUBMIT_CLOSING_VOTE,
      COMMAND_TYPES.APPEND_ARTIFACT
    ];
    if (factTypes.includes(type)) {
      const actorSeat = findSeatNo(room.seatMap, actorUserId);
      const isHost = String(room.hostUserId) === String(actorUserId);
      if (!actorSeat && !isHost) {
        return fail(ERR.NOT_MEMBER);
      }

      if (type === COMMAND_TYPES.SUBMIT_SCORE) {
        const score = parseInt(payload.score, 10);
        if (!Number.isFinite(score) || score < 0 || score > 5) {
          return fail(ERR.INVALID_ARGUMENT, 'score 需为 0～5');
        }
        const activeSeatNo = room.workflow && room.workflow.activeSeatNo != null
          ? Number(room.workflow.activeSeatNo)
          : (payload.activeSeatNo != null ? Number(payload.activeSeatNo) : null);
        if (activeSeatNo != null && Number(actorSeat) === Number(activeSeatNo)) {
          return fail(ERR.SELF_SCORE);
        }
        const turnId = (room.workflow && room.workflow.turnId)
          || payload.turnId
          || `turn_r${(room.workflow && room.workflow.roundNo) || 1}_s${activeSeatNo || 0}`;
        const scores = { ...(room.scoresByKey || {}) };
        const key = `${turnId}:${actorUserId}`;
        scores[key] = {
          turnId,
          scorerUserId: actorUserId,
          activeSeatNo,
          score,
          updatedAt: ts
        };
        const required = Math.max(0, memberCount(room.seatMap) - 1);
        const scoredUserIds = new Set();
        Object.keys(scores).forEach((k) => {
          const row = scores[k];
          if (row && row.turnId === turnId) scoredUserIds.add(row.scorerUserId);
        });
        const progress = {
          scoredCount: scoredUserIds.size,
          requiredScoreCount: required,
          votedCount: (room.progress && room.progress.votedCount) || 0,
          requiredVoteCount: (room.progress && room.progress.requiredVoteCount) || 0,
          turnId
        };
        const domainRevisions = {
          ...(room.domainRevisions || emptyDomainRevisions()),
          scores: (room.domainRevisions && room.domainRevisions.scores || 0) + 1
        };
        const next = {
          ...room,
          scoresByKey: scores,
          progress,
          domainRevisions,
          revision: room.revision + 1,
          updatedAt: ts
        };
        return okResult({
          commandId,
          appliedRevision: next.revision,
          changedDomains: ['scores'],
          room: next,
          head: buildHead(next, actorUserId),
          effects: {
            scoreUpsert: true,
            scoreKey: key,
            scoredCount: progress.scoredCount,
            totalRequired: required
          }
        });
      }

      if (type === COMMAND_TYPES.POST_MESSAGE) {
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text) return fail(ERR.INVALID_ARGUMENT, '内容不能为空');
        if (text.length > 40) return fail(ERR.INVALID_ARGUMENT, '最多 40 字');
        const messageId = payload.messageId || `msg_${commandId}`;
        const messages = Array.isArray(room.messages) ? room.messages.slice() : [];
        if (!messages.some((m) => m && m.id === messageId)) {
          messages.push({
            id: messageId,
            text,
            at: ts,
            round: payload.round != null ? Number(payload.round) : 0,
            phase: payload.phase === 'discussion' ? 'discussion' : 'play',
            anonKey: payload.anonKey || null
          });
        }
        const trimmed = messages.slice(-40);
        const domainRevisions = {
          ...(room.domainRevisions || emptyDomainRevisions()),
          messages: (room.domainRevisions && room.domainRevisions.messages || 0) + 1
        };
        const next = {
          ...room,
          messages: trimmed,
          domainRevisions,
          revision: room.revision + 1,
          updatedAt: ts
        };
        return okResult({
          commandId,
          appliedRevision: next.revision,
          changedDomains: ['messages'],
          room: next,
          head: buildHead(next, actorUserId),
          effects: { messageAppended: true, messageId }
        });
      }

      if (type === COMMAND_TYPES.SUBMIT_CLOSING_VOTE) {
        const vote = String(payload.vote || '');
        if (vote !== 'pass' && vote !== 'question') {
          return fail(ERR.INVALID_ARGUMENT, 'vote 需为 pass 或 question');
        }
        const voteSessionId = (room.workflow && room.workflow.voteSessionId)
          || payload.voteSessionId
          || `vote_${room.roomId}`;
        const votes = { ...(room.votesByKey || {}) };
        const key = `${voteSessionId}:${actorUserId}`;
        if (votes[key]) {
          return fail(ERR.ALREADY_VOTED);
        }
        votes[key] = {
          voteSessionId,
          voterUserId: actorUserId,
          seatNo: actorSeat,
          vote,
          at: ts
        };
        const required = memberCount(room.seatMap);
        const votedCount = Object.keys(votes).filter((k) => votes[k].voteSessionId === voteSessionId).length;
        const progress = {
          ...(room.progress || {}),
          votedCount,
          requiredVoteCount: required
        };
        const domainRevisions = {
          ...(room.domainRevisions || emptyDomainRevisions()),
          votes: (room.domainRevisions && room.domainRevisions.votes || 0) + 1
        };
        const next = {
          ...room,
          votesByKey: votes,
          progress,
          domainRevisions,
          revision: room.revision + 1,
          updatedAt: ts
        };
        return okResult({
          commandId,
          appliedRevision: next.revision,
          changedDomains: ['votes'],
          room: next,
          head: buildHead(next, actorUserId),
          effects: { voteUpsert: true, voteKey: key, votedCount, totalMembers: required }
        });
      }

      if (type === COMMAND_TYPES.APPEND_ARTIFACT) {
        const operationId = payload.operationId || commandId;
        const artifacts = Array.isArray(room.artifacts) ? room.artifacts.slice() : [];
        if (!artifacts.some((a) => a && a.operationId === operationId)) {
          artifacts.push({
            operationId,
            kind: payload.kind || 'text',
            turnId: payload.turnId || null,
            stage: payload.stage || 'play',
            body: payload.body || null,
            at: ts
          });
        }
        const domainRevisions = {
          ...(room.domainRevisions || emptyDomainRevisions()),
          artifacts: (room.domainRevisions && room.domainRevisions.artifacts || 0) + 1
        };
        const next = {
          ...room,
          artifacts,
          domainRevisions,
          revision: room.revision + 1,
          updatedAt: ts
        };
        return okResult({
          commandId,
          appliedRevision: next.revision,
          changedDomains: ['artifacts'],
          room: next,
          head: buildHead(next, actorUserId),
          effects: { artifactAppended: true, operationId }
        });
      }
    }
  }

  // Spy 命令矩阵（Phase 6）：在通用 revision 闸门前分流（含只读 GET_MY_CARD）
  if (String(type).indexOf('SPY_') === 0) {
    const spyResult = executeSpyCommand({
      room,
      envelope,
      actorUserId,
      ts,
      wordPairPicker,
      random
    });
    if (!spyResult.ok) return spyResult;
    return okResult({
      ...spyResult,
      head: spyResult.effects && spyResult.effects.readOnly
        ? buildHead(room, actorUserId)
        : buildHead(spyResult.room, actorUserId)
    });
  }

  // 以下命令需要成员身份与 expectedRevision
  const actorSeat = findSeatNo(room.seatMap, actorUserId);
  const isHost = String(room.hostUserId) === String(actorUserId);
  if (!actorSeat && !isHost) {
    return fail(ERR.NOT_MEMBER);
  }
  if (expectedRevision == null || Number(expectedRevision) !== Number(room.revision)) {
    return fail(ERR.REVISION_CONFLICT, undefined, {
      latestHead: buildHead(room, actorUserId)
    });
  }

  if (type === COMMAND_TYPES.START_STATEMENT) {
    if (!isHost) return fail(ERR.HOST_REQUIRED);
    const progress = room.progress || {};
    const actingSeat = room.workflow && room.workflow.activeSeatNo != null
      ? Number(room.workflow.activeSeatNo)
      : (room.currentPlayerIndex != null ? Number(room.currentPlayerIndex) : null);
    const roundNo = room.workflow && room.workflow.roundNo != null
      ? Number(room.workflow.roundNo)
      : (room.currentRound != null ? Number(room.currentRound) : 1);
    const expectedTurnId = (room.workflow && room.workflow.turnId)
      || (actingSeat != null ? `turn_r${roundNo}_s${actingSeat}` : null);
    // 过期 progress（上一回合满分）不得放行
    const progressFresh = !!(expectedTurnId && progress.turnId && progress.turnId === expectedTurnId);
    const scored = progressFresh ? (progress.scoredCount || 0) : 0;
    // 门槛取 progress 与席位数较大值，避免 seatMap 滞后写成 required=1 误放行
    const required = Math.max(
      progressFresh ? (Number(progress.requiredScoreCount) || 0) : 0,
      Math.max(0, memberCount(room.seatMap) - 1)
    );
    if (required <= 0 || scored < required) {
      return fail(ERR.INVALID_TRANSITION, '评分未完成');
    }
    const workflow = {
      ...(room.workflow || {}),
      mode: 'PARTNER',
      step: 'STATEMENT',
      legacyPage: 'statement'
    };
    const next = {
      ...room,
      lifecycle: LIFECYCLE.ACTIVE,
      status: 'STARTED',
      currentPage: 'statement',
      brainstormProgressPage: 'statement',
      partnerMasterMode: false,
      workflow,
      revision: room.revision + 1,
      domainRevisions: {
        ...(room.domainRevisions || emptyDomainRevisions()),
        session: (room.domainRevisions && room.domainRevisions.session || 0) + 1
      },
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['session'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { startedStatement: true, legacyPage: 'statement' }
    });
  }

  if (type === COMMAND_TYPES.ADVANCE_TURN) {
    if (!isHost) return fail(ERR.HOST_REQUIRED);
    const seats = Object.keys(room.seatMap || {})
      .map((k) => parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (!seats.length) return fail(ERR.INVALID_TRANSITION, '无有效席位');
    // 以 currentPlayerIndex 为准：legacy updateRoomState 换人后 workflow.activeSeatNo 常滞后，
    // 若仍信 workflow，会「前进」到已是当前的座位，表现为结束讨论不换人。
    const fromPage = room.currentPlayerIndex != null ? Number(room.currentPlayerIndex) : NaN;
    const fromWorkflow = room.workflow && room.workflow.activeSeatNo != null
      ? Number(room.workflow.activeSeatNo)
      : NaN;
    const current = (Number.isFinite(fromPage) && fromPage > 0)
      ? fromPage
      : ((Number.isFinite(fromWorkflow) && fromWorkflow > 0) ? fromWorkflow : seats[0]);
    const idx = seats.indexOf(current);
    const nextSeat = seats[(idx >= 0 ? idx + 1 : 0) % seats.length];
    // 轮次定义：每次 ADVANCE_TURN（换到下一位玩家）都 +1
    const shouldIncrementRound = true;
    const prevRoundNo = (room.workflow && room.workflow.roundNo)
      || (room.currentRound != null ? Number(room.currentRound) : 1);
    const roundNo = prevRoundNo + (shouldIncrementRound ? 1 : 0);
    const turnId = `turn_r${roundNo}_s${nextSeat}`;
    const nextUserId = room.seatMap && room.seatMap[String(nextSeat)];
    const nextMember = nextUserId && room.membersByUserId
      ? room.membersByUserId[nextUserId]
      : null;
    const nextName = (nextMember && nextMember.nickName) || `玩家${nextSeat}`;

    let partnerRoundSummaries = Array.isArray(room.partnerRoundSummaries)
      ? room.partnerRoundSummaries.slice()
      : [];
    let partnerCurrentRoundContent = room.partnerCurrentRoundContent || null;
    let partnerRoundStartedAt = room.partnerRoundStartedAt || null;
    let currentRound = room.currentRound != null ? Number(room.currentRound) : prevRoundNo;

    const clientSummary = payload && payload.roundSummary && typeof payload.roundSummary === 'object'
      ? payload.roundSummary
      : null;
    const serverContent = room.partnerCurrentRoundContent;
    partnerRoundSummaries.push({
      round: currentRound,
      ...(clientSummary || {}),
      // 强制写入刚结束的出牌座位（覆盖客户端兜底），避免 (round-1)%n+1 误推
      playerIndex: current,
      playerName: room.currentPlayerName || `玩家${current}`,
      archivedAt: ts,
      playHistory: (clientSummary && clientSummary.playHistory)
        || (serverContent && serverContent.playHistory)
        || [],
      discussionNotes: (clientSummary && clientSummary.discussionNotes)
        || (serverContent && serverContent.discussionNotes)
        || [],
      playImages: (clientSummary && clientSummary.playImages)
        || (serverContent && serverContent.playImages)
        || [],
      discussionImages: (clientSummary && clientSummary.discussionImages)
        || (serverContent && serverContent.discussionImages)
        || [],
      playBlocks: (clientSummary && clientSummary.playBlocks)
        || (serverContent && serverContent.playBlocks)
        || [],
      discussionBlocks: (clientSummary && clientSummary.discussionBlocks)
        || (serverContent && serverContent.discussionBlocks)
        || [],
      voiceLines: (clientSummary && clientSummary.voiceLines)
        || (serverContent && serverContent.voiceLines)
        || [],
      turnRecords: (clientSummary && clientSummary.turnRecords)
        || (serverContent && serverContent.turnRecords)
        || []
    });
    partnerCurrentRoundContent = {
      playHistory: [],
      discussionNotes: [],
      playImages: [],
      discussionImages: [],
      playBlocks: [],
      discussionBlocks: [],
      images: [],
      voiceLines: [],
      turnRecords: [],
      aiSummary: { status: 'pending' }
    };
    if (shouldIncrementRound) {
      currentRound += 1;
    }

    // 每次换人（含同轮换座）都必须重开计时，否则会沿用上一玩家半程戳
    partnerRoundStartedAt = ts;
    const partnerTurnStartedAt = ts;

    const workflow = {
      ...(room.workflow || {}),
      mode: 'PARTNER',
      step: 'TURN_ACTIVE',
      activeSeatNo: nextSeat,
      roundNo,
      turnId,
      legacyPage: 'gamepage'
    };
    const progress = {
      scoredCount: 0,
      requiredScoreCount: Math.max(0, seats.length - 1),
      votedCount: 0,
      requiredVoteCount: 0,
      turnId
    };
    const next = {
      ...room,
      currentPage: 'gamepage',
      brainstormProgressPage: 'gamepage',
      currentPlayerIndex: nextSeat,
      currentPlayerName: nextName,
      currentRound,
      partnerGamePhase: 'play',
      partnerMasterMode: false,
      partnerRoundSummaries,
      partnerCurrentRoundContent,
      partnerRoundStartedAt,
      partnerTurnStartedAt,
      workflow,
      progress,
      scoresByKey: {},
      revision: room.revision + 1,
      domainRevisions: {
        ...(room.domainRevisions || emptyDomainRevisions()),
        session: (room.domainRevisions && room.domainRevisions.session || 0) + 1,
        scores: (room.domainRevisions && room.domainRevisions.scores || 0) + 1
      },
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['session', 'scores'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: {
        advancedTurn: true,
        activeSeatNo: nextSeat,
        roundNo,
        turnId,
        incrementRound: shouldIncrementRound,
        legacyPage: 'gamepage'
      }
    });
  }

  if (type === COMMAND_TYPES.LEAVE_ROOM) {
    if (isHost) {
      return fail(ERR.HOST_CANNOT_LEAVE);
    }
    const seatMap = { ...room.seatMap };
    delete seatMap[String(actorSeat)];
    const membersByUserId = { ...(room.membersByUserId || {}) };
    delete membersByUserId[actorUserId];
    const domainRevisions = {
      ...(room.domainRevisions || emptyDomainRevisions()),
      members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
    };
    const next = {
      ...room,
      seatMap,
      membersByUserId,
      domainRevisions,
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { left: true, freedSeatNo: actorSeat }
    });
  }

  if (type === COMMAND_TYPES.DISSOLVE_ROOM) {
    if (!isHost) return fail(ERR.HOST_REQUIRED);
    const next = {
      ...room,
      lifecycle: LIFECYCLE.DISSOLVED,
      status: 'DISSOLVED',
      seatMap: {},
      membersByUserId: {},
      domainRevisions: {
        ...(room.domainRevisions || emptyDomainRevisions()),
        members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
      },
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { dissolved: true }
    });
  }

  if (type === COMMAND_TYPES.REORDER_SEATS) {
    if (!isHost) return fail(ERR.HOST_REQUIRED);
    if (room.lifecycle !== LIFECYCLE.LOBBY) {
      return fail(ERR.INVALID_TRANSITION, '仅大厅可调整席位');
    }
    const order = Array.isArray(payload.userIdOrder) ? payload.userIdOrder : null;
    if (!order || !order.length) {
      return fail(ERR.INVALID_ARGUMENT, 'userIdOrder 必填');
    }
    const currentIds = Object.values(room.seatMap || {}).map(String).sort();
    const nextIds = order.map(String).sort();
    if (currentIds.length !== nextIds.length || currentIds.join(',') !== nextIds.join(',')) {
      return fail(ERR.INVALID_ARGUMENT, '席位成员集合必须一致');
    }
    if (order.length > MAX_SEATS) {
      return fail(ERR.INVALID_ARGUMENT, '席位超出上限');
    }

    const seatMap = {};
    const membersByUserId = { ...(room.membersByUserId || {}) };
    order.forEach((uid, idx) => {
      const seatNo = idx + 1;
      seatMap[String(seatNo)] = uid;
      if (membersByUserId[uid]) {
        membersByUserId[uid] = {
          ...membersByUserId[uid],
          seatNo,
          // 房主身份跟创建者，不跟座位号，避免拖拽换序把 GOD 角色转走
          role: String(uid) === String(room.hostUserId) ? 'HOST' : 'PLAYER'
        };
      }
    });
    const domainRevisions = {
      ...(room.domainRevisions || emptyDomainRevisions()),
      members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
    };
    const next = {
      ...room,
      seatMap,
      membersByUserId,
      domainRevisions,
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { reordered: true }
    });
  }

  if (type === COMMAND_TYPES.UPDATE_MEMBER_PROFILE) {
    const membersByUserId = { ...(room.membersByUserId || {}) };
    const prev = membersByUserId[actorUserId];
    if (!prev) return fail(ERR.NOT_MEMBER);
    const nextMember = { ...prev };
    if (isNonEmptyString(payload.nickName)) {
      nextMember.nickName = String(payload.nickName).trim();
    }
    if (payload.avatarUrl !== undefined) {
      nextMember.avatarUrl = payload.avatarUrl || null;
    }
    membersByUserId[actorUserId] = nextMember;
    const domainRevisions = {
      ...(room.domainRevisions || emptyDomainRevisions()),
      members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
    };
    const next = {
      ...room,
      membersByUserId,
      domainRevisions,
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { profileUpdated: true }
    });
  }

  return fail(ERR.INVALID_ARGUMENT, `未实现的命令: ${type}`);
}

module.exports = {
  executeCommand,
  buildHead,
  buildCapabilities,
  projectSnapshot,
  projectMembersDomain,
  authorizeRoomRead,
  allocateSeatNo,
  findSeatNo,
  createRoomAggregate
};
