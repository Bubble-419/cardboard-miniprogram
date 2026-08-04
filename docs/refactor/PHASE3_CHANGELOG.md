# Phase 3 落地说明（分支 `refactor/room-protocol-v2`）

## 交付

- `readHead` / `readSnapshot`：按域 revision 增量返回；members 不暴露 openid
- 云函数 `roomQuery`（action=`head`|`snapshot`）
- 云函数 `roomPresence`：心跳写入 `roomPresence`，**不增**业务 revision、不删成员
- `getAddPlayerData`：对 `protocolVersion===2` 房间不再写心跳（查询无副作用）；V1 保持兼容刷新
- 迁移 dry-run：`node scripts/migrate-room-v2.js` → `docs/refactor/V2_INDEX_AND_MIGRATION_PLAN.json`
- 契约测试覆盖：查询无副作用、域增量、非成员拒绝、heartbeat 不升 revision

## 本地命令

```bash
node --require ./scripts/test-register.js --test tests/room-contract/*.test.js tests/room-domain/*.test.js
node scripts/build-cloud-functions.js
node scripts/migrate-room-v2.js --dry-run
```

## 上传（试用 V2 读路径时）

- `roomQuery`
- `roomPresence`
- （可选）更新后的 `getAddPlayerData`
- 以及 Phase 2 的 `roomCommand`

现网页面仍走 V1 `getAddPlayerData` 轮询；RoomSession 接入在 Phase 4。

## 控制台索引

见 `V2_INDEX_AND_MIGRATION_PLAN.json` 中 `indexPlan`；需在云开发手动创建，脚本不自动建索引。
