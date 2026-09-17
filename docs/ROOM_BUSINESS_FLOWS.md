# 房间协议 V3 业务流程

> 本文描述当前代码中的可达业务流程。协议同步和恢复见 [V3 实现说明](./ROOM_PROTOCOL_V3_IMPLEMENTATION.md)，数据归属见 [房间模型与状态](./ROOM_MODEL_STATE.md)。

## 1. 全局流程

```mermaid
stateDiagram-v2
  [*] --> 无房间
  无房间 --> 房间大厅: CREATE_ROOM / JOIN_ROOM
  房间大厅 --> 场次配置: START_WORKSHOP_SESSION
  场次配置 --> 场次运行: 完成模式配置
  场次运行 --> 场次完成: 完成模式
  场次配置 --> 房间大厅: CANCEL_WORKSHOP_SESSION
  场次运行 --> 房间大厅: CANCEL_WORKSHOP_SESSION
  场次完成 --> 房间大厅: RETURN_TO_LOBBY
  场次完成 --> 场次配置: REPLAY_WORKSHOP_SESSION
  房间大厅 --> 无房间: LEAVE_ROOM
  房间大厅 --> 房间解散: DISSOLVE_ROOM
  场次配置 --> 房间解散: DISSOLVE_ROOM
  场次运行 --> 房间解散: DISSOLVE_ROOM
  场次完成 --> 房间解散: DISSOLVE_ROOM
  房间解散 --> [*]
```

房间与场次是两个生命周期：Room 在多个 Workshop Session 之间长期存在；一次 Session 完成或取消后成为不可变归档，Room 可以返回大厅再开始下一场。

## 2. 创建、加入与大厅

```mermaid
sequenceDiagram
  autonumber
  actor U as 微信用户
  participant C as RoomClient
  participant F as roomCommand
  participant T as CloudBase Transaction
  participant V as Member View

  alt 创建房间
    U->>C: CREATE_ROOM(profile, workshopName)
    C->>F: Command + commandId
    F->>T: 校验 ActiveByUser，分配 8 位 roomId
    T->>T: Room + Host@Seat1 + Event + Receipt
  else 加入房间
    U->>C: JOIN_ROOM(roomId, profile)
    C->>F: Command + commandId
    F->>T: 校验容量和 ActiveByUser，分配最小空席
    T->>T: Member + Event + Receipt
  end
  F-->>C: Outcome
  C->>C: 读取 Snapshot
  C-->>V: 完整 Member View
```

| 操作 | Command | 权限/结果 |
|---|---|---|
| 创建 | `CREATE_ROOM` | 当前没有开放房间；创建者成为 Host、Seat 1 |
| 加入 | `JOIN_ROOM` | 当前没有其他开放房间；房间未满；重复加入只更新本人资料 |
| 改房间名 | `UPDATE_ROOM_PROFILE` | Host |
| 改本人资料 | `UPDATE_MEMBER_PROFILE` | Member 本人 |
| 调整席位 | `REORDER_SEATS` | Host；必须提交当前全量成员且席位唯一 |
| 踢人 | `KICK_MEMBER` | Host；不能踢自己 |
| 离开 | `LEAVE_ROOM` | 非 Host Member |
| 解散 | `DISSOLVE_ROOM` | Host；终止当前房间连接 |

```mermaid
flowchart TD
  JOIN[JOIN_ROOM]
  ACTIVE{调用者已有开放房间?}
  SAME{就是目标房间?}
  CAP{成员数 < 6?}
  SEAT[分配最小空席]
  UPDATE[更新本人资料，不新增成员]
  REJECT[ALREADY_IN_ROOM / ROOM_FULL]

  JOIN --> ACTIVE
  ACTIVE -->|否| CAP
  ACTIVE -->|是| SAME
  SAME -->|是| UPDATE
  SAME -->|否| REJECT
  CAP -->|是| SEAT
  CAP -->|否| REJECT
```

## 3. 场次创建与公共配置

场次开始时冻结当前成员为 `Session Participant`。此后加入房间的人只成为旁观成员，不进入本场进度集合。

