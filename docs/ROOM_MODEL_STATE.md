# 房间协议 V3 模型与状态

> 本文描述当前权威模型、物理存储、成员 View 和状态不变量。字段定义以代码为准：[`room-contracts`](../packages/room-contracts/index.js)、[`room-domain/model.js`](../packages/room-domain/model.js)、[`room-projection`](../packages/room-projection/index.js)。

## 1. 模型分层

```mermaid
flowchart TB
  subgraph Authority[权威业务模型]
    ROOM[Room]
    SESSION[Current RoomSession]
    FACTS[Session Facts]
  end

  subgraph Sync[同步模型]
    EVENT[Event Group]
    RECEIPT[Command Receipt]
  end

  subgraph Projection[成员读模型]
    PUBLIC[Public View]
    ACTOR[Actor View]
    ROUTE[Route]
    NAV[Navigation]
    VIEW[Member View]
  end

  subgraph Ephemeral[瞬时模型]
    PRESENCE[Presence]
    SIGNAL[Signal]
    LOCAL[Local UI State]
  end

  ROOM --> PUBLIC
  SESSION --> PUBLIC
  FACTS --> PUBLIC
  ROOM --> ACTOR
  SESSION --> ACTOR
  FACTS --> ACTOR
  PUBLIC --> VIEW
  ACTOR --> VIEW
  ROUTE --> VIEW
  NAV --> VIEW
  ROOM --> EVENT
  SESSION --> EVENT
  FACTS --> EVENT
  PRESENCE -.不进入业务水位.-> VIEW
  SIGNAL -.不进入业务水位.-> VIEW
  LOCAL -.只在客户端.-> VIEW
```

核心区分：

- `Room Aggregate = Room + Current RoomSession + Current Session Facts`，只在 Command 或 Snapshot 需要时装载。
- `Member View` 是对 Aggregate 的成员级投影，不是可写回的状态。
- Event Group 是相邻投影之间的增量，不是权威事实。
- Presence、Signal 和本地 UI 状态都不能改变业务流程。

## 2. Room

```text
Room
├── roomId
├── protocolVersion / schemaVersion
├── lifecycle: OPEN | DISSOLVED
├── stateVersion
├── eventSeq
├── hostMemberId
├── workshopName
├── members[]
│   ├── memberId / userId
│   ├── seatNo
│   ├── role: HOST | PLAYER
│   └── profile
├── currentSessionId
├── sessionOrdinal
├── signalScope             # 当前 Silent 的轻量事务令牌（memberId 为房主）或 null
└── createdAt / updatedAt
```

```mermaid
stateDiagram-v2
  [*] --> OPEN: CREATE_ROOM
  OPEN --> OPEN: JOIN / PROFILE / REORDER / KICK / LEAVE
  OPEN --> OPEN: Session 开始、完成、回大厅或重玩
  OPEN --> DISSOLVED: DISSOLVE_ROOM
  DISSOLVED --> [*]
```

Room 只保存长期成员关系、同步水位和高频辅助协议所需的轻量派生令牌，不承载不断增长的场次内容。
`currentSessionId` 为 `null` 表示当前在大厅且没有活跃场次。`signalScope` 与 Session 状态在同一
Command 事务内更新，使 `roomSignal` 无需读取整个 Session，也不会在换 Turn 时写入旧信号。

### Room 不变量

```text
roomId 是 8 位数字
1 <= members.length <= 6（OPEN 房间）
每个 memberId、userId、seatNo 在 Room 内唯一
seatNo ∈ [1, 6]
hostMemberId 必须指向 role=HOST 的当前成员
stateVersion 与 eventSeq 只在接受业务 Command 时递增
currentSessionId == null 或指向同 roomId 的 RoomSession
```

## 3. RoomSession 与 Facts

