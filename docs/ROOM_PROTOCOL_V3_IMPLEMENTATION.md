# 房间协议 V3 实现说明

> 状态：仓库实现完成；云端资源与真机发布按 [部署清单](./ROOM_PROTOCOL_V3_DEPLOYMENT.md) 执行。
>
> 数据边界：只读写 `roomV3*` 新集合，不迁移、不双读、不双写旧房间数据。

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
    PRES[roomPresence]
    SIG[roomSignal]
    MEDIA[roomMedia]
    STT[speechToText]
    APP[Room Application]
    DOM[纯 Domain Reducer]
    PROJ[MemberView Projector]
    REPO[CloudBase Repository]
    CMD --> APP
    QUERY --> APP
    PRES --> APP
    SIG --> APP
    MEDIA --> APP
    STT --> APP
    APP --> DOM
    APP --> PROJ
    APP --> REPO
  end

  GW --> CMD
  GW --> QUERY
  GW --> PRES
  PAGE -.瞬时声音/二维码.-> SIG
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
├── room { roomId, lifecycle, hostMemberId, workshopName, members[] }
├── session
│   ├── { sessionId, ordinal, status, mode, participants[] }
│   ├── setup { scenarioSource, scenario, selectedProblem, proposedFirstMemberId }
│   ├── workflow { step, roundNo, activeMemberId, turnId, phaseStartedAt }
│   ├── progress / publicModeState / activeTurn
│   └── result / recentMessages / activeArtifacts / turnSummaries
├── actor
│   ├── { memberId, role, seatNo, isParticipant }
│   ├── contributionStatus / scoreStatus / voteStatus
│   ├── privateModeState  # 仅本人 Spy 牌
│   └── capabilities      # 每种 Command 的 allowed/reason
└── route { name, params }
```

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
  T->>T: 查 Receipt / ActiveRoom / Aggregate
  T->>D: 最新 Aggregate + Command
  D-->>T: Next Aggregate + Domain Events + Dirty Facts
  T->>P: Before/After Public View
  P-->>T: publicPatch
  T->>T: State + Facts + Event Group + Receipt
  T-->>A: 原子提交结果
  A-->>C: Outcome + SyncBatch
  C->>C: 原子应用 Event Group + Actor View
  C-->>U: 发布新 View
```

对会跨步骤复用同一 `turnId` 的写操作，Envelope 额外冻结 `workflowStep`：

```mermaid
flowchart LR
  UI[用户开始输入/录音] --> TOKEN[sessionId + turnId + workflowStep]
  TOKEN --> CMD[Artifact / Message Command]
  CMD --> CHECK{仍是同一工作流步骤?}
  CHECK -->|是| COMMIT[写入对应阶段]
  CHECK -->|否| STALE[STALE_CONTEXT<br/>禁止落入下一阶段]
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
  COMMIT --> STATE[State/Facts]
  COMMIT --> EVENTS[连续 Event Group]
  COMMIT --> NEWRECEIPT[Receipt]
```

## 4. Snapshot + Event 同步

```mermaid
sequenceDiagram
  participant C as RoomClient
  participant Q as roomQuery
  participant DB as Transactional Read

  C->>Q: current
  Q-->>C: roomId / null
  C->>Q: snapshot(roomId)
  Q->>DB: 同一事务读取 Aggregate + Facts
  DB-->>Q: Aggregate@N
  Q-->>C: Snapshot(view, seq=N, actor, route, ephemeral)

  loop 单一短轮询计时器
    C->>Q: sync(afterSeq=N)
    Q-->>C: Event Groups(N+1...M) + roomCurrentSeq
    alt 连续、完整且已追平
      C->>C: staging 应用后一次发布
      Q-->>C: ActorView@M + ephemeral
    else hasMore
      C->>Q: sync(afterSeq=throughSeq)
    else 缺口/过期/未知版本/矛盾水位
      C->>Q: snapshot(roomId)
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
  SYNCING --> CATCHING_UP: hasMore
  CATCHING_UP --> CATCHING_UP: 下一完整批
  CATCHING_UP --> READY: 追平并发布
  SYNCING --> RECOVERING: gap / schema / watermark
  RECOVERING --> READY: Snapshot
  SYNCING --> DEGRADED: 可恢复失败
  DEGRADED --> SYNCING: 指数退避重试
  OPENING --> DISCONNECTED: 非成员/解散/不存在
  RECOVERING --> DISCONNECTED: 非成员/解散/不存在
  READY --> CLOSED: close
```