```mermaid
flowchart TD
  START[START_WORKSHOP_SESSION]
  MODE{Mode}
  SPY[SPY_INTRO]
  CHOOSE[CHOOSE_SCENARIO]
  SOURCE{Scenario Source}
  COLLECT[COLLECT_DESIGN_PROBLEMS]
  SELECT_PROBLEM[SELECT_DESIGN_PROBLEM]
  SELECT_FIRST[SELECT_FIRST_PLAYER]
  CONFIRM_FIRST[CONFIRM_FIRST_PLAYER]
  PARTNER[PARTNER_TURN]
  HALLI[HALLI_ACTIVITY]

  START --> MODE
  MODE -->|SPY| SPY
  MODE -->|PARTNER / HALLI_GALLI| CHOOSE
  CHOOSE --> SOURCE
  SOURCE -->|PARTNER 且非 OFFLINE| COLLECT
  COLLECT --> SELECT_PROBLEM --> SELECT_FIRST
  SOURCE -->|PARTNER OFFLINE| SELECT_FIRST
  SOURCE -->|HALLI 任意来源| SELECT_FIRST
  SELECT_FIRST -->|PARTNER| CONFIRM_FIRST --> PARTNER
  SELECT_FIRST -->|HALLI_GALLI| HALLI
```

公共配置 Command：

```text
START_WORKSHOP_SESSION
SET_SCENARIO
SUBMIT_DESIGN_PROBLEM
UPDATE_DESIGN_PROBLEM
SELECT_DESIGN_PROBLEM
SELECT_FIRST_PLAYER
CONFIRM_FIRST_PLAYER
CANCEL_WORKSHOP_SESSION
```

设计问题在收集完成前互不可见；进入选择问题步骤后，完整列表才进入公共 View。返回上一步会清理不再合法的选择与进度，旧 `workflowStep/entityVersion` 令牌随后失效。

## 4. Partner

### 4.1 主循环

```mermaid
stateDiagram-v2
  [*] --> PARTNER_TURN
  PARTNER_TURN --> PARTNER_TURN: 评分 / 匿名表达 / 素材 / HELP_LUCK / MASTER
  PARTNER_TURN --> PARTNER_TURN: SILENT 开始或结束
  PARTNER_TURN --> PARTNER_STATEMENT: 全部有效评分完成，Host 开始表态
  PARTNER_STATEMENT --> PARTNER_TURN: Host 归档 Turn 并开始下一 Turn
  PARTNER_TURN --> PARTNER_CLOSING_VOTE: 当前行动者使用 CLOSING
  PARTNER_CLOSING_VOTE --> PARTNER_TURN: 任一有效成员 question
  PARTNER_CLOSING_VOTE --> PARTNER_CLOSING_RUNE: 全部有效成员 pass
  PARTNER_CLOSING_RUNE --> PARTNER_CLOSING_REVIEW: Host 推进
  PARTNER_CLOSING_REVIEW --> COMPLETED: Host 完成场次
```

```mermaid
flowchart LR
  TURN[Active Turn]
  SCORE[非行动者唯一 Score]
  MSG[匿名 Message]
  ART[TEXT / IMAGE / VOICE Artifact]
  STATEMENT[Statement Result]
  SUMMARY[不可变 Turn Summary]
  BOARD[Leaderboard]

  TURN --> SCORE
  TURN --> MSG
  TURN --> ART
  SCORE --> STATEMENT --> SUMMARY
  ART --> SUMMARY
  SUMMARY --> BOARD
```

| Command | 规则 |
|---|---|
| `SUBMIT_PARTNER_SCORE` | 非当前行动者提交 0～10 半星单位，同一 Turn 每人一次 |
| `POST_PARTNER_MESSAGE` | 非行动者可在出牌阶段表达；参与者可在表态讨论阶段表达 |
| `APPEND/UPDATE/REMOVE_ARTIFACT` | 使用 `operationId` 和 `entityVersion` 保证重试、编辑和删除正确 |
| `START_PARTNER_STATEMENT` | Host 且全部当前 required 评分完成 |
| `ADVANCE_PARTNER_TURN` | Host 提交 `allPass/partialPass/allQuestion`，归档旧 Turn 并创建下一 Turn |
| `USE_PARTNER_SPECIAL` | 仅当前行动者；每个 Turn 一次：`HELP_LUCK/SILENT/MASTER/CLOSING` |
| `END_PARTNER_SILENT` | Host 或当前行动者；结束 5 分钟静默窗口 |
| `SUBMIT_PARTNER_CLOSING_VOTE` | 发起者自动通过，其他有效参与者各投 `pass/question` |
| `ADVANCE_PARTNER_CLOSING` | Host 从 Rune 推进 Review |
| `COMPLETE_PARTNER_SESSION` | Host 在 Review 完成场次并生成排行榜 |

Partner 的 `roundNo` 只在所有当前有效参与者各完成一个 Turn 后递增，而不是每次换人都递增。

### 4.2 收尾裁决