```mermaid
erDiagram
  ROOM ||--o{ ROOM_SESSION : owns
  ROOM_SESSION ||--|{ PARTICIPANT : freezes
  ROOM_SESSION ||--o{ TURN : records
  ROOM_SESSION ||--o{ SCORE : records
  ROOM_SESSION ||--o{ VOTE : records
  ROOM_SESSION ||--o{ CONTRIBUTION : records
  ROOM_SESSION ||--o{ ARTIFACT : records
  ROOM_SESSION ||--o{ MESSAGE : records
  ROOM_SESSION ||--o{ SECRET : protects
```

```text
RoomSession
├── sessionId / roomId / ordinal
├── status: CONFIGURING | RUNNING | COMPLETED | CANCELLED
├── mode: PARTNER | HALLI_GALLI | SPY
├── participants[]
│   ├── memberId / userId
│   ├── seatNoAtStart
│   ├── status: ACTIVE | LEFT
│   └── 冻结展示资料
├── setup
├── workflow
│   ├── step
│   ├── revision
│   ├── roundNo
│   ├── activeMemberId
│   ├── turnId
│   └── phaseStartedAt
├── progress
├── modeState
├── result
├── startedAt / completedAt / updatedAt
└── facts
    ├── turns{}
    ├── scores{}
    ├── votes{}
    ├── contributions{}
    ├── artifacts{}
    ├── messages[]
    └── secrets{}
```

一个 `roomV3Sessions` 文档保存一个 Session 及其全部权威 Facts。运行时 Adapter 把内嵌 `facts` 拆为领域 Aggregate 的一部分，提交时再原子写回同一文档。

```mermaid
stateDiagram-v2
  [*] --> CONFIGURING: START_WORKSHOP_SESSION
  CONFIGURING --> RUNNING: 完成配置
  CONFIGURING --> CANCELLED: 取消或人数不足
  RUNNING --> COMPLETED: 模式完成
  RUNNING --> CANCELLED: 取消或人数不足
  COMPLETED --> [*]
  CANCELLED --> [*]
```

### Session 不变量

```text
一个 Room 同时最多一个 current Session
ordinal 在同一 Room 内单调递增
participants 在 Session 创建时冻结；中途加入者不会补入
成员离开只把 Participant 标为 LEFT，不删除历史事实
COMPLETED / CANCELLED Session 归档后不再修改
Facts 只能属于同一 sessionId
requiredMemberIds 只包含当前有效 Participant
submittedMemberIds 必须是 requiredMemberIds 的子集
workflow.revision 是正整数；每次阶段切换或同阶段重新进入都单调递增
单场 Partner 匿名表达最多 500 条，素材最多 1000 条
Partner 常规行动最多 200 Turn；达到上限后只能发起收尾，不能继续 Statement/Question
Session + Facts 序列化文档不得超过 6 MiB 安全预算
```

## 4. 三种模式的状态轴

```mermaid
flowchart LR
  SESSION[RoomSession]
  WF[workflow.step]
  MODE[modeState]
  PROGRESS[progress]
  FACTS[facts]
  RESULT[result]

  SESSION --> WF
  SESSION --> MODE
  SESSION --> PROGRESS
  SESSION --> FACTS
  SESSION --> RESULT
```

`workflow.step` 是页面跟随和 Command 合法性的主业务轴；`modeState` 保存该模式当前规则数据；`progress` 只保存当前 barrier 的 required/submitted 集合；长期记录进入 Facts。

### Partner

```text
modeState.partner
├── roundNo / turnOrdinal / firstMemberId
├── roundRemainingMemberIds   # 本轮尚未开始的成员；开始 Turn 时立刻出队
├── activeTurn
│   ├── turnId / activeMemberId / phase
│   ├── statementResult          # 仅部分通过/全部疑问的讨论期保存
│   ├── scoreProgress
│   ├── specialUsed / masterMode
│   └── silentStartedAt / silentDeadlineAt
└── closing
    ├── closingVoteSessionId / sourceTurnId / initiatorMemberId
    ├── requiredMemberIds / submittedMemberIds
    └── stage
```

