# 房间协议 V3 实现说明

> 状态：仓库实现完成；云端资源与真机发布按 [部署清单](./ROOM_PROTOCOL_V3_DEPLOYMENT.md) 执行。
>
> 数据边界：只读写 `roomV3*` 新集合，不迁移、不双读、不双写旧房间数据。

## 0. V3 协议原则

### 0.1 权威状态、指令与投影

```mermaid
flowchart LR
  INTENT[Command<br/>成员意图]
  TX[事务内裁决]
  STATE[权威 Room Aggregate]
  RECEIPT[Command Receipt]
  GROUP[有序 Event Group]
  SNAPSHOT[Snapshot Projector]
  PATCH[Public Patch + Actor Patch]
  VIEW[完整 Member View]

  INTENT --> TX
  TX --> STATE
  TX --> RECEIPT
  TX --> GROUP
  STATE --> SNAPSHOT --> VIEW
  GROUP --> PATCH --> VIEW
```

V3 遵循以下不可拆分的原则：

1. **服务端权威**：Room、当前 Session 和 Facts 是唯一业务事实源。客户端只提交意图，不提交最终状态、身份或权限结论。
2. **Command 原子化**：每个已接受 Command 在同一事务内提交 State、一个 Event Group 和 Command Receipt；失败不得留下部分结果。
3. **精确上下文**：并发冲突通过 `modeSelectionRevision`、`sessionId`、`turnId`、`workflowStep`、`workflowRevision`、`voteSessionId` 等领域令牌识别；`knownSeq` 只用于同步，不用于业务裁决。
   Room 级模式选择使用 `modeSelectionRevision`，开始选择、取消选择和创建场次均校验该令牌；
   每次进出选择提升令牌，防止旧选择页的延迟命令影响新一轮选择。
4. **事件只负责同步**：Event 是有保留期的有序同步日志，不是从创世事件重建服务端状态的完整事件溯源。Event 不可用时直接恢复 Snapshot。
5. **View 是成员投影**：页面只消费由服务端为当前成员投影的完整 `Member View`，不得读取 Aggregate、Raw Event 或其他成员的 Actor 投影。
6. **Snapshot 与 Event 等价**：同一个 `Member View` 必须既能由 Snapshot 完整替换，也能由前一 View 顺序应用 Event Patch 得到；页面不能根据来源执行不同业务逻辑。
7. **隐私在投影前收口**：公共补丁可以共享，Actor 补丁在 Command 提交时按成员扇出；查询只返回调用成员自己的补丁。Spy 秘密不得进入公共 View 或公共 Event。
8. **不可信就重置**：事件缺口、版本不兼容、状态版本不连续、矛盾水位或无进展批次都必须丢弃 staging View 并读取 Snapshot，禁止客户端猜测修补。
9. **业务与瞬时状态分离**：Presence、Signal 和本地输入状态不改变 `stateVersion/eventSeq`，也不能决定成员资格或业务流程。
10. **单一客户端连接**：房间页面共享一个 `RoomClient`、一条 `roomCommand/roomQuery` 串行请求队列和一个最短 2 秒轮询器；页面不得再创建业务轮询或第二份房间状态。自动 Sync 从前一请求结束后重新计算完整静默窗口，不能与 Command 并发或在 Command 后紧接着补发。

### 0.2 View 必须同时支持 Snapshot 与 Event

```mermaid
flowchart TB
  AGG[Aggregate @ N]
  SP[projectMemberView]
  FULL[Snapshot<br/>view + seq + stateVersion]
  OLD[Member View @ N-1]
  PUB[apply publicPatch]
  ACT[apply 当前成员 actorPatch]
  NEXT[Member View @ N]
  PAGE[Page Model / Route / UI]

  AGG --> SP --> FULL --> NEXT
  OLD --> PUB --> ACT --> NEXT
  NEXT --> PAGE
```

两条更新路径共享同一个 View Schema：

| 路径 | 输入 | 客户端动作 | 使用时机 |
|---|---|---|---|
| Snapshot | `view + seq + stateVersion + ephemeral` | 校验完整结构后整体替换稳定 View | 首次打开、前后台恢复、缺口或异常恢复 |
| Event | `publicPatch + actorPatch + seq + stateVersion` | 在 staging View 依次应用公共补丁和本人补丁，追平后一次发布 | 正常轮询、Command Response 携带 SyncBatch |

`sync` 是无兼容分支的判别联合：`delivery=EVENTS` 最多交付 25 条连续 Event；积压超过 25 条、
事件缺口、旧 View Schema 或单事件超出字节预算时，服务端改为 `delivery=SNAPSHOT` 并在同一响应
内携带最新完整 Snapshot。客户端不再为这种情况追加第二次云函数请求。

必须始终满足：

```text
SnapshotView(M)
  == reduceProjectedEvents(SnapshotView(N), EventGroups[N+1...M])

Event.seq == previousSeq + 1
Event.stateVersion == previousStateVersion + 1
!hasMore => throughSeq == roomCurrentSeq
```

`projectMemberView(Aggregate)` 生成 Snapshot。Event Group 则由 Command 提交前后的同一投影结果做差生成：

```mermaid
sequenceDiagram
  participant A as Application
  participant P as Projector
  participant E as Event Group
  participant C as RoomClient

  A->>P: projectPublicView(before / after)
  P-->>A: publicPatch
  A->>P: projectActorEnvelope(before / after, each member)
  P-->>A: actorProjections[]
  A->>E: 保存 rawEvents + publicPatch + actorProjections
  E-->>C: publicEvents(type only) + publicPatch + 本人 actorPatch
  C->>C: publicPatch → actorPatch → 完整性检查
  C->>C: 追平后发布 Member View
```

合并各自升级过 View Schema 的分支时，不能取两侧较大的版本号就沿用：若组合后的结构或语义
不同于任一已使用版本，需分配更高的新版本，再重新构建云函数，避免同版本表示不同投影契约。

新增或修改任何 View 字段时，必须同时验证：

- Snapshot projector 可以独立产生该字段；
- public/actor patch 把该字段放在正确的隐私层；
- Event reducer 可以从旧 View 得到与新 Snapshot 完全相同的结果；
- 缺口恢复不会把旧 staging View 与新 Snapshot 混用；
- 页面只依赖最终 `Member View`，不感知本次更新来自 Snapshot 还是 Event。

