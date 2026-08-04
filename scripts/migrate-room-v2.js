'use strict';

/**
 * V2 房间迁移脚本（dry-run 默认）
 *
 * 用法：
 *   node scripts/migrate-room-v2.js --dry-run
 *   node scripts/migrate-room-v2.js --apply   # 需在云函数/带 DB 凭证环境执行
 *
 * 本脚本在本地默认只打印计划；真正写库需注入 db（CloudBase）。
 *
 * 推荐索引（在云开发控制台手动创建）：
 * - rooms: roomId (unique), protocolVersion + updatedAt
 * - roomMembers: roomId + userId (unique), roomId + playerIndex
 * - roomCommands: TTL on createdAt (30d)
 * - roomPresence: roomId + userId, TTL on updatedAt (1d)
 * - roomScores: roomId + round + currentPlayerIndex + userId
 */

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

const INDEX_PLAN = [
  { collection: 'rooms', keys: [{ roomId: 1 }], unique: true },
  { collection: 'rooms', keys: [{ protocolVersion: 1 }, { updatedAt: -1 }] },
  { collection: 'roomMembers', keys: [{ roomId: 1 }, { userId: 1 }], unique: true },
  { collection: 'roomMembers', keys: [{ roomId: 1 }, { playerIndex: 1 }] },
  { collection: 'roomCommands', keys: [{ createdAt: 1 }], ttlSeconds: 30 * 24 * 3600 },
  { collection: 'roomPresence', keys: [{ roomId: 1 }, { userId: 1 }] },
  { collection: 'roomPresence', keys: [{ updatedAt: 1 }], ttlSeconds: 24 * 3600 },
  { collection: 'roomScores', keys: [{ roomId: 1 }, { round: 1 }, { currentPlayerIndex: 1 }, { userId: 1 }] }
];

function buildSeatMapFromMembers(members) {
  const seatMap = {};
  const issues = [];
  const bySeat = {};
  (members || []).forEach((m) => {
    const seat = m.playerIndex != null ? Number(m.playerIndex) : null;
    if (!seat || seat < 1 || seat > 6) {
      issues.push({ type: 'INVALID_SEAT', userId: m.userId, playerIndex: m.playerIndex });
      return;
    }
    if (bySeat[seat]) {
      issues.push({ type: 'DUPLICATE_SEAT', seat, users: [bySeat[seat], m.userId] });
      return;
    }
    bySeat[seat] = m.userId;
    seatMap[String(seat)] = m.userId;
  });
  if ((members || []).length > 6) {
    issues.push({ type: 'OVER_CAPACITY', count: members.length });
  }
  return { seatMap, issues };
}

function planRoomPatch(room, members) {
  if (!room || room.status === 'DISSOLVED') {
    return { skip: true, reason: 'dissolved_or_missing' };
  }
  // 不迁移活动中的旧协议房间
  const page = (room.currentPage || '').toLowerCase();
  const activeGameplay = page && page !== 'addplayer' && !room.brainstormSessionEnded;
  if (activeGameplay && Number(room.protocolVersion) !== 2) {
    return { skip: true, reason: 'active_v1_session' };
  }

  const { seatMap, issues } = buildSeatMapFromMembers(members);
  if (issues.some((i) => i.type === 'DUPLICATE_SEAT' || i.type === 'OVER_CAPACITY')) {
    return { skip: true, reason: 'needs_manual_review', issues };
  }

  return {
    skip: false,
    patch: {
      schemaVersion: 2,
      protocolVersion: room.protocolVersion === 2 ? 2 : 2,
      lifecycle: room.lifecycle || (room.status === 'STARTED' ? 'ACTIVE' : 'LOBBY'),
      hostUserId: room.hostUserId || room.creatorId,
      seatMap: room.seatMap && Object.keys(room.seatMap).length ? room.seatMap : seatMap,
      revision: room.revision != null ? room.revision : 1,
      domainRevisions: room.domainRevisions || {
        members: 1,
        session: 0,
        scores: 0,
        contributions: 0,
        artifacts: 0,
        messages: 0,
        votes: 0
      },
      updatedAt: Date.now()
    },
    issues
  };
}

function main() {
  const out = {
    mode: DRY_RUN ? 'dry-run' : 'apply',
    indexPlan: INDEX_PLAN,
    note: [
      '默认 dry-run：不连接数据库。',
      '在云函数中注入 db 后可批量对非活动房间补 V2 头字段。',
      '冲突席位/超员房间进入人工清单，不自动猜测。'
    ],
    sample: planRoomPatch(
      {
        roomId: '10000001',
        status: 'CREATED',
        creatorId: 'host',
        currentPage: 'addPlayer'
      },
      [
        { userId: 'host', playerIndex: 1 },
        { userId: 'p2', playerIndex: 2 }
      ]
    )
  };

  const outPath = path.join(__dirname, '..', 'docs', 'refactor', 'V2_INDEX_AND_MIGRATION_PLAN.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);
  if (APPLY) {
    console.error('--apply 需要在带 CloudBase db 的运行时中调用 planRoomPatch + update；本地已拒绝。');
    process.exit(2);
  }
}

module.exports = { planRoomPatch, buildSeatMapFromMembers, INDEX_PLAN };

if (require.main === module) {
  main();
}
