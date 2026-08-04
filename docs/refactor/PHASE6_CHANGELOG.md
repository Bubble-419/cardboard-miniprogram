# Phase 6 落地说明（分支 `refactor/room-protocol-v2`）

## 本 slice 交付

### 契约 / 领域 / 仓储

- Spy 命令矩阵已进 RoomKernel（分牌、看牌、发言、投票、结算、重启）
- 密牌集合 `roomSecrets`；过渡期双写 `spyAssignments`
- 词库与现网一致：`packages/room-domain/spyWordPairs.js`

### 客户端切换（本步）

- `utils/spyMode.js` 的 `callSpyAction` **改为调用 `roomCommand`**
- 兼容旧 action 名（`startAssign` / `getMyCard` / `startVote` / `submitVote` / …）
- 需 revision 的命令会先读 `getAddPlayerData.revision`
- Halli **未动**（按产品决定暂缓）

### 测试

- `tests/room-domain/spy-assign.test.js`

## 上传提示（重要）

本步改动后需 **重新上传** `roomCommand`（词库 + settled/tied 顶层字段已打进 bundle）。

客户端：预览/真机加载含新 `utils/spyMode.js` 的版本即可；`spyGameAction` 可暂留作回滚。

## 真机检查清单（Spy）

- [ ] 3 人开局分牌 → 发言页
- [ ] 各自看到自己的词
- [ ] 房主「开始投票」→ 投票页
- [ ] 全员投票 → 结果或结算
- [ ] 重启回 intro
- [ ] 头像横滑、卡片区域无空框错位