对应自动化契约位于 [`tests/room-client/v3-client.test.js`](../tests/room-client/v3-client.test.js)，覆盖公共状态、Actor 状态、跨配置流程、Partner 换轮、Spy 私密牌、分批追赶以及异常回退。四种模式从配置到完成的 Snapshot/Event 等价验收位于 [`tests/room-domain/v3-business-flow-e2e.test.js`](../tests/room-domain/v3-business-flow-e2e.test.js)。

### 0.3 请求内部的局部并行

客户端 Command/Query 队列及同一 CloudBase 事务仍串行；只在请求内部重叠无依赖的事务外 I/O。
并行编排封装在 Application / 媒体入口，不增加页面队列、协议字段或通用任务调度层。

```mermaid
flowchart LR
  TX[Command 原子提交] --> P[Presence 续租]
  TX --> S[内联投影 / 同步读取]
  P --> J[等待全部完成]
  S --> J
  J --> R[返回 Outcome + Snapshot / Sync]
```

| 路径 | 并行任务 | 不可拆分的先后关系 |
|---|---|---|
| Command 提交后 | Presence 与响应同步准备 | 先提交 State/Event/Receipt；Sync/Snapshot 借用同一续租，重新授权后仅合并同 room/member 的结果 |
| History / Messages | 分页读取与 Presence | 先授权、校验参数；History 只读 Room 授权，Messages 保留 Session 与归档参与者授权 |
| 二维码入口 | Room 成员授权与缓存预读 | 非法参数先拒绝；授权成功前不能生成、上传、签名或返回缓存；授权错误优先 |
| 二维码上传后 | 缓存持久化与临时 URL | 生成 → 上传保持串行；全部完成后返回，写入错误优先，不遗留后台写入 |

分页和媒体使用 `allSettled` 收口，即使另一项失败也等待必要写入结束。Presence 失败仍只影响在线
提示；附带同步失败仍不改变已提交 Command 的结果。借用续租需校验新读取的成员身份，旧 Receipt
的 memberId 不得进入离房重入后的 Snapshot。核心 Room 水位 → Event 查询、权限 → 私有文件白名单
→ URL 签名保持串行。该优化不改变稳定 Member View Schema。

可控延迟、相反完成顺序、失败等待、权限隔离与旧成员作用域测试见
[`v3-application-parallel.test.js`](../tests/room-domain/v3-application-parallel.test.js) 和
[`v3-room-media-entry.test.js`](../tests/room-contract/v3-room-media-entry.test.js)。

## 1. 最终运行拓扑

```mermaid
flowchart LR
  subgraph MiniProgram[微信小程序]
    PAGE[业务页面]
    PM[Page Model<br/>现有 WXML 适配]
    RC[RoomClient<br/>唯一房间连接]
    VR[View Reducer]
    NAV[Route Projector]
    GW[Cloud Gateway]
    PAGE --> PM --> RC
    RC --> VR
    RC --> NAV
    RC --> GW
  end

  subgraph CloudFunctions[云函数]
    CMD[roomCommand]
    QUERY[roomQuery]
    SIG[roomSignal]
    MEDIA[roomMedia]
    STT[speechToText]
    APP[Room Application]
    DOM[纯 Domain Reducer]
    PROJ[MemberView Projector]
    REPO[CloudBase Repository]
    CMD --> APP
    QUERY --> APP
    SIG --> APP
    MEDIA --> APP
    STT --> APP
    APP --> DOM
    APP --> PROJ
    APP --> REPO
  end

  GW --> CMD
  GW --> QUERY
  PAGE -.瞬时声音/催促/二维码.-> SIG
  PAGE -.二维码.-> MEDIA
  PAGE -.当前 Turn 语音.-> STT
  REPO --> DB[(roomV3* Collections)]
```

## 2. 单一事实与投影

```mermaid
flowchart TB
  subgraph Authority[权威业务事实]
    ROOM[Room]
    SESSION[Current Session]
    FACTS[Turn / Score / Vote<br/>Contribution / Artifact / Message]
    SECRET[Spy Secret]
  end

  ROOM --> PUB[Public View]
  SESSION --> PUB
  FACTS --> PUB
  SECRET -->|只取调用者本人| ACTOR[Actor View]
  ROOM --> ACTOR
  SESSION --> ACTOR
  PUB --> MEMBER[Member View]
  ACTOR --> MEMBER
  MEMBER --> ROUTE[Route]
  MEMBER --> CAP[Capabilities]
  MEMBER --> PAGE[完整页面状态]

  PRESENCE[Presence / Signal] -->|ephemeral，不推进 seq| PAGE
  LOCAL[输入草稿 / 焦点 / swiper / 倒计时显示] -->|仅本地| PAGE
```

`Member View` 的稳定骨架：

```text
view
├── room { roomId, lifecycle, hostMemberId, workshopName, modeSelectionRevision, members[] }
├── session
│   ├── { sessionId, ordinal, status, mode, participants[] }
│   ├── setup { scenarioSource, scenario, selectedProblem, designProblems[], proposedFirstMemberId }
│   ├── workflow { step, revision, roundNo, activeMemberId, turnId, phaseStartedAt }
│   ├── progress / publicModeState / activeTurn
│   └── result / recentMessages / activeArtifacts / turnSummaries
├── actor
│   ├── { memberId, role, seatNo, isParticipant }
│   ├── contributionStatus / scoreStatus / voteStatus
│   ├── privateModeState  # 仅本人 Spy 牌
│   └── capabilities      # 每种 Command 的 allowed/reason
├── route { name, params }
└── navigation.back
    ├── { kind: NONE }
    └── { kind: COMMAND, commandType, context, after }
```

物理存储保持三个清晰边界：

```mermaid
flowchart LR
  R[(roomV3Rooms<br/>成员/Host/水位/currentSessionId)]
  S[(roomV3Sessions/sessionId<br/>Session + 当前场次全部 Facts)]
  E[(roomV3Events/roomId_seq<br/>Raw + PublicPatch + ActorProjections)]
  R -->|currentSessionId| S
  R -->|eventSeq| E
  E -->|查询时白名单投影| OUT[PublicEvents + PublicPatch<br/>+ 当前成员 ActorPatch]
```

