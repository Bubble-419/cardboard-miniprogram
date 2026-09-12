# 房间业务流程现状

> 历史基线：本文记录 V3 重构前的业务入口与兼容流程，仅用于核对功能没有遗漏。
>
> 当前实现以 [协议 V3 实现说明](./ROOM_PROTOCOL_V3_IMPLEMENTATION.md) 为准。

## 1. 角色与会话边界

```mermaid
flowchart LR
  Host[房主 Host<br/>creatorId / hostUserId]
  Player[成员 Player]
  Room[Room<br/>长期协作容器]
  WS[Workshop Session<br/>brainstormSessionSeq]
  Seat[Seat 1..6<br/>playerIndex / seatNo]

  Host -->|创建与控制| Room
  Player -->|加入| Room
  Room -->|拥有| Seat
  Host -->|也是成员并占席| Seat
  Player -->|占用| Seat
  Room -->|多次进行| WS
```

| 业务约束 | 现行规则 |
|---|---|
| 房间号 | 8 位数字；随机生成，最多重试 5 次查重 |
| 席位 | `1..6`，加入时取最小空位 |
| 房主 | legacy 以 `creatorId` 为准；V2 以 `hostUserId` 为准并兼容 `creatorId` |
| 房主退出 | 不允许普通离开，需解散房间 |
| 工作坊开始 | `roomStartWorkshop` 写 `status=STARTED` 与名称；不建立独立 Session 文档 |
| 模式 | `halliGalli`、`partner`、`spy` |
| 中途加入 | legacy 只禁止已解散房；V2 允许 `LOBBY` 或 `ACTIVE` |

## 2. 进入房间与大厅

```mermaid
sequenceDiagram
  autonumber
  actor U as 用户
  participant Home as 首页 aaa
  participant C as roomCreate / roomJoin
  participant DB as rooms + roomMembers
  participant Lobby as addPlayer
  participant Poll as RoomSession -> getAddPlayerData

  alt 创建房间
    U->>Home: 创建
    Home->>C: roomCreate(clientCreateId, profile)
    C->>DB: 事务创建 Room + GOD@seat1
    C-->>Home: roomId + qrcodeFileID?
  else 扫码/输入房间号/历史恢复
    U->>Home: 加入或打开历史房间
    Home->>C: roomJoin(roomId, profile)
    C->>DB: 幂等更新资料或占用最小空席
    C-->>Home: playerIndex + role
  end
  Home->>Lobby: 进入 addPlayer
  Lobby->>Poll: 打开 App 级会话
  loop 房主 4s / 成员 2.5s
    Poll->>DB: 读取房间、成员、评分与二维码 URL
    DB-->>Lobby: legacy 组合快照
  end
```

### 大厅分支

```mermaid
stateDiagram-v2
  [*] --> 等待房间
  等待房间 --> 选择模式: 房主且人数 >= 2
  等待房间 --> 继续进行: 已选模式且场次未结束
  等待房间 --> 再来一轮: 已选模式且场次已结束
  等待房间 --> 已离开: 普通成员离开
  等待房间 --> 已解散: 房主解散
  等待房间 --> 等待房间: 改名 / 换头像 / 调整席位 / 踢人
  已离开 --> [*]
  已解散 --> [*]
```

| 操作 | 执行者 | 当前写路径 | 主要结果 |
|---|---|---|---|
| 创建 | 任意已登录用户 | `roomCreate`（legacy） | `rooms.status=CREATED`；创建 `GOD@1` |
| 加入 | 任意已登录用户 | `roomJoin`（legacy） | 新增/更新 `roomMembers` |
| 开始工作坊 | 房主 | `roomStartWorkshop` | `status=STARTED`、`workshopName` |
| 调整席位 | 房主 | 优先 `REORDER_SEATS` | V2 会同步 `seatMap` 与 `roomMembers` |
| 更新资料 | 本人 | legacy 页面/云函数；V2 命令亦存在 | 更新成员读模型 |
| 踢出成员 | 房主 | `roomKickMember` | 删除成员并写 `lastEvent` |
| 普通离开 | 成员 | `roomLeave` | 删除成员并写 `lastEvent` |
| 解散 | 房主 | `roomDissolve`（页面现行） | `status=DISSOLVED`、删除成员 |

## 3. 模式与公共配置流程