完成的 Turn 移入 `facts.turns`；评分、素材、匿名消息和收尾票分别进入对应 Facts。“全部通过”在提交表态结果时直接归档；“部分通过/全部疑问”先把 `statementResult` 持久化到 Active Turn，讨论结束后再归档。排行榜从归档 Turn 汇总，评分次数累加每个 Turn 的 `scoredCount`，不由客户端提交。

### Halli Galli

```text
setup.proposedFirstMemberId
progress.contributionProgress
facts.contributions[HALLI_IDEA]
result.ideaCount
```

创意是公共协作事实；每次 `SUBMIT_HALLI_IDEA` 都会将已提交内容增量投影给全员。`HALLI_SUMMARY` 表示全员提交完成，不是内容首次解封点。

### Spy

```text
modeState.spy
├── gameId / roundNo
├── players[]
├── speakOrder / currentSpeakerIndex / speakerTurnId
├── voteProgress / voteStartedAt
├── tieBreak / lastResult
└── winnerSide / reveal

facts.secrets[gameId:memberId]
facts.votes[voteSessionId:memberId]
```

密牌只存在权威 Facts 和对应成员的 Actor View。`reveal` 只有在最终结算后才进入公共模式状态。

### 设计问题事实与投影

```text
facts.contributions[sessionId:DESIGN_PROBLEM:memberId]
├── contributionId / sessionId / memberId / kind
├── text / entityVersion
└── createdAt / updatedAt

MemberView.session.setup.designProblems[]
├── contributionId / memberId / text / entityVersion
└── createdAt                 # 首次提交时间，编辑时不改变
```

`createdAt` 是问题展示顺序的权威字段；`updatedAt` 只用于事实审计，不得因 Host 编辑而改变列表顺序。

## 5. Event Group

一个已接受 Command 对应一个 `roomV3Events` 文档，即一个不可拆分的 Event Group：

```text
EventGroup
├── eventSchemaVersion
├── viewSchemaVersion
├── roomId
├── seq
├── stateVersion
├── commandId
├── sessionId
├── rawEvents[]
├── publicEvents[]       # 只含 type
├── publicPatch
├── actorProjections[]
│   ├── recipientMemberId
│   └── actorPatch
└── occurredAt
```

```mermaid
flowchart LR
  RAW[rawEvents<br/>服务端审计语义]
  PUB[publicEvents<br/>type only]
  PP[publicPatch<br/>共享]
  AP[actorProjections<br/>按成员扇出]
  QUERY[roomQuery sync]
  MEMBER[调用成员]

  RAW -.禁止返回.-> QUERY
  PUB --> QUERY
  PP --> QUERY
  AP -->|只选择 recipientMemberId| QUERY
  QUERY --> MEMBER
```

### Event 不变量

```text
EventGroup.seq == 前一 EventGroup.seq + 1
EventGroup.stateVersion == 前一 stateVersion + 1
EventGroup.viewSchemaVersion == 生成 Patch 时的 Member View Schema
同一 Command 只提交一个 Event Group
publicEvents 只暴露已知 type，不带领域 payload
publicPatch 不得包含 Actor/Route/Navigation 或秘密
actorPatch 只作用于当前成员的 actor/route/navigation envelope
应用 publicPatch 再应用本人 actorPatch，结果等于同水位 Snapshot
```

```text
PublicPatch / ActorPatch
├── set[]    { path, value }
├── remove[] path
└── splice[] { path, index, deleteCount, items }
```

`splice` 用于成员、参与者、消息、素材、回合摘要等数组的局部变化，避免每个 Event
重复传输整列；三类操作中的路径仍分别受 Public 与 Actor 隐私根限制。

## 6. Member View

```text
MemberView
├── room
│   ├── roomId / lifecycle / workshopName / hostMemberId
│   └── members[]               # 不包含 userId
├── session
│   ├── sessionId / ordinal / status / mode / participants[]
│   ├── setup / workflow / progress
│   ├── publicModeState / activeTurn
│   ├── activeArtifacts / recentMessages / turnSummaries
│   └── result
├── actor
│   ├── memberId / role / seatNo / isParticipant
│   ├── contributionStatus / scoreStatus / voteStatus
│   ├── privateModeState
│   └── capabilities
├── route
    ├── name
    └── params
└── navigation
    └── back: NONE | COMMAND(commandType, context, after)
```