高频 `sync` 先点读 `roomV3Rooms` 固定水位：客户端已追平时不再执行空的 Event 查询；
有增量时才按 `roomId + seq` 读取 `roomV3Events`。Snapshot 和 Command 才读取当前
`roomV3Sessions`。增量交付最多包含 25 个 Event Group，并受 512 KiB 响应预算约束；积压超过
25 条、单个事件超过预算或日志不连续时，不读取或不返回将被丢弃的 Event，改为在同一 Sync
响应内交付最新 Snapshot。`roomV3Messages` 只是历史分页索引，权威消息仍属于 Session Facts。

## 3. Command 原子提交

```mermaid
sequenceDiagram
  autonumber
  actor U as 成员
  participant C as RoomClient
  participant F as roomCommand
  participant A as Application
  participant T as CloudBase Transaction
  participant D as Domain Reducer
  participant P as Projector

  U->>C: dispatch(type, context, payload)
  C->>F: protocolVersion + commandId + knownSeq
  F->>A: actorUserId 只取云函数上下文
  A->>T: transactCommand
  T->>T: 查 Receipt / Aggregate<br/>Create/Join 才查 ActiveRoom
  T->>D: 最新 Aggregate + Command
  D-->>T: Next Aggregate + Domain Events + Dirty Facts
  T->>P: Before/After Public View + Actor View
  P-->>T: publicPatch + 每成员 actorPatch
  T->>T: Room + Session/Facts + Event Group + Receipt
  T-->>A: 原子提交结果 + 事务内 Event
  A-->>C: Outcome + SyncBatch
  C->>C: 顺序应用 publicPatch + 本人 actorPatch
  C-->>U: 发布新 View
```

`roomCommand` 在模块初始化阶段预热 `wx-server-sdk`、Repository 和 Application，缩短首次业务处理的关键路径；初始化异常会被捕获并在 `exports.main` 返回结构化 `{ ok: false, errCode, errMsg }`，不会因为预热重新退化为未捕获的 `cloud.callFunction:fail errCode: -504002`。数据库 `TransactionBusy`（`-501001`）标记为 `retryable`。

`roomV3ActiveByUser` 只参与 `CREATE_ROOM/JOIN_ROOM` 的“是否已在其他开放房间”裁决。
普通业务 Command 直接以目标 Room Aggregate 校验成员资格，不读 Active 索引；
Join 的 Active Room 与目标 Room 相同时复用已读文档，不在同一事务内重复点读。
Create 候选房号已读为不存在时，不重复加载空 Aggregate。已接受的离房/解散跳过 Presence 续租。

每个调用在云函数日志输出一条 `[roomCommand:perf]` 结构化记录，包含
`transactionMs/presenceMs/syncMs/totalMs`、`syncSource`、重放标志与脱敏 `commandIdHash`。
Presence 与同步阶段可以重叠，阶段耗时不能相加当作总耗时；性能结论以 `totalMs` 及客户端 P50/P95 为准。
观测回调失败不得改变 Command 成功或失败语义，日志中不记录 Payload 或 OpenID。

对会跨步骤复用同一 `turnId` 的写操作，Envelope 额外冻结 `workflowStep`：

```mermaid
flowchart LR
  UI[用户开始输入/录音] --> TOKEN[sessionId + turnId + workflowStep]
  TOKEN --> CMD[Artifact / Message Command]
  CMD --> CHECK{仍是同一工作流步骤?}
  CHECK -->|是| COMMIT[写入对应阶段]
  CHECK -->|否| STALE[STALE_CONTEXT<br/>禁止落入下一阶段]
```

配置阶段还使用单调递增的 `workflow.revision` 防止 ABA：即使页面从 A 进入 B 又回到 A，旧 A
页面捕获的 Command 也会因 revision 过期而返回 `STALE_CONTEXT`，不能覆盖新的 A。所有阶段切换，
包括同一 `step` 的重新进入，都必须通过 Domain 的 `transitionWorkflow` 推进 revision。

```mermaid
sequenceDiagram
  participant UI as 旧页面 A@revision=2
  participant D as Domain
  participant V as 新 View
  UI->>D: Command(context revision=2)
  D->>V: A→B→A，当前 revision=4
  D-->>UI: STALE_CONTEXT
  V-->>UI: Snapshot/Event 投影 A@revision=4
```

```mermaid
flowchart TD
  IN[Command] --> SCHEMA{结构/版本/白名单合法?}
  SCHEMA -- 否 --> REJECT[拒绝，不写业务事实]
  SCHEMA -- 是 --> RECEIPT{commandId 已存在?}
  RECEIPT -- 同请求 --> REPLAY[返回原 Receipt]
  RECEIPT -- 不同请求 --> CONFLICT[COMMAND_ID_CONFLICT]
  RECEIPT -- 否 --> CTX{权限/步骤/上下文令牌有效?}
  CTX -- 否 --> REJECT
  CTX -- 是 --> REDUCE[纯 Reducer]
  REDUCE --> COMMIT[原子提交]
  COMMIT --> STATE[Room + 单文档 Session/Facts]
  COMMIT --> EVENTS[单 Command Event Group]
  COMMIT --> NEWRECEIPT[Receipt]
```

## 4. Snapshot + Event 同步

创建/加入成功的 Command 直接附带 `snapshot`：首次执行从已提交事务返回的 Aggregate 做同一
Member View 投影，不再追加一次数据库读事务和客户端 Query。Receipt 只保存 outcome，不缓存
私有 View；重放创建/加入时重新授权并读取最新 Snapshot。客户端验证版本、成员 View 以及
`snapshot.seq >= outcome.committedThroughSeq` 后走统一安装路径；附带快照不可用时普通权威恢复，
不能把已提交的 Command 伪装成写失败。该优化不改变 Member View Schema。

```mermaid
flowchart LR
  CMD[CREATE / JOIN] --> TX[事务提交 State + Event + Receipt]
  TX --> P[复用已提交 Aggregate<br/>按调用成员投影 Snapshot]
  P --> C[Command Response + snapshot]
  C --> V[统一安装 Member View]
  V --> S[静默 2 秒后<br/>sync afterSeq = snapshot.seq]
```