```mermaid
flowchart TD
  L[addPlayer 大厅]
  BM[brainstormMode<br/>房主选择模式]
  SA[subAwait<br/>成员等待]
  MI[modeIndex<br/>情境来源]
  CBG[selectBG<br/>自定义情境]
  CONF[confirmBG<br/>Partner 确认情境]
  SUB[submitProblem<br/>全员提交设计问题]
  SELP[selectProblem<br/>房主选择问题]
  SP[selectPlayer<br/>触摸/随机]
  CFP[confirmFirstPlayer<br/>Partner 明确选首位]
  PG[Partner gamepage]
  HG[Halli gamepage]
  SG[Spy intro]

  L --> BM
  BM -->|partner| MI
  BM -->|halliGalli| MI
  BM -->|spy| SG
  BM -.成员.-> SA

  MI -->|线下，无情境| SP
  MI -->|自定义 Partner| CBG
  MI -->|案例/历史 Partner| CONF
  MI -->|自定义 Halli| CBG
  MI -->|案例/历史 Halli| SP

  CBG -->|Partner: scene/user/platform/function| CONF
  CBG -->|Halli: scene/user/function| SP
  CONF --> SUB
  SUB -->|全员提交| SELP
  SELP -->|房主确认设计问题| SP
  SP -->|Partner| CFP
  CFP --> PG
  SP -->|Halli| HG

  SA -.按 currentPage 跟随.-> MI
  SA -.按 currentPage 跟随.-> SUB
  SA -.按 currentPage 跟随.-> SELP
  SA -.按 currentPage 跟随.-> SP
```

### `currentPage` 在配置阶段的实际序列

| 场景 | 服务器页面序列 |
|---|---|
| Partner 案例/历史 | `auth` → `confirmBG` → `submitProblem` → `selectProblem` → `selectPlayer` → `confirmFirstPlayer` → `gamepage` |
| Partner 自定义 | `auth` → `selectBG` → `confirmBG` → `submitProblem` → `selectProblem` → `selectPlayer` → `confirmFirstPlayer` → `gamepage` |
| Partner 线下 | `auth` → `selectPlayer` → `confirmFirstPlayer` → `gamepage` |
| Halli 案例/历史 | `auth` → `selectPlayer` → `gamepage` |
| Halli 自定义 | `auth` → `selectBG` → `selectPlayer` → `gamepage` |
| Halli 线下 | `auth` → `selectPlayer` → `gamepage` |
| Spy | `spymodeindex` → `spyspeak` → … |

> `auth` 没有独立业务状态：它是非 Spy 进入公共 `modeIndex` 的兼容页面键。

### 设计问题的数据流

```mermaid
sequenceDiagram
  participant P as 每位成员
  participant Page as submitProblem
  participant D as designProblems
  participant Q as getDesignProblems
  participant R as rooms
  participant H as 房主 selectProblem

  P->>Page: 输入问题
  Page->>D: 客户端直写 upsert<br/>roomId+playerIndex+entryType
  Page->>Q: 查询提交进度
  Q-->>Page: submittedCount / totalMembers
  alt 全员提交
    Page->>R: updateRoomState(selectProblem)
  end
  H->>D: updateDesignProblem
  H->>R: selectedDesignProblem + selectPlayer
```

**分叉：**未被当前主页面使用的 `submitDesignProblem` 写 `roomDesignProblems`；现行页面与查询写/读 `designProblems(entryType=designProblem)`。

## 4. Partner 业务流程

### 主状态机

```mermaid
stateDiagram-v2
  [*] --> Play: 首位玩家确认
  Play --> Play: 记录/图片/匿名表达/计时循环
  Play --> Special: 当前出牌者选择特殊行动
  Special --> Play: 求助运气 / 静默结束 / MASTER
  Special --> ClosingVote: 选择收尾
  Play --> Discussion: 非出牌成员全部评分<br/>房主 START_STATEMENT
  Discussion --> Play: 房主结束讨论<br/>ADVANCE_TURN

  ClosingVote --> Play: 任一 question<br/>转到首位质疑者
  ClosingVote --> ClosingRune: 全员 pass
  ClosingRune --> ClosingReview: 房主下一步
  ClosingReview --> Leaderboard: 房主结束脑暴
  Leaderboard --> Play: 再来一轮，保留模式/情境/问题
  Leaderboard --> Lobby: 清除模式并回房间
```

### 单个 Turn