```mermaid
flowchart TD
  CLOSE[CLOSING]
  VOTE[其他有效参与者投票]
  COMPLETE{全部 required 已提交?}
  QUESTION{存在 question?}
  RETURN[归档 CLOSING_QUESTIONED<br/>开始下一 Turn]
  RUNE[归档 CLOSING_ACCEPTED<br/>进入 Rune]
  REVIEW[Review]
  DONE[Session Completed]

  CLOSE --> VOTE --> COMPLETE
  COMPLETE -->|否| VOTE
  COMPLETE -->|是| QUESTION
  QUESTION -->|是| RETURN
  QUESTION -->|否| RUNE --> REVIEW --> DONE
```

## 5. Halli Galli

```mermaid
stateDiagram-v2
  [*] --> CHOOSE_SCENARIO
  CHOOSE_SCENARIO --> SELECT_FIRST_PLAYER: SET_SCENARIO
  SELECT_FIRST_PLAYER --> HALLI_ACTIVITY: SELECT_FIRST_PLAYER
  HALLI_ACTIVITY --> HALLI_CREATIVE: END_HALLI_ACTIVITY
  HALLI_CREATIVE --> HALLI_CREATIVE: 每位参与者提交或更新自己的创意
  HALLI_CREATIVE --> HALLI_SUMMARY: 全部有效参与者已提交
  HALLI_SUMMARY --> COMPLETED: COMPLETE_HALLI_SESSION
```

Halli 的线下卡牌活动本身不按每次翻牌写入云端；V3 只同步活动阶段、首位参与者、创意提交进度和汇总结果。进入 `HALLI_ACTIVITY` 时线下游戏已经开始，活动页保留原业务操作“结束游戏”；该操作提交 `END_HALLI_ACTIVITY` 后，所有成员依据新的 `view.route` 进入创意阶段。

```mermaid
flowchart LR
  A[END_HALLI_ACTIVITY]
  P[requiredMemberIds = 当前有效参与者]
  I[SUBMIT_HALLI_IDEA<br/>每人一条，可更新]
  READY{required 全部提交?}
  SUMMARY[公开所有 Ideas]
  COMPLETE[Host 完成 Session]

  A --> P --> I --> READY
  READY -->|否| I
  READY -->|是| SUMMARY --> COMPLETE
```

## 6. Spy

```mermaid
stateDiagram-v2
  [*] --> SPY_INTRO
  SPY_INTRO --> SPY_SPEAK: Host 分牌并随机发言顺序
  SPY_SPEAK --> SPY_SPEAK: 当前发言者结束，推进下一位
  SPY_SPEAK --> SPY_VOTE: 发言完成或 Host 强制开票
  SPY_VOTE --> SPY_TIE_SPEAK: 最高票并列
  SPY_TIE_SPEAK --> SPY_VOTE: 并列者重新发言后再开票
  SPY_VOTE --> SPY_RESULT: 未决胜负
  SPY_VOTE --> SPY_SETTLED: 卧底或平民获胜
  SPY_RESULT --> SPY_SPEAK: START_NEXT_SPY_ROUND
  SPY_SETTLED --> SPY_SPEAK: RESTART_SPY_GAME
  SPY_SETTLED --> COMPLETED: COMPLETE_SPY_SESSION
```

```mermaid
flowchart TD
  START[START_SPY_GAME<br/>至少 3 人]
  DEAL[每人一个私密 Actor View]
  SPEAK[ADVANCE_SPY_SPEAKER]
  VOTE[OPEN / SUBMIT_SPY_VOTE]
  RESULT{票型}
  TIE[并列者重新发言]
  ABSTAIN[全员弃票，无淘汰]
  ELIM[淘汰最高票成员]
  WIN{卧底数为 0<br/>或卧底数 >= 平民数?}
  SETTLED[公开全员身份与词语]
  NEXT[下一轮]

  START --> DEAL --> SPEAK --> VOTE --> RESULT
  RESULT -->|并列| TIE --> VOTE
  RESULT -->|无目标票| ABSTAIN --> NEXT
  RESULT -->|唯一最高票| ELIM --> WIN
  WIN -->|否| NEXT --> SPEAK
  WIN -->|是| SETTLED
```

Spy 隐私规则：

- 分牌后，每名成员只在自己的 `actor.privateModeState` 看到身份、词语和说明。
- 公共 Event 只有语义类型和公共补丁，不包含任何密牌 payload。
- 中途淘汰只公开被淘汰成员身份，不公开词语或其他成员身份。
- 只有 `SPY_SETTLED` 才公开全员身份和词语；个人投票选择始终不进入公共 View。
- 服务器用自己的时间裁决 2 分钟投票截止；过期目标票按弃票记录。

## 7. 成员变化中的原子处理