内联 Snapshot 不为 Presence/Signal 增加查询，显式携带 `stale`，下一次正常 Sync 刷新瞬时态。
其 `minAvailableSeq` 使用本次新提交 Event 的保守可用下界，不代表已查询最早日志。
连接恢复只合并同一前台周期的请求；`pause/close` 提升连接世代，作废旧排队任务和在途读响应。
`current → Snapshot` 握手、每批 Sync、缺口回退及错误处理均在异步返回后再次校验世代；旧响应
不得安装 View、发布旧 Route/错误、校准时钟或继续握手。随后的 `resume` 串行读取新 Snapshot。
Command 不因前后台切换被取消：保留原回执、重试 ID 和已提交的创建/加入/离房结果；仅丢弃
旧世代附带的 Snapshot/Sync，恢复前台后按已确认房间归属读取当前 Snapshot。
普通 `App.onShow` 可能携带当前业务页的 `roomId`，不代表新的入房意图：复用原 RoomSession
及其页内屏幕订阅，只执行 `resume → Snapshot`。扫码闸门只接受首页/大厅入房入口；已有连接
的同一房间不重新建立闸门，进入另一房间时仍由入房流程保护与重建连接。

```mermaid
sequenceDiagram
  participant C as RoomClient
  participant Q as roomQuery
  participant DB as CloudBase

  C->>Q: current
  Q-->>C: roomId / null
  C->>Q: snapshot(roomId)
  Q->>DB: 同一事务读取 Room + 当前 Session 文档
  DB-->>Q: Aggregate@N
  Q-->>C: Snapshot(view, seq=N, stateVersion, ephemeral)

  loop 单一短轮询计时器
    Note over C: 前一 Command/Query 完成后静默 2 秒<br/>期间有新请求则废弃旧 timer 并重新计时
    C->>Q: sync(afterSeq=N)
    Q->>DB: 点读 Room，固定 roomCurrentSeq
    alt afterSeq 已追平
      DB-->>Q: 不查询 Event
      Q-->>C: delivery=EVENTS, events=[]
    else 增量为 1..25 条且连续
      Q->>DB: 查询 afterSeq < seq <= roomCurrentSeq
      Q-->>C: delivery=EVENTS, events(N+1...M)
    else 积压>25 / 缺口 / 旧 Schema / 超预算
      Q->>DB: 读取最新 Aggregate@M
      Q-->>C: delivery=SNAPSHOT, Snapshot@M
    end
    alt EVENTS 连续、完整且已追平
      C->>C: staging 应用后一次发布
      Q-->>C: 最后一批 + ephemeral
    else EVENTS hasMore
      C->>Q: sync(afterSeq=throughSeq)
    else SNAPSHOT
      C->>C: 原子替换 View 与 seq
    end
  end
```

```mermaid
stateDiagram-v2
  [*] --> IDLE
  IDLE --> OPENING: open
  OPENING --> READY: current + Snapshot
  OPENING --> DEGRADED: 网络/依赖失败
  READY --> SYNCING: timer / Command Response
  SYNCING --> READY: delivery=SNAPSHOT
  SYNCING --> CATCHING_UP: hasMore
  CATCHING_UP --> CATCHING_UP: 下一完整批
  CATCHING_UP --> READY: 追平并发布
  SYNCING --> RECOVERING: gap / schema / watermark
  RECOVERING --> READY: Snapshot
  SYNCING --> DEGRADED: 可恢复失败
  DEGRADED --> RECOVERING: 无有效 View，指数退避 Snapshot
  DEGRADED --> SYNCING: 仍有有效 View，指数退避 Sync
  OPENING --> DISCONNECTED: 非成员/解散/不存在
  RECOVERING --> DISCONNECTED: 非成员/解散/不存在
  READY --> CLOSED: close
```

同步约束：

```text
Snapshot.seq == Aggregate.room.eventSeq
Event.seq == 前一 seq + 1
每个 Event 文档对应一个 commandId，stateVersion == 前一状态版本 + 1
Event.viewSchemaVersion == 当前 Member View Schema
Event.publicPatch 只修改公开 View；Event.actorPatch 只修改当前成员 Actor/Route/Navigation
服务端存储 rawEvents + publicPatch + 全成员 actorProjections，查询只返回公共部分和本人补丁
!hasMore => throughSeq == roomCurrentSeq
本地没有有效 View => 只请求 Snapshot，禁止发送 sync(0)
任一条件不可信 => 丢弃 staging；服务端 Sync 内联最新 Snapshot，或客户端重新请求 Snapshot
Event Patch 应用完成后必须再次通过完整 MemberView 骨架校验
```

Patch 使用同一组 JSON 安全操作：

```text
patch
├── set[]    { path, value }                    # 标量、对象或确需整体替换的值
├── remove[] path                               # 删除字段
└── splice[] { path, index, deleteCount, items} # 数组局部增删改
```

数组变化优先产出单个 `splice` 中段操作，共享前后缀不重复传输。客户端严格按
`set → remove → splice` 应用公共补丁，再按相同顺序应用本人 Actor 补丁。

Command 的传输结果丢失时，客户端不能生成新 `commandId` 猜测重试。RoomClient 会把同一
`roomId + type + context + payload` 视为同一未确认意图，在收到明确成功或失败前复用原
`commandId`；服务端 Receipt 负责把重复提交收敛为一次结果。所有房间云函数调用受统一的
12 秒客户端传输超时约束，微信 SDK 丢失回调时必须结束当前请求并释放串行队列；Command 的
自动重试和用户后续重试仍复用同一个 `commandId`，不能因客户端超时制造重复房间或重复动作。
页面生命周期并发触发的 `open/refresh/resume` 必须复用同一个在途恢复请求，不能把重复 Query
排在用户 Command 前面放大冷启动或故障延迟；首页 `onLoad/onShow` 的房间发现同样使用单飞请求。

客户端 `knownSeq` 已经覆盖到本次提交前一号时，`roomCommand` 直接用事务内 Event Group 投影附带
Sync，不再二次读取 Room/Event/Presence/Signal。瞬时态标记 `ephemeral.stale`，客户端保留上次
Presence/Signal。水位落后、Event 不连续或内联失败时，仍走完整 Sync。State/Event/Receipt 已经
提交后，如果附带 Sync 查询失败，`roomCommand` 仍返回 Command 成功并省略附带 Sync。客户端在下一轮
正常同步恢复，而不是把已提交写入伪装成失败。

业务动作需要切页时，以 Outcome 的 `committedThroughSeq` 检查本地 View；未追平则先刷新
Snapshot，再按 `view.route` 导航。订阅导航与动作导航由同一协调器合并，后发调用等待在途
导航结束，不能硬编码猜测下一页面或提前释放交互锁。

