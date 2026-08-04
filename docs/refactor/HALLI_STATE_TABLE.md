# Halli Galli 状态表（Phase 6 前置，代码实勘）

> 模式 id：`halliGalli`（UI：「德国心脏病」）。无 `packageHalli`。  
> **约束**：补齐并锁定下表缺失边之前，不要把 Halli 从 `updateRoomState` 迁入 RoomKernel。

## 现网入口

| 阶段 | 页面 | 写路径 |
| --- | --- | --- |
| 选模式 | `pages/main-pages/brainstormMode` | `roomSetBrainstormMode` → `selectedModeId=halliGalli` |
| 选情境 | `pages/main-pages/modeIndex` | `updateRoomState` → `selectBG` / `selectPlayer` |
| 填 BG | `pages/main-pages/selectBG` | `updateRoomState` → `selectPlayer` |
| 选首位 | `pages/main-pages/selectPlayer` | `updateRoomState` → `gamepage` + 当前座位 |
| 规则局中 | `pages/main-pages/halliGalli/gamepage` | Host 写 `currentPage=gamepage`；结束 → `creativeInput` + `startCreativeSession` |
| 结果页（孤立） | `playSuccess` / `playFail` | Host `handleContinue` → 下一位 `gamepage`（**无人能导航到此页**） |

## 状态转换（仅代码存在的边）

| From | Trigger | Actor | To | Notes |
| --- | --- | --- | --- | --- |
| 大厅 | `roomSetBrainstormMode` | Host | modeIndex 流程 | |
| modeIndex | `_updateRoomState` | Host | selectBG / selectPlayer | 线下可直跳 selectPlayer |
| selectBG | `updateRoomState` | Host | selectPlayer | |
| selectPlayer | `updateRoomState(gamepage)` | Host | halliGalli/gamepage | |
| gamepage | `handleEndGame` + creative session | Host | creativeInput | **唯一完整局内写路径** |
| playSuccess/Fail | `handleContinue` | Host | gamepage + next seat | 死页：无入口写入 `playsuccess`/`playfail` |

## 缺口

1. 规则文案有发牌→翻牌→抢答→表决→成败，但**无对应状态机边**。
2. `passCount` / `rooms.currentPassCount`：结果页只读，Halli 客户端未写入。
3. `addPlayer` resume 未映射结果页；卡在结果态会回落默认 gamepage。
4. 副屏 `redirectMap` 不含 playSuccess/Fail。

## 建议 RoomKernel 命令（产品确认后再实现）

| Command | 现网锚点 | 目标 |
| --- | --- | --- |
| `HALLI_START` | selectPlayer → gamepage | `HALLI_RULES` |
| `HALLI_OPEN_VOTE` | **待产品** | `HALLI_VOTE` |
| `HALLI_SUBMIT_VOTE` | **待产品**（半数、摸牌） | `HALLI_RESULT_*` |
| `HALLI_NEXT_TURN` | playSuccess/Fail continue | 下一位 / 满圈 `incrementRound` |
| `END_HALLI_SESSION` | gamepage end → creative | `CREATIVE_INPUT` |