同步约束：

```text
Snapshot.seq == Aggregate.room.eventSeq
Event.seq == 前一 seq + 1
每个完整 Event Group.stateVersion == 前一状态版本 + 1
同一 commandId 的 Event Group 不拆分、不部分发布
!hasMore => throughSeq == roomCurrentSeq 且必须携带 ActorView@M
任一条件不可信 => 丢弃 staging，重新 Snapshot
```

## 5. Room 与公共配置状态

```mermaid
stateDiagram-v2
  [*] --> OPEN: CREATE_ROOM
  OPEN --> OPEN: JOIN / PROFILE / REORDER / KICK / LEAVE
  OPEN --> CONFIGURING: START_WORKSHOP_SESSION
  CONFIGURING --> RUNNING: 完成模式配置
  RUNNING --> COMPLETED: 模式完成
  CONFIGURING --> OPEN: CANCEL / 人数不足
  RUNNING --> OPEN: CANCEL / 人数不足
  COMPLETED --> OPEN: RETURN_TO_LOBBY
  COMPLETED --> CONFIGURING: REPLAY
  OPEN --> DISSOLVED: DISSOLVE_ROOM
  CONFIGURING --> DISSOLVED: DISSOLVE_ROOM
  RUNNING --> DISSOLVED: DISSOLVE_ROOM
```

```mermaid
flowchart TD
  START[START_WORKSHOP_SESSION] --> MODE{mode}
  MODE -->|Spy| SI[SPY_INTRO]
  MODE -->|Partner/Halli| CS[CHOOSE_SCENARIO]
  CS --> SRC{情境来源}
  SRC -->|Partner 且非 OFFLINE| COLLECT[COLLECT_DESIGN_PROBLEMS]
  COLLECT --> SELECT[SELECT_DESIGN_PROBLEM]
  SRC -->|Partner OFFLINE / Halli| FIRST[SELECT_FIRST_PLAYER]
  SELECT --> FIRST
  FIRST -->|Partner| CONFIRM[CONFIRM_FIRST_PLAYER]
  FIRST -->|Halli| HA[HALLI_ACTIVITY]
  CONFIRM --> PT[PARTNER_TURN]
```

## 6. Partner 状态机

```mermaid
stateDiagram-v2
  [*] --> PARTNER_TURN: 确认首位成员
  PARTNER_TURN --> PARTNER_TURN: 评分/表达/素材/HELP_LUCK/MASTER
  PARTNER_TURN --> PARTNER_TURN: SILENT 开启/结束
  PARTNER_TURN --> PARTNER_STATEMENT: 全部有效评分完成
  PARTNER_STATEMENT --> PARTNER_TURN: 归档 Turn + 下一成员
  PARTNER_TURN --> PARTNER_CLOSING_VOTE: 当前行动者使用 CLOSING
  PARTNER_CLOSING_VOTE --> PARTNER_TURN: 任一 question
  PARTNER_CLOSING_VOTE --> PARTNER_CLOSING_RUNE: 全部 pass
  PARTNER_CLOSING_RUNE --> PARTNER_CLOSING_REVIEW: 房主推进
  PARTNER_CLOSING_REVIEW --> COMPLETED: 房主完成
```

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

## 7. Halli Galli 状态机

```mermaid
stateDiagram-v2
  [*] --> CHOOSE_SCENARIO
  CHOOSE_SCENARIO --> SELECT_FIRST_PLAYER: SET_SCENARIO
  SELECT_FIRST_PLAYER --> HALLI_ACTIVITY: SELECT_FIRST_PLAYER
  HALLI_ACTIVITY --> HALLI_CREATIVE: END_HALLI_ACTIVITY
  HALLI_CREATIVE --> HALLI_CREATIVE: 成员提交/更新自己的创意
  HALLI_CREATIVE --> HALLI_SUMMARY: 所有有效参与者已提交
  HALLI_SUMMARY --> COMPLETED: COMPLETE_HALLI_SESSION
```