业务“后退”也属于成员投影：页面只执行 `view.navigation.back`。`COMMAND` 类型携带服务端生成的
精确 context，成功后先跟随新的 `view.route`。模式选择已由 `BEGIN_MODE_SELECTION` /
`CANCEL_MODE_SELECTION` 管理为权威房间状态；旧配置页保留的 `after=OPEN_MODE_PICKER` 仅作客户端兼容，
提交 `CANCEL_WORKSHOP_SESSION` 后仍以新投影出的 `brainstormMode` Route 为准。运行期不可逆页面投影
`NONE`，不展示业务后退，不能用物理页面栈伪造状态倒退。

房间主流程保持一个微信物理页面：进入和切换使用统一导航工具，`navigateTo` 意图不会新增物理
栈层；发现遗留多层栈时只在导航协调边界执行一次根栈修复，不为每次 View 刷新调用 `reLaunch`。
系统返回由微信宿主处理退出/收起，不发送退房、解散或取消场次指令；重开仍由 Snapshot 恢复当前
成员资格和进度。`disableSwipeBack` 不再有效，不能依靠它禁用原生手势；Android 键盘和微信原生
媒体预览可能先消费返回，不能承诺每次手势都立即退出，也不在页面隐藏/卸载时猜测返回原因。

逻辑 Route 不要求与微信物理页面一一对应。连续运行且共享大量本地 UI 状态的屏幕可以由稳定
RoomShell 承载：订阅必须先把完整 PageSnapshot 投影到 Shell，再调用全局导航协调器；当两个逻辑
Route 映射到同一路径时，协调器返回 `SAME_ROUTE`，Shell 仍必须按最新 `view.route.name + params`
原子切屏。
Shell 不能用本地计时器、页面生命周期、URL 参数或临时叠层猜测屏幕，也不能维护第二份业务状态。
在线 Shell 首屏必须先显示无交互 `loading`，收到完整 PageSnapshot 后才能进入业务屏幕；投影到 Shell
边界外的 Route 时立即进入无交互 `leaving`，停止当前屏幕副作用，再由导航协调器跳转。导航失败时
继续保持 `leaving`，且不得抬高导航水位，以便后续同步重试。

当前有两个小而明确的 Shell 边界：`selectPlayer` Setup Shell 承载 Player 的情境等待与首位玩家
等待，Partner `gamepage` RoomShell 承载确认首位等待、游戏和收尾投票。通用
`room-wait-screen` 只渲染 Shell Model，不订阅 RoomSession，也不执行导航。导航描述器与两个 Shell
projector 共用同一个纯 Route 分类器，不能各自重复解释 `subAwait.params.scene`。

本地叠层不是第二个微信业务页面。`withRoomLocalScreens` 将情境编辑/详情、案例、特殊行动、裁图、
灵感和牌库挂在精确的所属页面内。组件只接收本地渲染 Model、发出语义意图；控制器由页面持有，
共用原有 RoomSession，没有新增轮询或业务状态机。辅助屏幕覆盖 owner 时暂停其订阅/录音等
副作用，嵌套返回只恢复直接下层；UI 树可重建，但 owner 实例、草稿和卡片选择保留。
展示组件在完整 Model 安装后才渲染交互节点；被覆盖的组件作用域失效，嵌套返回须等新组件 ready。
布局查询须在排队前捕获宿主的 `captureLayoutGuard`，并在访问原生节点前、安装异步结果前分别校验。
覆盖、退后台、卸载或重新挂载都会使旧可见周期失效，即使组件对象相同也不能安装旧结果；
恢复后由当前屏幕重新测量。裁图重算布局保留已选比例及原图裁剪区域，已关闭屏幕的迟到
canvas/导出回调不再回传确认或干扰新屏幕。隐藏或卸载时立即结束本地导出任务并释放交互锁，
不等待已销毁组件的回调，也不因此发送用户取消通知；返回后保留裁剪区域并允许重新确认。
这些保护仅作用于本地 UI，不改变 Member View 或 Command。
RoomSession 同步回放中关闭屏幕时，应立即释放刚创建的订阅，不重新安装到已卸载控制器。
`specialMove` 正常完成只关闭页内屏幕。权威 Route 改变（包括同一路径的 `closingStatement`）时，
协调器在同一个串行任务内先卸载局部屏幕，再安装/跟随最新 View。迟到回调只允许关闭所属实例，
不能关闭后来打开的屏幕。辅助屏幕期间的权威 Route 监听共用 RoomClient，恢复 owner 前已具备最新
PageSnapshot，不依赖下一次 Query 或微信 `navigateBack` 回调。
Master / Silent 等不改变逻辑 Route 的 View 字段变化仍是强制可见的 Shell 刷新，不能因为 route
相同或游戏区指纹相同而丢弃。静默声级属于高频瞬时字段，应窄刷新对应效果，不能为它重建卡片
swiper。从局部屏幕返回时，owner 先消费 RoomSession 内已提交的当前 View，再恢复订阅和屏幕副作用；
后台关闭屏幕不启动副作用，前台恢复只启动当前可见屏幕。挂载有统一超时，失败释放交互锁并恢复
owner。全局只读回顾仍是独立页面，通过 `returnTo` 明确 UI 返回位置，不保留旧业务页在物理栈下。

```mermaid
sequenceDiagram
  participant RC as RoomClient
  participant P as gamepage RoomShell
  participant N as Navigation Coordinator

  RC-->>P: PageSnapshot(route=subAwait, scene=confirmFirstPlayer, revision=N)
  P->>P: projectPartnerRoomShell → waiting
  RC->>N: reconcile(subAwait@N)
  N-->>RC: SAME_ROUTE（不调用 wx.redirectTo）
  RC-->>P: PageSnapshot(route=partnerGame, revision=N+1)
  P->>P: projectPartnerRoomShell → game
  RC-->>P: PageSnapshot(route=closingStatement, revision=N+2)
  P->>P: projectPartnerRoomShell → closingVote
  RC->>N: reconcile(closingStatement@N+2)
  N-->>RC: SAME_ROUTE（不调用 wx.redirectTo）
  RC-->>P: PageSnapshot(route=partnerGame, revision=N+3)
  P->>P: projectPartnerRoomShell → game
```

## 5. Room 与公共配置状态