```mermaid
sequenceDiagram
  autonumber
  actor A as 当前出牌者
  actor O as 其他成员
  actor H as 房主
  participant G as Partner gamepage
  participant S as roomScores
  participant R as rooms

  A->>G: 操作卡牌、记录解释、可用一次特殊行动
  O->>S: submitGameScore(0..5, step=0.5)
  S->>R: 同步 progress(turnId)
  R-->>G: scoredCount / totalRequired
  H->>R: START_STATEMENT（优先 V2）
  R-->>G: partnerGamePhase=discussion
  H->>R: finalizePartnerTurnRecord
  H->>R: ADVANCE_TURN（优先 V2）
  R-->>G: 归档当前内容、清空新 Turn、换席位、currentRound+1
```

| Turn 事实 | 现行口径 |
|---|---|
| `turnId` | `turn_r{currentRound}_s{currentPlayerIndex}` |
| 评分者 | 当前仍在房且不是出牌者的成员 |
| 评分 | `0..5`，允许 `0.5` 步进；UI 可选值从 `0.5` 起 |
| 开始讨论 | 仅房主；V2 要求当前 `turnId` 的评分已齐 |
| 结束讨论 | 仅房主；先补全均分记录，再推进到下一席位 |
| Round | 代码中每次 `ADVANCE_TURN` 都 `+1`，实际等同“全局 Turn 序号”，不是全员走完一圈 |
| 归档 | `partnerRoundSummaries[]`；当前内容在 `partnerCurrentRoundContent` |

### 特殊行动与收尾

```mermaid
flowchart TD
  W[特殊行动转盘]
  Luck[求助运气<br/>反面随机拼]
  Silent[全场静默<br/>5 分钟]
  Master[MASTER]
  Close[进入收尾]
  Vote[closingStatement<br/>发起人默认 pass]
  Q{全部所需票已提交?}
  HasQ{存在 question?}
  Back[回到 play<br/>首位质疑者出牌]
  Rune[closing / rune<br/>补全符文]
  Review[closing / review<br/>回顾创意点]
  Rank[leaderboard]

  W --> Luck --> W
  W --> Silent --> W
  W --> Master --> W
  W --> Close --> Vote --> Q
  Q -->|否| Vote
  Q -->|是| HasQ
  HasQ -->|是| Back
  HasQ -->|否| Rune --> Review --> Rank
```

| 特殊行动 | 共享状态 | 备注 |
|---|---|---|
| 求助运气 | 无专用房间状态 | 当前只开放“反面随机拼”；主要是页面内视图 |
| 全场静默 | `partnerSilentMode/StartedAt/SoundLevel` | 5 分钟；声贝约每 500ms 写一次，声贝快路径不增加 revision |
| MASTER | `partnerMasterMode=true` | “本 Turn 已用”还依赖客户端本地标记 |
| 收尾 | `currentPage=closingstatement`、`partnerGamePhase=closing`、新 vote session | UI 仅允许当前出牌者进入；legacy `closing` phase 的服务端写入本身未要求房主 |

收尾投票由 `submitClosingVote` 在事务中结算：发起席位免投且默认 `pass`；其余当前席位每人一票，不可修改。

### 收尾兼容页面

```mermaid
flowchart LR
  A[gamepage closing/review] -->|结束| B[currentPage=leaderboard]
  C[closingEnd 文件] -->|onLoad 立即跳转| D[pages/leaderboard/index]
  B --> D
```

`statement` 页面也会在 `onLoad` 立即重定向到 `gamepage?phase=discussion`，当前主流程已内联讨论页。

## 5. Halli Galli 业务流程

```mermaid
stateDiagram-v2
  [*] --> Setup: modeIndex / selectBG
  Setup --> SelectPlayer
  SelectPlayer --> Gamepage: 房主选定玩家
  Gamepage --> CreativeInput: 房主结束游戏<br/>creativeSessionSeq+1
  CreativeInput --> CreativeSummary: 每人提交一条创意
  CreativeSummary --> Lobby: 全员已提交且房主结束

  state Gamepage {
    [*] --> InstructionOnly
    InstructionOnly --> InstructionOnly: 发牌/翻牌/按铃/投票/裁定说明
  }
```

