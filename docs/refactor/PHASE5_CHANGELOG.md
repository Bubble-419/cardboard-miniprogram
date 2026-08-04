# Phase 5 落地说明（分支 `refactor/room-protocol-v2`）

## 交付

### 领域 / 云端

- Partner 命令：`SUBMIT_SCORE` / `POST_MESSAGE` / `SUBMIT_CLOSING_VOTE` / `APPEND_ARTIFACT` / `START_STATEMENT` / `ADVANCE_TURN`
- 并发事实命令不要求全局 `expectedRevision`（独立 key upsert）
- CloudBase 适配器写入独立集合：`roomScores` / `roomMessages` / `roomVotes` / `roomArtifacts`
- `getAddPlayerData` 返回 `roomState.progress`（scoredCount/totalRequired），消除独立评分轮询依赖

### 客户端

- `gamepage` 接入 App 级 `RoomSession`（800ms、`full:true`）
- **删除** gamepage 独立 3s `getGameScoreStatus` 轮询；进度从状态快照读取
- 倒计时到期 burst（350ms）改为 `session.refresh()`，不再直打 `getAddPlayerData`
- 评分提交仍走现网 `submitGameScore`（V1 兼容）；V2 可通过 `roomCommand` 调用同语义命令

### 测试

新增 `tests/room-domain/partner-facts.test.js`；全量契约测试应全绿。

## 未完成（后续 slice）

- 将 gamepage `_updateRoomState` 表态/换轮改为 `START_STATEMENT` / `ADVANCE_TURN` 派发
- 历史素材分页与 leaderboard 纯 V2 读路径

## 上传提示

若验证评分进度并入状态：重新上传 `getAddPlayerData`；试用 V2 命令再上传重建后的 `roomCommand`。