```mermaid
stateDiagram-v2
  [*] --> OPEN: CREATE_ROOM
  OPEN --> OPEN: JOIN / PROFILE / REORDER / KICK / LEAVE
  OPEN --> SELECTING_MODE: BEGIN_MODE_SELECTION
  SELECTING_MODE --> OPEN: CANCEL_MODE_SELECTION
  SELECTING_MODE --> CONFIGURING: START_WORKSHOP_SESSION
  CONFIGURING --> RUNNING: 完成模式配置
  RUNNING --> COMPLETED: 模式完成
  CONFIGURING --> SELECTING_MODE: Host CANCEL
  RUNNING --> SELECTING_MODE: Host CANCEL
  CONFIGURING --> OPEN: 人数不足自动取消
  RUNNING --> OPEN: 人数不足自动取消
  COMPLETED --> OPEN: RETURN_TO_LOBBY
  COMPLETED --> CONFIGURING: REPLAY
  OPEN --> DISSOLVED: DISSOLVE_ROOM
  SELECTING_MODE --> DISSOLVED: DISSOLVE_ROOM
  CONFIGURING --> DISSOLVED: DISSOLVE_ROOM
  RUNNING --> DISSOLVED: DISSOLVE_ROOM
```

```mermaid
flowchart TD
  START[START_WORKSHOP_SESSION] --> MODE{mode}
  MODE -->|Spy| SI[SPY_INTRO]
  MODE -->|Partner/Halli| CS[CHOOSE_SCENARIO]
  MODE -->|Gan Deng Yan| FIRST[SELECT_FIRST_PLAYER]
  CS --> SRC{情境来源}
  SRC -->|Partner 且非 OFFLINE| COLLECT[COLLECT_DESIGN_PROBLEMS]
  COLLECT --> SELECT[SELECT_DESIGN_PROBLEM]
  SRC -->|Partner OFFLINE / Halli| FIRST
  SELECT --> FIRST
  FIRST -->|RESET_DESIGN_PROBLEM| SELECT
  FIRST -->|Partner| CONFIRM[CONFIRM_FIRST_PLAYER]
  CONFIRM -->|RESET_FIRST_PLAYER| FIRST
  FIRST -->|Halli / Gan Deng Yan| HA[HALLI_ACTIVITY]
  CONFIRM --> PT[PARTNER_TURN]
```

## 6. Partner 状态机

```mermaid
stateDiagram-v2
  [*] --> PARTNER_TURN: 确认首位成员
  PARTNER_TURN --> PARTNER_TURN: 评分/表达/素材/HELP_LUCK/MASTER
  PARTNER_TURN --> PARTNER_TURN: SILENT 开启/结束
  PARTNER_TURN --> PARTNER_TURN: START_PARTNER_STATEMENT(allPass)
  PARTNER_TURN --> PARTNER_STATEMENT: START_PARTNER_STATEMENT(partialPass/allQuestion)
  PARTNER_STATEMENT --> PARTNER_TURN: 归档 Turn + 下一成员
  PARTNER_TURN --> PARTNER_CLOSING_VOTE: 当前行动者使用 CLOSING
  PARTNER_CLOSING_VOTE --> PARTNER_TURN: 任一 question
  PARTNER_CLOSING_VOTE --> PARTNER_CLOSING_RUNE: 全部 pass
  PARTNER_CLOSING_RUNE --> PARTNER_CLOSING_REVIEW: 房主推进
  PARTNER_CLOSING_REVIEW --> COMPLETED: 房主完成
```

表态选择器不再作为权威入口。Host 点「开始表态」即发送
`START_PARTNER_STATEMENT(allQuestion)` 并进入疑问讨论页。`allPass` 仍可在同一事务内
归档当前 Turn 并开始下一 Turn，但当前页面用讨论页「没有疑问」通过
`ADVANCE_PARTNER_TURN(allPass)` 提交。`partialPass/allQuestion` 将结果保存在权威
Active Turn 后进入讨论。`ADVANCE_PARTNER_TURN` 可选用 `statementResult` 覆盖已保存
结果；未传时使用讨论开始时写入的结果。断线恢复不依赖客户端草稿。

`HELP_LUCK` 的反面随机拼先进入可返回的预览。进入和退出预览分别发送
`SET_PARTNER_SPECIAL_PREVIEW(HELP_LUCK, active=true/false)`，公开 View 中的
`activeTurn.specialPreview` 让所有成员在采用决策前同步看到与行动者一致的“反面随机拼”标签；该状态不消耗
特殊行动。只有用户选择“取消采用”或“采用卡组”时才发送
`USE_PARTNER_SPECIAL(HELP_LUCK)`，提交时清除预览并记录 `specialUsed`。
`specialMove` 首次加载与订阅都从最新完整 View 投影预览屏幕；指令成功后先追平提交水位再投影，
不能仅靠按钮回调保存 `viewMode`。页面重建后仍恢复预览，返回转盘正常清除全员徽章。

```mermaid
flowchart LR
  TURN[Active Turn] --> SCORE[每位非行动者唯一 Score]
  TURN --> MSG[匿名 Message]
  TURN --> ART[TEXT / IMAGE / VOICE Artifact]
  TURN --> SUM[Turn Summary]
  SCORE --> SUM
  ART --> SUM
  SUM --> BOARD[Leaderboard]
  SUM --> HISTORY[Session History]
```

## 7. Halli Galli / Gan Deng Yan baseline 状态机

```mermaid
stateDiagram-v2
  [*] --> CHOOSE_SCENARIO: Halli Galli
  [*] --> SELECT_FIRST_PLAYER: Gan Deng Yan
  CHOOSE_SCENARIO --> SELECT_FIRST_PLAYER: SET_SCENARIO
  SELECT_FIRST_PLAYER --> HALLI_ACTIVITY: SELECT_FIRST_PLAYER
  HALLI_ACTIVITY --> HALLI_CREATIVE: END_HALLI_ACTIVITY
  HALLI_CREATIVE --> HALLI_CREATIVE: 提交 / REOPEN / 保存自己的创意
  HALLI_CREATIVE --> HALLI_SUMMARY: 所有有效参与者已提交
  HALLI_SUMMARY --> HALLI_SUMMARY: REOPEN / 保存自己的创意
  HALLI_SUMMARY --> COMPLETED: 无修改中成员 + COMPLETE_HALLI_SESSION
```

