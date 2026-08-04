# Phase 5 落地说明（分支 `refactor/room-protocol-v2`）

## 交付

### 领域 / 云端

- Partner 命令：`SUBMIT_SCORE` / `POST_MESSAGE` / `SUBMIT_CLOSING_VOTE` / `APPEND_ARTIFACT` / `START_STATEMENT` / `ADVANCE_TURN`
- 并发事实命令不要求全局 `expectedRevision`（独立 key upsert）
- CloudBase 适配器写入独立集合：`roomScores` / `roomMessages` / `roomVotes` / `roomArtifacts`
- `getAddPlayerData` 返回 `roomState.progress`（scoredCount/totalRequired），消除独立评分轮询依赖

### 客户端（gamepage，经布局回归修复后）

**冲突根因（已修复）：**

1. 从大厅进 gamepage 时，RoomSession 因 `full/interval` 不同被 **dispose 重建**
2. `subscribe` **同步回放**当前快照 → 进页瞬间整页 `setData`
3. 微信 `scroll-view` 横向头像在布局未完成时被 `setData` 打成竖排；头像区变高后卡片 `height:100%` 链断裂，表现为空绿框 + 内容错位
4. 无 `revision` 时用 `Date.now()` 当修订号 → 每次轮询都 emit，加重抖动

**防护：**

- 同房间 `full/interval` **原地 reconfigure**，禁止 dispose 重建
- gamepage 订阅使用 `emitCurrent: false`（首屏只靠 `loadRoomData`）
- 无 revision 时归一为 `0`，不再 `Date.now()`
- 内容指纹忽略临时链 query，减少无意义 setData
- 快照含 `progress` 时关掉 3s `getGameScoreStatus`；否则回退兼容
- burst 优先 `session.refresh()`
- **旁观表达 fab**：从 `score-sheet-clip`（overflow:hidden）内挪到卡片层，随 `scoreSheetVisiblePx` 定位，避免被裁切

### 测试

`tests/room-client/session.test.js` 覆盖 emitCurrent / reconfigure / revision=0；全量契约测试应全绿。

## 未完成（后续 slice）

- 将 gamepage `_updateRoomState` 表态/换轮改为 `START_STATEMENT` / `ADVANCE_TURN` 派发
- 历史素材分页与 leaderboard 纯 V2 读路径

## 上传提示

验证评分进度并入状态：重新上传 `getAddPlayerData`；试用 V2 命令再上传重建后的 `roomCommand`。