```mermaid
flowchart TB
  PUBLIC[Public View<br/>所有获权成员相同]
  ACTOR[Actor View<br/>本人状态与权限]
  ROUTE[Route<br/>Workflow + Actor 派生]
  NAV[Navigation<br/>成员权限 + Workflow 派生]
  VIEW[Member View]
  SNAP[Snapshot 完整替换]
  EVENT[Event publicPatch + actorPatch]
  PAGE[页面]

  PUBLIC --> VIEW
  ACTOR --> VIEW
  ROUTE --> VIEW
  NAV --> VIEW
  SNAP --> VIEW
  EVENT --> VIEW
  VIEW --> PAGE
```

View 的两种更新路径属于同一个 Interface：Snapshot 直接提供完整 View；Event 只提供从旧 View 到新 View 的安全增量。页面永远只看到发布后的完整 View。

进行中页面从冻结 `participants[]` 中只展示 `ACTIVE` 成员；`LEFT` 成员仍保留在 Member View
供历史与审计使用，历史页面和已完成场次的结算页投影全部冻结成员。

`capabilities` 是服务端投影的 UI 操作提示，不代替 Command 时的服务端授权。`route` 和
`navigation` 都是成员级展示投影，不是业务事实。页面不得写回页面名，也不得根据物理页面栈
拼后退目标；`navigation.back.context.workflowRevision` 用于阻止旧页面的 ABA 重放。

## 7. 物理集合

```mermaid
erDiagram
  ROOM_V3_ROOMS ||--o{ ROOM_V3_SESSIONS : contains
  ROOM_V3_ROOMS ||--o{ ROOM_V3_EVENTS : sequences
  ROOM_V3_ROOMS ||--o{ ROOM_V3_MESSAGES : indexes
  ROOM_V3_ROOMS ||--o{ ROOM_V3_PRESENCE : observes
  ROOM_V3_ROOMS ||--o{ ROOM_V3_SIGNALS : carries
  ROOM_V3_ROOMS ||--o{ ROOM_V3_MEDIA : owns
  ROOM_V3_ROOMS ||--o{ ROOM_V3_ACTIVE_BY_USER : references
  ROOM_V3_ROOMS ||--o{ ROOM_V3_ACTIONS : receipts
```

| 集合 | 权威内容 | 读取特征 |
|---|---|---|
| `roomV3Rooms` | Room、成员、当前 Session 引用、业务水位 | 高频 Sync 读取 |
| `roomV3Sessions` | 单个 Session + 全部 Facts | Snapshot、Command、历史回看 |
| `roomV3ActiveByUser` | 用户当前开放房间的唯一索引 | `current` 与 Command 前置检查 |
| `roomV3Actions` | Command Receipt 和请求哈希 | 幂等重放与冲突判断 |
| `roomV3Events` | 每个 Command 一个 Event Group | 高频 Sync 按 `roomId + seq` 顺序读取 |
| `roomV3Messages` | Partner 消息分页索引 | 历史分页；权威消息仍在 Session Facts |
| `roomV3Presence` | 设备在线租约 | Snapshot/最终 Sync 的 ephemeral 投影 |
| `roomV3Signals` | 三种可丢失公开信号按 `hash(roomId:signalType)` 点读；设计问题催促的成员级冷却凭证按 Session + Member 点写且不投影 | ephemeral 投影与服务端限流 |
| `roomV3Media` | 二维码等可再生文件引用 | 媒体查询 |