```mermaid
flowchart TD
  EXIT[LEAVE_ROOM / KICK_MEMBER]
  ROOM[从 Room Members 移除]
  PARTICIPANT[Session Participant 标记 LEFT]
  MODE{当前步骤}
  CANCEL[配置期人数不足则取消 Session]
  PARTNER[Partner: 缩减评分/投票 required<br/>行动者离开则归档 ABANDONED 并换人]
  HALLI[Halli: 缩减创意 required<br/>首位离开则选择下一有效参与者]
  SPY[Spy: 移出发言/投票<br/>重新判定推进与胜负]
  EVENT[与退出 Event 同一事务提交]

  EXIT --> ROOM --> PARTICIPANT --> MODE
  MODE --> CANCEL
  MODE --> PARTNER --> EVENT
  MODE --> HALLI --> EVENT
  MODE --> SPY --> EVENT
  CANCEL --> EVENT
```

已经离开的参与者留下的历史事实用于归档回看，但不会继续计入当前 `required/submitted` 集合或投票裁决。

## 8. 完成、回大厅、重玩与历史

```mermaid
flowchart LR
  RUN[Current Session]
  DONE[COMPLETED / CANCELLED<br/>Archived Session]
  LOBBY[Room 保持 OPEN<br/>currentSessionId = null]
  REPLAY[新 Session<br/>新 sessionId / ordinal]
  HISTORY[History / Session / Leaderboard]

  RUN --> DONE
  DONE -->|RETURN_TO_LOBBY| LOBBY
  DONE -->|REPLAY_WORKSHOP_SESSION| REPLAY
  DONE --> HISTORY
```

- 完成、取消、回大厅、重玩或解散时，旧 Session 与 Facts 作为归档保存；新场次不会复用旧的业务标识。
- History 按 `ordinal` 分页；精确回看按 `sessionId` 获取独立 Snapshot，不切换当前 RoomClient 活跃连接。
- 被踢、离房或房间解散后的原参与者仍可读取自己的归档场次，但不能继续读取当前房间。

## 9. View 与页面跟随

```mermaid
flowchart LR
  STATE[Workflow Step]
  ACTOR[Actor Role / Participant / Capabilities]
  ROUTE[route.name + params]
  PAGE[业务页面]
  STATE --> ROUTE
  ACTOR --> ROUTE --> PAGE
```

页面名不是业务状态。Host 和 Player 均依据 `Member View.route` 跟随流程；写指令成功后若本地 View 尚未到达该指令的 `committedThroughSeq`，客户端先刷新 Snapshot，再跟随权威 Route，不猜测下一页面。本地预览、弹层、输入草稿、焦点和滚动位置可以暂时覆盖导航表现，但不得反向修改权威 Workflow。

## 10. 端到端验收矩阵

```mermaid
flowchart LR
  CMD[业务 Command]
  AGG[Aggregate @ M]
  EVENT[Snapshot@N + Events N+1..M]
  SNAP[Snapshot@M]
  EQ{Member View 完全相等?}
  UI[route + page model 可还原]

  CMD --> AGG
  AGG --> SNAP --> EQ
  CMD --> EVENT --> EQ
  EQ -->|是| UI
  EQ -->|否| FAIL[测试失败]
```

| 模式/范围 | 自动化验收 |
|---|---|
| Halli 主链：情境、首位、活动、创意、汇总、完成 | [`v3-business-flow-e2e.test.js`](../tests/room-domain/v3-business-flow-e2e.test.js) |
| Partner 主链：完整配置、行动、评分、表态、换轮、收尾、排行榜 | [`v3-business-flow-e2e.test.js`](../tests/room-domain/v3-business-flow-e2e.test.js) |
| Spy 主链：分牌、逐人发言、投票、结算、完成 | [`v3-business-flow-e2e.test.js`](../tests/room-domain/v3-business-flow-e2e.test.js) |
| Halli 离房、门槛缩减、重玩与归档 | [`v3-halli-flow.test.js`](../tests/room-domain/v3-halli-flow.test.js)、[`v3-room-lifecycle.test.js`](../tests/room-domain/v3-room-lifecycle.test.js) |
| Partner 特殊行动、两种收尾票型、离房、容量边界 | [`v3-partner-flow.test.js`](../tests/room-domain/v3-partner-flow.test.js) |
| Spy 弃票、平票、超时、淘汰、离房、隐私 | [`v3-spy-flow.test.js`](../tests/room-domain/v3-spy-flow.test.js) |
| 页面交互、路由跟随、Snapshot 恢复 | [`tests/ui`](../tests/ui)、[`v3-client.test.js`](../tests/room-client/v3-client.test.js) |

每条主链在每个 Command 前保存 Snapshot，Command 后按顺序消费公共补丁和本人 Actor
补丁，再与最新 Snapshot 做深度相等比较；同时校验完整 Member View、Route 与 Page Model。
