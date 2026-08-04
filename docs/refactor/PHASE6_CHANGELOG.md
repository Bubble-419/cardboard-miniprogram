# Phase 6 落地说明（分支 `refactor/room-protocol-v2`）

## 本 slice 交付

### 契约

- Spy 命令类型：`SPY_START_ASSIGN` / `SPY_GET_MY_CARD` / `SPY_START_SPEAK` / `SPY_ADVANCE_SPEAKER` / `SPY_SUBMIT_VOTE` / `SPY_CONFIRM_RESULT` / `SPY_NEXT_ROUND` / `SPY_CONTINUE` / `SPY_RESTART`
- 错误码：`NOT_ENOUGH_PLAYERS` / `GAME_IN_PROGRESS` / `NO_CARD` / `NO_WORD_PAIR`
- `SPY_GET_MY_CARD`、`SPY_SUBMIT_VOTE` 不要求全局 `expectedRevision`

### 领域

- `packages/room-domain/spy.js`：`SPY_START_ASSIGN`（兼容现网一步进 SPEAK）+ `SPY_GET_MY_CARD`（只读）
- 公开态 `spyGame`（结算前不含密词）；密牌 `secretsByUserId`
- 其余 Spy 命令占位，返回「未实现」

### 仓储

- CloudBase：`rooms` 写 `spyGame` + 过渡期双写 `spyAssignments`；密牌写入独立集合 `roomSecrets`
- `loadRoom` 优先读 `roomSecrets`，否则从 legacy `spyAssignments` 回填
- 应用层对 `effects.readOnly` 跳过 `persistRoom`

### 测试

- `tests/room-domain/spy-assign.test.js`

## 刻意未做

- 未切换 `packageSpy` 页面到 RoomSession / `roomCommand`（现网仍走 `spyGameAction`）
- 未实现发言/投票/结算等后续 Spy 命令
- **Halli：未迁写路径**；需先补状态表再动

## 上传提示

试用 V2 Spy 命令前：重建上传 `roomCommand`；新建集合 `roomSecrets`（权限仅云函数可读写）。