```mermaid
flowchart LR
  SYNC[sync] --> R[roomV3Rooms]
  SYNC -->|连续增量 1..25 条| E[roomV3Events]
  SYNC -->|积压>25 / 缺口 / 旧 Schema| S[roomV3Sessions]
  SNAPSHOT[snapshot] --> R
  SNAPSHOT --> S[roomV3Sessions]
  COMMAND[command transaction] --> R
  COMMAND --> S
  COMMAND --> E
  COMMAND --> A[roomV3Actions]
```

稳态 Sync 不重建 Actor View，也不读取 Session；Actor、Route、Navigation 变化已经在 Event
产生时扇出为 actor patch。`afterSeq == Room.eventSeq` 时只读 Room，不发起空 Event 查询；连续
积压为 1～25 条时读取 Event；积压超过 25 条、缺口或版本不兼容时读取一次 Aggregate，并在同一
响应内交付最新 Snapshot。房间资料等不改变 Session 的 Command 也不会重写 Session/Facts 或所有
未变化的 `ActiveByUser` 索引。

## 8. 业务状态与瞬时状态

| 数据 | 改变 `stateVersion/eventSeq` | 进入稳定 View | 来源 |
|---|:---:|:---:|---|
| Room / Session / Facts | 是 | 是 | Command 事务 |
| Public / Actor / Route / Navigation Patch | 跟随 Command | 是 | Event Group |
| Presence | 否 | 否，进入 `ephemeral` | 任意房间请求顺带续租 |
| Signal | 否 | 否，进入 `ephemeral` | `roomSignal` |
| 服务端时钟偏差 | 否 | 否，RoomClient 元数据 | 响应 `serverTime` |
| 输入草稿、焦点、滚动、Swiper | 否 | 否 | 客户端本地；需恢复的草稿按房间/场次/Turn 隔离 |

Presence 使用 `roomId + memberId + deviceSessionId` 标识设备租约。设备离线不会删除 Member；离房、被踢或房间解散后，旧租约即使尚未清理，也必须被成员投影过滤。

`ephemeral.stale.presence/signals` 分别表示对应读取通道暂时不可用。客户端在 stale 时保留上次
成功值；只有通道读取成功后，空集合才表示当前确实没有在线租约或有效信号。

## 9. 原子提交与幂等

```mermaid
sequenceDiagram
  participant C as Client
  participant T as Transaction
  participant A as roomV3Actions
  participant S as Room + Session
  participant E as roomV3Events

  C->>T: commandId + request
  T->>A: 查 scopeKey:commandId
  alt 同一请求已提交
    A-->>C: 原 Receipt
  else commandId 被不同请求复用
    A-->>C: COMMAND_ID_CONFLICT
  else 新请求
    T->>T: 读取最新 Aggregate 并执行 Reducer
    T->>S: 写权威状态
    T->>E: 写一个 Event Group
    T->>A: 写 Receipt
    T-->>C: 原子提交结果
  end
```

`knownSeq` 不参与业务写入的 compare-and-set。客户端重复发送同一 Command 必须复用相同 `commandId`；服务端用请求哈希判断这是安全重放还是冲突。

## 10. 恢复不变量

```mermaid
flowchart TD
  INPUT[Sync Batch]
  VERSION{版本匹配?}
  SEQ{seq 连续?}
  STATE{stateVersion 连续?}
  WATERMARK{throughSeq/roomCurrentSeq/hasMore 一致?}
  APPLY[应用到 staging View]
  MORE{hasMore?}
  PUBLISH[一次发布完整 View]
  RESET[丢弃 staging，读取 Snapshot]

  INPUT --> VERSION
  VERSION -->|否| RESET
  VERSION -->|是| SEQ
  SEQ -->|否| RESET
  SEQ -->|是| STATE
  STATE -->|否| RESET
  STATE -->|是| WATERMARK
  WATERMARK -->|否| RESET
  WATERMARK -->|是| APPLY --> MORE
  MORE -->|是| INPUT
  MORE -->|否| PUBLISH
```

多批追赶期间只更新 staging View；只有追到 `roomCurrentSeq` 才发布，页面不会看到半个 Command 或未追平的中间 View。
