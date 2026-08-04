# Phase 0 / 1 落地说明（分支 `refactor/room-protocol-v2`）

## 已完成

### Phase 0
- 重构文档入库：`docs/refactor/`
- 冻结规则写入 `docs/refactor/README.md`

### Phase 1 P0 止血

| 项 | 改动 |
| --- | --- |
| 加入房间 | `roomJoin` 事务分配席位 1～6，满员返回 `ROOM_FULL`，不再用 `length+1` |
| Presence | `getAddPlayerData` 不再删除超时成员；仅刷新本人心跳；响应带 `online` / `lastSeenAt` |
| 鉴权 | `submitGameScore` / `clearRoomScores` / `roomStartWorkshop` / `getGameScoreStatus` / `getLeaderboard` 统一成员或房主校验 |
| 评分并发 | `submitGameScore` 事务内 upsert |
| 收尾投票并发 | `submitClosingVote` 事务内重读后写入 |
| 匿名表达并发 | `postPartnerExpress` 使用 `_.push` 原子追加 |
| 导航 | `confirmFirstPlayer` / `selectPlayer` / `selectBG` / `modeIndex`：`updateRoomState` 成功后才跳转 |
| 轮询 | gamepage 状态轮询单飞 + 响应序号，丢弃乱序响应 |
| setData | gamepage 去掉 250ms Page 级倒计时 `setData`（字段未绑定 WXML） |

## 部署注意

以下云函数需重新上传后才生效：

- `roomJoin`
- `getAddPlayerData`
- `submitGameScore`（含 `roomAuth.js`）
- `clearRoomScores`（含 `roomAuth.js`）
- `roomStartWorkshop`（含 `roomAuth.js`）
- `getGameScoreStatus`（含 `roomAuth.js`）
- `getLeaderboard`（含 `roomAuth.js`）
- `submitClosingVote`
- `postPartnerExpress`
- `finalizePartnerTurnRecord`

共享源码在 `cloudfunctions/common/roomAuth.js`；各函数目录内有部署用副本。

## 未纳入本阶段（后续 Phase）

- 替换 `updateRoomState` 为 RoomKernel / `roomCommand`
- head/snapshot 与 App 级 RoomSession
- Partner 独立事实集合与成本压到 12k/房间小时
- PageShell / gamepage 组件化 / WebSocket
