# 房间系统文档索引

> 当前实现：房间协议 V3；仓库代码已完成，目标环境发布状态不由本文推断。

## 阅读地图

```mermaid
flowchart TD
  I[ROOM_SYSTEM_INDEX<br/>从这里开始]
  IMPL[ROOM_PROTOCOL_V3_IMPLEMENTATION<br/>当前架构/状态机/完整业务]
  PLAN[ROOM_PROTOCOL_V3_REFACTOR_PLAN<br/>协议规格/命令/View/验收]
  DEPLOY[ROOM_PROTOCOL_V3_DEPLOYMENT<br/>集合/索引/权限/发布]
  ADR[ADR-0001<br/>架构决策]
  CTX[refactor/CONTEXT<br/>领域术语]
  OLD1[ROOM_BUSINESS_FLOWS<br/>重构前业务基线]
  OLD2[ROOM_MODEL_STATE<br/>重构前数据基线]
  OLD3[ROOM_SYNC_PROTOCOL<br/>重构前协议基线]

  I --> IMPL
  I --> PLAN
  I --> DEPLOY
  IMPL --> ADR
  IMPL --> CTX
  PLAN --> OLD1
  PLAN --> OLD2
  PLAN --> OLD3
```

| 文档 | 用途 | 状态 |
|---|---|---|
| [协议 V3 实现说明](./ROOM_PROTOCOL_V3_IMPLEMENTATION.md) | 当前运行架构、三模式状态机、View、恢复与代码入口 | 当前 |
| [协议 V3 完整规格与计划](./ROOM_PROTOCOL_V3_REFACTOR_PLAN.md) | 不变量、Command/Event/View Schema、阶段与测试矩阵 | 已实现 |
| [部署与验收清单](./ROOM_PROTOCOL_V3_DEPLOYMENT.md) | 新集合、索引、权限、发布顺序和真机矩阵 | 待目标环境执行 |
| [ADR-0001](./adr/0001-room-snapshot-event-protocol.md) | Snapshot + 短期有序 Event 的决策 | Accepted |
| [领域术语](./refactor/CONTEXT.md) | Room、Session、Participant、Turn、Artifact 等 | 当前 |
| [重构前业务流程](./ROOM_BUSINESS_FLOWS.md) | 功能反查与防遗漏基线 | 历史 |
| [重构前模型状态](./ROOM_MODEL_STATE.md) | legacy 状态/集合问题追溯 | 历史 |
| [重构前同步协议](./ROOM_SYNC_PROTOCOL.md) | legacy 轮询/一致性问题追溯 | 历史 |

## 当前系统一图

```mermaid
flowchart LR
  UI[所有业务页面] --> RC[App 级 RoomClient]
  RC -->|Command| C[roomCommand]
  RC -->|current/snapshot/sync/history| Q[roomQuery]
  RC -->|heartbeat| P[roomPresence]
  C --> APP[Room Application]
  Q --> APP
  P --> APP
  APP --> DOM[Room/Partner/Halli/Spy Reducer]
  APP --> PROJ[Member View Projector]
  APP --> REPO[CloudBase Transaction Repository]
  REPO --> DB[(roomV3*)]
  PROJ --> RC
  RC --> NAV[Workflow + Actor Route]
  NAV --> UI
```

## 核心代码索引

| 范围 | 入口 |
|---|---|
| 协议与运行时校验 | [`packages/room-contracts/index.js`](../packages/room-contracts/index.js) |
| Room 公共领域 | [`packages/room-domain/index.js`](../packages/room-domain/index.js) |
| Partner / Halli / Spy | [`packages/room-domain/partner.js`](../packages/room-domain/partner.js)、[`halli.js`](../packages/room-domain/halli.js)、[`spy.js`](../packages/room-domain/spy.js) |
| View/Event/Route/Capability 投影 | [`packages/room-projection/index.js`](../packages/room-projection/index.js) |
| Command/Snapshot/Sync 应用层 | [`packages/room-application/index.js`](../packages/room-application/index.js) |
| CloudBase Adapter | [`packages/room-cloudbase-adapter/index.js`](../packages/room-cloudbase-adapter/index.js) |
| 客户端状态机 | [`packages/room-client/index.js`](../packages/room-client/index.js) |
| 小程序接线 | [`modules/room-session/index.js`](../modules/room-session/index.js)、[`page-model.js`](../modules/room-session/page-model.js) |
| 导航 | [`modules/room-navigation/index.js`](../modules/room-navigation/index.js) |
| 云函数薄入口 | [`cloudfunctions/roomCommand/src/entry.js`](../cloudfunctions/roomCommand/src/entry.js)、[`roomQuery/src/entry.js`](../cloudfunctions/roomQuery/src/entry.js) |
| 自动化门禁 | [`tests/room-contract/no-legacy-room-api.test.js`](../tests/room-contract/no-legacy-room-api.test.js) |

## 版本边界

```text
protocolVersion = 3
schemaVersion = 3
viewSchemaVersion = 1
eventSchemaVersion = 1
```

```mermaid
flowchart LR
  LEGACY[(旧 rooms / roomMembers / ...)] -.不读/不写/不迁移.-> V3
  V3[V3 客户端与云函数] --> NEW[(roomV3*)]
```