成员离开会在同一事务内缩减 `requiredMemberIds`；若剩余提交已经齐全，立即进入汇总。
已提交的 Halli 创意在 `HALLI_CREATIVE` 阶段就进入公共 View，每次提交产生的
Public Patch 与同水位 Snapshot 都包含相同的渐进创意列表。
`REOPEN_HALLI_IDEA` 把修改意图写入 Session；修改者仍停留在 `creativeSummary`，
在本人创意条原地进入编辑态，断线恢复后仍可从 Snapshot 还原草稿与提交能力。

Gan Deng Yan 使用独立的 `GAN_DENG_YAN` 模式值和客户端 `ganDengYan` modeId。首版 baseline
跳过 `CHOOSE_SCENARIO`，从 `SELECT_FIRST_PLAYER` 开始；活动页不展示情境格，也不使用依赖情境的规则文案。
其后复用上述 `HALLI_*` Workflow、Command、Route 与创意事实结构，因此可以独立识别、恢复和重玩，
但暂不复制一套同构状态机；后续规则分化时再新增专属步骤和 Command。

Spy 的 `START_NEXT_SPY_ROUND` 在无淘汰时重新洗牌；有淘汰时则保留上轮发言顺序，
移除淘汰者并从其后一位开始。

## 8. Spy 状态机与秘密边界

```mermaid
stateDiagram-v2
  [*] --> SPY_INTRO
  SPY_INTRO --> SPY_SPEAK: 分配身份/词语
  SPY_SPEAK --> SPY_SPEAK: 下一发言者
  SPY_SPEAK --> SPY_VOTE: 全员发言结束后自动开票
  SPY_VOTE --> SPY_QUESTION: Host 开始提问
  SPY_QUESTION --> SPY_QUESTION: 下一提问者
  SPY_QUESTION --> SPY_VOTE: 全员提问结束后自动开票
  SPY_VOTE --> SPY_TIE_SPEAK: 最高票并列
  SPY_TIE_SPEAK --> SPY_VOTE: 平票成员重新发言后开票
  SPY_VOTE --> SPY_RESULT: 淘汰或全员弃票且未决胜负
  SPY_VOTE --> SPY_SETTLED: 卧底/平民胜负达成
  SPY_RESULT --> SPY_SPEAK: START_NEXT_SPY_ROUND
  SPY_SETTLED --> SPY_SPEAK: RESTART_SPY_GAME
  SPY_SETTLED --> COMPLETED: COMPLETE_SPY_SESSION
```

```mermaid
flowchart LR
  SEC[(roomV3Sessions.facts.secrets)] -->|memberId == actor| PRIVATE[actor.privateModeState]
  SEC -->|中途仅淘汰者 role| ELIM[Round Result]
  SEC -.结算前禁止其他身份与词语.-> PUBLIC[Public View]
  SEC -.结算前禁止其他身份与词语.-> EVENT[Public Event]
  VOTE[(roomV3Sessions.facts.votes)] --> COUNT[公开票数进度]
  VOTE -.结算前不公开个人票.-> PUBLIC
  SETTLED[SPY_SETTLED] --> REVEAL[公开全员身份与词语]
```

## 9. Workflow 到页面的唯一映射

| Workflow / Session | Host | Player |
|---|---|---|
| 无当前 Session，`modeSelectionActive=false` | `addPlayer` | `addPlayer` |
| 无当前 Session，`modeSelectionActive=true` | `brainstormMode?isHost=1` | `subAwait?scene=brainstormMode` |
| 非本场 Participant | `addPlayer?observing=true` | 同左 |
| `CHOOSE_SCENARIO` | `modeIndex` | `subAwait?scene=bg`（`selectPlayer` Setup Shell `waiting` 屏幕） |
| `COLLECT_DESIGN_PROBLEMS` | `submitProblem` | `submitProblem` |
| `SELECT_DESIGN_PROBLEM` | `selectProblem` | `selectProblem` |
| `SELECT_FIRST_PLAYER` | `selectPlayer` | `subAwait?scene=player`（同一 Setup Shell `waiting` 屏幕） |
| `CONFIRM_FIRST_PLAYER` | `confirmFirstPlayer` | `subAwait?scene=confirmFirstPlayer`（Partner RoomShell `waiting` 屏幕） |
| `PARTNER_TURN / STATEMENT / CLOSING_RUNE / CLOSING_REVIEW` | `partnerGame`（Partner RoomShell） | `partnerGame`（Partner RoomShell） |
| `PARTNER_CLOSING_VOTE` | `closingStatement`（同一 Partner RoomShell） | `closingStatement`（同一 Partner RoomShell） |
| Partner `COMPLETED` | `leaderboard` | `leaderboard` |
| `HALLI_ACTIVITY` | `halliGame` | `halliGame` |
| `HALLI_CREATIVE` 未提交 | `creativeInput` | `creativeInput` |
| `HALLI_CREATIVE` 已提交 / `HALLI_SUMMARY` / 完成 | `creativeSummary` | `creativeSummary`（本人修改时仍在本页原地编辑） |
| `SPY_INTRO / SPEAK / VOTE / RESULT / SETTLED` | 对应 Spy 页面 | 对应 Spy 页面 |

## 10. 成员变化的原子副作用

```mermaid
flowchart TD
  LEAVE[LEAVE / KICK] --> MEMBER[删除 Room Member]
  LEAVE --> PARTICIPANT[Session Participant 标为 LEFT]
  PARTICIPANT --> MODE{当前模式/步骤}
  MODE -->|配置人数不足| CANCEL[取消 Session]
  MODE -->|Partner 行动者离开| ARCHIVE[归档 ABANDONED Turn]
  ARCHIVE --> NEXT[推进下一有效成员]
  MODE -->|Partner 评分/收尾票| SHRINK1[缩减 required 集合并判定完成]
  MODE -->|Halli / Gan Deng Yan 投稿| SHRINK2[缩减 required 集合并判定汇总]
  MODE -->|Spy| SHRINK3[移出发言/投票并重新判定胜负]
```

已离房成员的事实仍用于审计和历史展示，但会同时移出 `required/submitted` 进度集合；Partner 收尾与 Spy 淘汰裁决只统计当前 `requiredMemberIds` 中的票。
进行中的页面模型只把 `status=ACTIVE` 的冻结 Participant 投影为可见/可选成员，席位与参与资格不随 Room Member 变化；对仍在 Room 的 Participant，则从 `room.members` 叠加最新昵称、头像和颜色。这样 `UPDATE_MEMBER_PROFILE` 经 Snapshot 或 Event Patch 更新后，各端当前场次使用同一份最新资料。历史回看与已完成场次的结算页仍投影全部 Participant，并使用开场时冻结的展示资料，避免后续改名改写归档记录。

