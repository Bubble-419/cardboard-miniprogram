# Phase 5 落地说明（分支 `refactor/room-protocol-v2`）

## 交付

### 领域 / 云端

- Partner 命令：`SUBMIT_SCORE` / `POST_MESSAGE` / `SUBMIT_CLOSING_VOTE` / `APPEND_ARTIFACT` / `START_STATEMENT` / `ADVANCE_TURN`
- `START_STATEMENT` / `ADVANCE_TURN` 双写 legacy：`currentPage` / `currentPlayerIndex` / `partnerGamePhase` / 满圈纪要归档
- 并发事实命令不要求全局 `expectedRevision`（独立 key upsert）
- CloudBase 适配器写入独立集合：`roomScores` / `roomMessages` / `roomVotes` / `roomArtifacts`
- `getAddPlayerData` 返回 `roomState.progress`

### 客户端（gamepage）

- 读：RoomSession（`emitCurrent:false`、同房 reconfigure）
- 写：`handleStartStatement` / `handleEndDiscussion` 优先 `roomCommand`，失败回退 `updateRoomState`
- 布局防护同前（勿 dispose 重建、勿进页同步回放）

## 未完成（后续）

- 历史素材分页与 leaderboard 纯 V2 读路径
- 计时 / 收官等其余 `_updateRoomState` 调用逐步迁出

## 上传提示

试用表态/换轮 V2：重新上传 `roomCommand`。小程序端拉最新 gamepage 代码。