| 状态 | 当前实现 |
|---|---|
| 游戏进行 | `currentPage=gamepage`，展示规则步骤；无服务端胜负、回合或卡牌状态机 |
| 结束游戏 | 房主写 `currentPage=creativeInput` 并 `creativeSessionSeq+1` |
| 创意提交 | 每人向 `designProblems(entryType=creativeIdea)` 按场次 upsert，最长 120 字 |
| 汇总 | `listCreativeIdeas` 每 2s 拉取；全员非空后房主可结束 |
| 结束 | `roomClearBrainstormMode` 清模式并回大厅 |

**不可达：**`playSuccess`、`playFail`、旧 `selectMode` 文件仍存在，当前 Halli 主流程没有写入这些页面状态。

## 6. Spy 业务流程

### 游戏状态机

```mermaid
stateDiagram-v2
  [*] --> Intro: 选择 Spy 模式
  Intro --> Speak: 房主 SPY_START_ASSIGN<br/>人数 >= 3<br/>分牌与开口合并
  Speak --> Speak: 当前发言者结束发言<br/>推进下一存活者
  Speak --> Vote: 最后一人结束 / 房主强制开票
  Vote --> Vote: 存活成员提交一票或弃票
  Vote --> TieSpeak: 全员已投且最高票并列
  TieSpeak --> Vote: 并列者加时陈述后再投
  Vote --> Result: 淘汰一人且未分胜负
  Result --> Speak: 任意成员开始下一轮
  Vote --> Settle: 卧底清零或卧底数 >= 平民数
  Settle --> Intro: 房主重新开始
```

### 命令与权限

| 操作 | 权限 | CAS | 结果 |
|---|---|---:|---|
| `SPY_START_ASSIGN` | 房主 | 是 | 随机词对/身份/发言顺序；直接进入 `speak` |
| `SPY_GET_MY_CARD` | 成员 | 否，只读 | 仅返回本人身份与词语 |
| `SPY_ADVANCE_SPEAKER` | 当前发言者 | 是 | 下一发言者或进入投票 |
| 强制开票 | 房主 | 是 | `speak → vote` |
| `SPY_SUBMIT_VOTE` | 存活成员 | 否 | 不能投自己；可弃票；不可改票 |
| `SPY_NEXT_ROUND` | 任意成员 | 是 | 存活者重排；`round+1` |
| `SPY_RESTART` | 房主 | 是 | 清局内状态与密牌，回 `intro` |

### 公开与秘密视图

```mermaid
flowchart LR
  Sec[(roomSecrets<br/>userId -> role/word)]
  Legacy[(rooms.spyAssignments<br/>兼容双写)]
  Pub[rooms.spyGame<br/>公开局面]
  Mine[SPY_GET_MY_CARD<br/>本人密牌]
  Poll[getAddPlayerData<br/>公开快照]

  Sec --> Mine
  Legacy -.fallback.-> Mine
  Pub --> Poll
  Legacy -->|仅 settle 揭晓| Poll
```

- 3–6 人固定 1 名卧底；代码虽有“大于 6 人为 2 名卧底”的分支，但房间上限为 6，当前不可触发。
- 投票期间公开已投人数，不公开 `tally/ballots`；`settle` 才公开词语与角色。
- `assign`、`nextRound` 页面是兼容页面：现行 `START_ASSIGN` 跳过 `assign`，正常结算也直接 `result → speak`。

## 7. 成员离开、恢复与返回大厅

```mermaid
flowchart TD
  X[成员离开或被踢]
  E[lastEvent=room_members_updated]
  N{活跃场次且<br/>剩余人数 <= 1?}
  R[lastEvent=game_returned_to_room<br/>清模式/进度并回 addPlayer]
  K[保留当前模式<br/>修剪 Spy 玩家]
  P[各端轮询消费 lastEvent]
  H[房主主动回大厅]
  ST[Spy lobbyStay 本地抑制跟随]

  X --> E --> N
  N -->|是| R --> P
  N -->|否| K --> P
  H --> ST
```

### `getAddPlayerData` 的恢复页选择

```mermaid
flowchart LR
  A[currentPage 缺失或 addPlayer]
  B{已选模式且<br/>场次未结束?}
  C{brainstormProgressPage<br/>可恢复?}
  D[返回 progressPage]
  E[返回 addPlayer]

  A --> B
  B -->|否| E
  B -->|是| C
  C -->|是，且非 closingEnd/brainstormMode| D
  C -->|否| E
```

`lastEvent` 只有一个最新值；没有消费游标、序列或确认机制。页面通过幂等导航和本地防回跳规则减少旧快照造成的振荡。