设计问题的公共投影保留服务端 `createdAt`。客户端必须按该字段稳定排序，不能使用随机
`contributionId` 或本地接收顺序推断提交先后；该字段同时经 Snapshot 和 Event Patch 更新。

## 11. 辅助能力归属

| 能力 | 归属 | 是否推进业务 seq |
|---|---|:---:|
| Presence 续租 | 任意已鉴权房间协议携带 `clientContext`，写 `roomV3Presence` | 否 |
| Partner 静默声贝 | `roomSignal` + `roomV3Signals`，事务校验 Room.signalScope 的 session/turn/active member/deadline；仅当前静默行动者可写。行动者以本机麦克风驱动边框并广播声级，其他玩家消费同一 signal，保持声浪外圈与声音过大提示一致 | 否 |
| 设计问题催促 | `roomSignal` + `roomV3Signals` 的 `DESIGN_PROBLEM_NUDGE`；校验当前 Session 处于 `COLLECT_DESIGN_PROBLEMS`、调用者已提交且仍有未提交者；房间级最新信号供客户端投影，Session + Member 级冷却凭证保证同一成员 15 秒内幂等 | 否 |
| 设计问题编辑态 | `roomSignal` + `roomV3Signals` 的 `DESIGN_PROBLEM_EDITING`；仅 Host 在 `SELECT_DESIGN_PROBLEM` 可写；绑定精确 `sessionId + workflowRevision`，value 为 `contributionId` 或空字符串结束编辑；TTL 60 秒。它不推进 seq，每次 idle Sync 仍返回当前 ephemeral，Page Model 校验步骤、Session、workflow revision 和过期时间后投影 `roomState.editingProblemId`；页面不得直读 raw ephemeral | 否 |
| 房间二维码 | `roomMedia` + `roomV3Media` | 否 |
| 语音转写 | `speechToText`；partner-audio 的每个 run 冻结 room/session/turn/workflowStep/phase，自然分段结果通过 Artifact Command 入房间，主动停止丢弃部分旧音频。MP3/PCM 共用持久设备控制器；onStart 才确认录音，未开始且明确未取得轨道的 NotFoundError/NotAllowedError 直接结束失败 run，同作用域不重试；其他错误/停止超时保留最新意图，迟到 onStop 自动恢复，不依赖额外 Sync，也不刷新已离页 UI | 只有入房间时 |
| Inspiration | 独立 `inspirations` 业务 | 否 |
| History / Session / Leaderboard | `roomQuery` | 否 |

RoomClient 的最小轮询间隔为 **2 秒**。所有房间调用复用同一个 `deviceSessionId`；距离上次续租
达到 **5 秒**时携带 `touchPresence=true`，服务端以自身时间写租约。在线投影窗口为 **15 秒**，
写入失败只影响在线提示，不得让 Command、Snapshot 或 Sync 失败。Presence 续租使用
事务外单次点写，`db.command.max(lastSeenAt)` 原子防止延迟到达的旧请求回退时间戳；
它不与业务 Aggregate 共用事务。
`roomCommand` 与所有 `roomQuery` action 共用一条串行通道；用户显式打开历史等前台读取可立即排队，
但自动 Sync 只有在上一请求结束后连续静默 2 秒才会发起。页面切换紧跟刚完成的 Command/Query 时
直接消费内存中的权威 View，不重复读取 Snapshot；前台请求完成后同样重新开始静默窗口。

业务 Sync 仍按 2 秒检查事件，Presence 列表独立降频为每 **5 秒**最多读取一次；其他 Sync 将
`ephemeral.stale.presence=true`，客户端保留上次成功在线投影。Presence 查询在数据库索引层使用
`lastSeenAt >= cutoff` 排除过期租约。三种公开 Signal 聚合在一个
`_id=hash(roomId:PUBLIC_SIGNALS)` 文档中，活跃场次的最终 Sync 只需一次点读；大厅没有活跃
Session 时不读取 Signal 文档。成员级催促冷却凭证仍独立保存。
Presence 或 Signal 读取失败时，响应在 `ephemeral.stale` 标记对应通道；客户端保留该通道
最后一次成功值，直到后续成功响应替换，不能把依赖故障误显示为全员离线或信号归零。

```mermaid
sequenceDiagram
  participant H as 历史卡片
  participant Q as roomQuery(session)
  participant A as Archived Session
  H->>Q: roomId + sessionId
  Note over H,Q: 不切换当前 RoomClient 活跃连接
  Q->>A: 按 Session 读取冻结 Participants + Facts
  A-->>Q: Archived MemberView
  Q-->>H: 可序列化 PageSnapshot
  Note over Q,A: 已离房/被踢/房间解散后，原 Participant 仍可读取自己的归档场次
```

## 12. 代码入口

| 边界 | 实现 |
|---|---|
| Schema / Command / Event / Error | `packages/room-contracts` |
| Room / Partner / Gan Deng Yan / Halli / Spy Reducer | `packages/room-domain` |
| Public / Actor / Route / Navigation / Capability / Event Reduce | `packages/room-projection` |
| 事务编排 / Snapshot / Sync / History | `packages/room-application` |
| CloudBase 事务仓储 | `packages/room-cloudbase-adapter` |
| 客户端恢复与单轮询 | `packages/room-client` |
| 小程序会话与页面模型 | `modules/room-session` |
| 导航协调 | `modules/room-navigation` |
| 云函数入口 | `cloudfunctions/roomCommand`、`roomQuery`、`roomSignal`、`roomMedia`、`speechToText` |

## 13. 自动化门禁

```mermaid
flowchart LR
  TEST[pnpm test] --> CONTRACT[协议白名单/上下文]
  TEST --> DOMAIN[三模式完整流程/退出边]
  TEST --> SYNC[Snapshot/Event/缺口/重试]
  TEST --> PRIVACY[Spy 私密投影]
  TEST --> STATIC[无旧云函数/直连 DB/死页面]
  TEST --> UI[页面锁与路由文件完整]
```

仓库验收命令：

```bash
pnpm test
pnpm build:cloud
git diff --check
```