成员离开会在同一事务内缩减 `requiredMemberIds`；若剩余提交已经齐全，立即进入汇总。

## 8. Spy 状态机与秘密边界

```mermaid
stateDiagram-v2
  [*] --> SPY_INTRO
  SPY_INTRO --> SPY_SPEAK: 分配身份/词语
  SPY_SPEAK --> SPY_SPEAK: 下一发言者
  SPY_SPEAK --> SPY_VOTE: 发言结束/房主开票
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
  SEC[(roomV3Secrets)] -->|memberId == actor| PRIVATE[actor.privateModeState]
  SEC -->|中途仅淘汰者 role| ELIM[Round Result]
  SEC -.结算前禁止其他身份与词语.-> PUBLIC[Public View]
  SEC -.结算前禁止其他身份与词语.-> EVENT[Public Event]
  VOTE[(roomV3Votes)] --> COUNT[公开票数进度]
  VOTE -.结算前不公开个人票.-> PUBLIC
  SETTLED[SPY_SETTLED] --> REVEAL[公开全员身份与词语]
```

## 9. Workflow 到页面的唯一映射

| Workflow / Session | Host | Player |
|---|---|---|
| 无当前 Session | `addPlayer` | `addPlayer` |
| 非本场 Participant | `addPlayer?observing=true` | 同左 |
| `CHOOSE_SCENARIO` | `modeIndex` | `subAwait` |
| `COLLECT_DESIGN_PROBLEMS` | `submitProblem` | `submitProblem` |
| `SELECT_DESIGN_PROBLEM` | `selectProblem` | `subAwait` |
| `SELECT_FIRST_PLAYER` | `selectPlayer` | `subAwait` |
| `CONFIRM_FIRST_PLAYER` | `confirmFirstPlayer` | `confirmFirstPlayer` |
| `PARTNER_TURN / STATEMENT / CLOSING_RUNE / CLOSING_REVIEW` | `partnerGame` | `partnerGame` |
| `PARTNER_CLOSING_VOTE` | `closingStatement` | `closingStatement` |
| Partner `COMPLETED` | `leaderboard` | `leaderboard` |
| `HALLI_ACTIVITY` | `halliGame` | `halliGame` |
| `HALLI_CREATIVE` 未提交 | `creativeInput` | `creativeInput` |
| `HALLI_CREATIVE` 已提交 / `HALLI_SUMMARY` / 完成 | `creativeSummary` | `creativeSummary` |
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
  MODE -->|Halli 投稿| SHRINK2[缩减 required 集合并判定汇总]
  MODE -->|Spy| SHRINK3[移出发言/投票并重新判定胜负]
```

已离房成员的事实仍用于审计和历史展示，但会同时移出 `required/submitted` 进度集合；Partner 收尾与 Spy 淘汰裁决只统计当前 `requiredMemberIds` 中的票。

## 11. 辅助能力归属

| 能力 | 归属 | 是否推进业务 seq |
|---|---|:---:|
| Presence 心跳 | `roomPresence` + `roomV3Presence` | 否 |
| Partner 静默声贝 | `roomSignal` + `roomV3Signals`，绑定 session/turn/deadline | 否 |
| 房间二维码 | `roomMedia` + `roomV3Media` | 否 |
| 语音转写 | `speechToText`；录音开始时冻结 session/turn/workflowStep，结果通过 Artifact Command 入房间 | 只有入房间时 |
| Inspiration | 独立 `inspirations` 业务 | 否 |
| History / Session / Leaderboard | `roomQuery` | 否 |

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
| Room / Partner / Halli / Spy Reducer | `packages/room-domain` |
| Public / Actor / Route / Capability / Event Reduce | `packages/room-projection` |
| 事务编排 / Snapshot / Sync / History | `packages/room-application` |
| CloudBase 事务仓储 | `packages/room-cloudbase-adapter` |
| 客户端恢复与单轮询 | `packages/room-client` |
| 小程序会话与页面模型 | `modules/room-session` |
| 导航协调 | `modules/room-navigation` |
| 云函数入口 | `cloudfunctions/roomCommand`、`roomQuery`、`roomPresence`、`roomSignal`、`roomMedia` |

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
