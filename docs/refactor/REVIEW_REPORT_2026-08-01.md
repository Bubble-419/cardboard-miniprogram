# Cardboard 微信小程序代码审查报告

审查日期：2026-08-01  
审查基线：`4a8fe1e`（分支 `april`）  
审查范围：`prd/`、小程序页面与组件、`utils/`、31 个云函数、路由与工程配置  
限制：本次为静态审查，未连接真实云环境，也未在微信开发者工具或真机上复现。报告区分“已确认代码缺陷”和“高风险候选根因”。本次没有修改业务代码。

## 1. 执行摘要

当前问题并非单纯的“按钮事件没绑定”或“某几个 CSS 值不合适”，核心风险集中在联机状态协议：成员身份、房间状态、投票/评分、在线状态分别由多个读写接口维护，但缺少统一状态机、版本号、幂等键和原子更新。弱网、后台切换或多人同时操作时，客户端会自然进入不一致状态。

三个已知症状中：

| 症状 | 最相关根因 | 结论 |
| --- | --- | --- |
| 按钮偶尔无法点击 | 重复/隐藏成员让评分门槛永远达不到；旧轮询响应覆盖新状态；云函数返回业务失败后页面仍跳转；全屏引导/输入遮罩在部分状态下拦截触摸 | 存在已确认缺陷，也有需真机验证的遮罩风险 |
| 部分设备布局异常 | 自定义导航栏有三套安全区算法；关键页面使用固定高度、绝对定位和 `overflow:hidden`；固定 footer 未统一纳入可用高度计算 | 已确认实现不具备完整响应式约束 |
| 横向卡片切换闪烁 | 游戏页高频 `setData` 与全量状态轮询；`swiper` 内嵌 `scroll-view`、原生输入控件和 canvas；选情境页同时动画 swiper 子树与原生 `textarea` | 高置信根因，仍需设备矩阵确认各项占比 |

代码中的 WXML 事件处理函数静态扫描未发现普遍缺失，`drag-mask` 默认也是 `pointer-events:none`。因此不建议把排查重点继续放在“补 bindtap”上，应优先修协议一致性和渲染更新粒度。

## 2. 优先级定义

- **P0**：会造成联机状态错误、数据丢失、关键流程无法继续或明显越权，发布前应处理。
- **P1**：会造成高频交互故障、设备兼容问题、闪烁或流程分叉，应在近期迭代处理。
- **P2**：工程一致性、可维护性和潜在故障，宜随治理工作一并处理。

## 3. 已确认缺陷

### P0-01 房间加入非原子、无人数上限，成员编号可重复

证据：

- `cloudfunctions/roomJoin/index.js:83-128` 先查本人、再读取全体成员，最后单独插入，没有事务或唯一约束。
- `cloudfunctions/roomJoin/index.js:120` 使用 `members.length + 1` 分配 `playerIndex`。
- `pages/main-pages/addPlayer/index.js:44` 和 `:524-527` 明确只支持 6 个槽位，并直接截断第 7 个及后续成员。
- `cloudfunctions/getGameScoreStatus/index.js:50-63` 却按服务端全部成员计算 `totalRequired`，评分人数再按用户去重。

影响：

1. 两台设备并发加入时可能得到相同 `playerIndex`。
2. 同一用户的重复请求也可能生成两条成员记录。
3. 中间成员退出后，例如成员编号为 `[1, 3]`，下一位仍会得到 `3`。
4. 服务端允许超过 6 人，客户端只显示前 6 人。隐藏成员仍计入评分门槛，房主的“开始表态”会一直 disabled。

建议：使用事务分配成员席位；服务端强制最多 6 人；对 `(roomId, userId)` 和 `(roomId, playerIndex)` 建立唯一性保障；席位从可用集合 `{1..6}` 中分配，而不是使用数组长度。

### P0-02 查询接口会在 90 秒后永久删除其他成员

证据：

- `cloudfunctions/getAddPlayerData/index.js:13-14` 将离线阈值设为 90 秒。
- `cloudfunctions/getAddPlayerData/index.js:81-153` 在查询中刷新当前用户心跳，并删除其他超时的非房主成员。
- `cloudfunctions/getAddPlayerData/index.js:275-280` 每次读取房间快照都会执行该逻辑，删除后还可能回退游戏进度。

影响：用户切后台、锁屏、授权头像、选照片或弱网超过 90 秒就可能被永久移出。任何成员的一次查询都可触发对其他成员的删除。这会表现为头像突然消失、按钮条件改变、页面被拉回或提示“不在房间”。

建议：查询必须无副作用；presence 使用独立记录和 `online/offline/lastSeenAt`，超时只标记离线。真正移除成员只能由本人退出、房主踢出或房间结束命令完成。

### P0-03 房间状态写接口权限过宽，且没有版本控制

证据：

- `cloudfunctions/updateRoomState/index.js:180-183` 注释声明“仅房间创建者可调用”。
- `cloudfunctions/updateRoomState/index.js:230-244` 实际允许任意房间成员继续执行。
- `cloudfunctions/updateRoomState/index.js:261-298` 允许成员推进轮次并设置 `currentPage`。
- `cloudfunctions/updateRoomState/index.js:384-390` 可直接设置当前玩家和成员数。
- `cloudfunctions/updateRoomState/index.js:439-443`、`:457-459`、`:593-610` 对大师模式、疑问玩家、计时锚点没有完整的角色限制。
- `cloudfunctions/updateRoomState/index.js:613-615` 最终直接覆盖房间记录，没有 `revision` / compare-and-set。

影响：普通成员可以推进或回退主流程；弱网下较旧请求晚到会覆盖较新状态；多台房主设备或重复点击会重复换轮。当前代码虽对部分字段单独限权，但接口整体仍无法保证“命令是否合法”。

建议：不要继续扩充万能写接口。改为显式命令，例如 `selectScenario`、`startRound`、`submitRoundNote`、`advancePhase`；服务端状态机校验角色、当前阶段、会话号和允许转换。每个命令携带 `commandId` 与 `expectedRevision`，成功后原子递增 `revision`。

### P0-04 评分与清分接口存在越权和并发重复

证据：

- `cloudfunctions/submitGameScore/index.js:39-63` 读取房间和成员后只阻止出牌者自评，没有验证调用者属于该房间。
- `cloudfunctions/submitGameScore/index.js:65-92` 使用“先查后新增”，并发请求可插入同一用户的重复评分。
- `cloudfunctions/finalizePartnerTurnRecord/index.js:52-60` 按数据库行数求平均，重复记录会扭曲分数。
- `cloudfunctions/clearRoomScores/index.js:11-47` 没有读取 OPENID，也没有房主校验，知道 `roomId` 即可清空评分。
- `cloudfunctions/getGameScoreStatus/index.js:27-71` 和 `cloudfunctions/getLeaderboard/index.js:13-73` 同样没有成员鉴权。
- `cloudfunctions/roomStartWorkshop/index.js:10-48` 也没有读取调用者身份或校验房主，知道 `roomId` 即可把房间置为 `STARTED` 并修改工作坊名称。

影响：非成员评分可提前满足开始表态条件；双击/重试会改变最终平均分；任意调用者可清空某房间分数或改变房间状态。8 位数字房间号不应被当作授权凭据。

建议：所有接口先做统一 `assertRoomMember/assertHost`；评分以 `(roomId, sessionSeq, round, targetPlayerIndex, scorerUserId)` 为幂等键执行 upsert；清分仅允许房主，且优先通过开始新 session 隔离旧记录，不做同步逐条删除。

### P0-05 多个协作操作存在丢更新窗口

证据：

- `cloudfunctions/submitClosingVote/index.js:82-109` 读取整个票箱、在内存追加，再于 `:168` 整体覆盖；两人同时投票会互相覆盖。
- `cloudfunctions/postPartnerExpress/index.js:73-83` 对表达消息执行“读取数组 -> concat -> 整数组覆盖”。
- `cloudfunctions/finalizePartnerTurnRecord/index.js:62-85` 对回合记录执行整对象覆盖。
- `cloudfunctions/speechToText/index.js:81-93` 对语音记录执行整对象覆盖。
- `cloudfunctions/updateRoomState/index.js:273-283`、`:483-590` 对轮次摘要和当前内容执行读改写。

影响：并发投票、聊天、图片/文字纪要、语音转写或归档时，最后完成的请求会覆盖先完成的请求。丢票会让“全员已表态”永远无法达成，丢内容则通常只能在用户反馈后发现。

建议：投票、评分、消息、素材分别使用独立文档，按事件追加；需要聚合的房间字段使用事务和 revision。数组只作为读模型/缓存，不作为并发写入的事实源。

### P1-01 核心游戏页的轮询与渲染更新过重，能直接诱发闪烁

证据：

- `pages/main-pages/partnerMode/gamepage/index.js:1654-1722` 每 800ms 请求 `getAddPlayerData({full:true})`，无 in-flight guard、响应序列号或取消机制。
- `pages/main-pages/partnerMode/gamepage/index.js:1308-1362` 构造包含成员、全部回合、图片、聊天、卡片集合、分页点和 `cardIndex` 的大 patch。
- `pages/main-pages/partnerMode/gamepage/index.js:1478-1517` 已有 fingerprint 去重，这是有效缓解；但任何内容变化、滑动索引变化或阶段变化仍会整包 `setData`。
- `pages/main-pages/partnerMode/gamepage/index.js:1530-1556` 更新后还同步计时、语音并重新测量抽屉。
- `pages/main-pages/partnerMode/gamepage/index.js:683-725` 每 250ms 对两个未在 WXML 中绑定的计时字段调用 `setData`；头像计时 canvas 又在 `components/user-list/index.js:366-372` 独立每 200ms 绘制。
- `pages/main-pages/partnerMode/gamepage/index.wxml:238-875` 的 swiper 子树包含长列表、嵌套 `scroll-view`、图片和交互输入。
- `cloudfunctions/getAddPlayerData/index.js:168-211`、`:383-405` 每次调用还可能转换成员头像和二维码临时 URL。

量级：单个游戏端基础状态轮询约 75 次/分钟，评分轮询另约 20 次/分钟；6 台设备约 570 次云函数调用/分钟，尚未计倒计时到期后的 350ms burst poll。

影响：低端 Android 上容易出现 swiper 合成层重建、手势中断、输入焦点丢失和主线程卡顿。慢请求超过 800ms 时会并发，旧响应可晚于新响应回写。

建议：轮询只取 `{revision, page, phase}` 轻量头；revision 变化后再拉取按域拆分的数据。加入单飞锁和单调响应序号。`setData` 只更新变化路径，不携带 `cardIndex` 和 swiper 数据源，除非卡片集合确实变化。页面级 250ms `setData` 改为组件内 canvas/本地变量。

### P1-02 多处云函数业务失败被吞掉，客户端仍然跳页

证据：

- `pages/main-pages/partnerMode/confirmFirstPlayer/index.js:145-158` 的 `_updateRoomState` 捕获异常且不返回结果。
- 同文件 `:222-240` 在 `await` 后无条件跳转，外层 `catch` 无法感知云端业务失败。
- `pages/main-pages/selectPlayer/index.js:95-107` 同样吞掉更新失败；`:428-465` 不等待同步便 `redirectTo`。
- `pages/main-pages/selectBG/index.js:115-156` 即使返回 `{ok:false}` 也继续跳转。
- `pages/main-pages/modeIndex/index.js:150-162`、`:261-298` 采用同一模式。

影响：主屏看到已经进入下一页，副屏仍停留在旧页；随后轮询又可能把主屏拉回。用户会理解为按钮无效、点了没反应或页面闪回。

建议：统一云调用适配器，把 `{ok:false}` 转为异常；命令成功后才导航；按钮操作期间设置明确 pending 状态并防重复；失败时保留当前页并提供重试。

### P1-03 设计问题存在两套数据协议

证据：

- `cloudfunctions/submitDesignProblem/index.js:8` 写入 `roomDesignProblems`，且 `:48-57` 未写 `entryType`。
- `cloudfunctions/getDesignProblems/index.js:7-8`、`cloudfunctions/updateDesignProblem/index.js:8-9` 读取 `designProblems` 且要求 `entryType=designProblem`。
- `utils/roomDesignProblems.js:3-4` 也使用后一套协议，并在 `:47-75` 从客户端直接写数据库。
- `pages/main-pages/submitProblem/index.js:1-4` 当前页面调用的是客户端直写 helper，绕过 `submitDesignProblem` 云函数。

影响：调用不同入口会得到不同提交进度；云函数权限模型与数据库安全规则模型不一致。若数据库规则允许当前直写，客户端还可能伪造 `playerIndex/nickName`；若规则收紧，现有主流程会直接失败。

建议：保留一个集合和一个提交命令；用户身份与 playerIndex 只能由服务端根据 OPENID 推导；补数据迁移和唯一键 `(roomId, sessionSeq, userId, entryType)`。

### P1-04 路由注册存在大小写错误和未注册页面

证据：

- `app.json:36` 注册 `pages/leaderboard/index`，实际目录为 `pages/Leaderboard/index`。
- `utils/pageNavigate.js:38`、`utils/subAwaitRoutes.js:115` 和 `:260` 延续了错误大小写。
- 静态扫描发现以下页面目录未在 `app.json` 注册：`pages/main-pages/createRoom/index`、`setRoom/index`、`firstplayer/index`、`pages/sub-pages/selectProblem/index`，以及大小写不一致的 `pages/Leaderboard/index`。
- `pages/main-pages/createRoom/index.js:69-137` 多处跳转到未注册的 `setRoom`。
- `components/invite-entry/index.js:19-48` 默认跳转目标 `/pages/add-player/index` 不存在；当前组件未发现外部引用，属于潜伏缺陷。

影响：macOS 默认大小写不敏感会掩盖 leaderboard 问题，CI、构建缓存或大小写敏感文件系统中会失败。旧流程一旦重新接入会直接报页面不存在。

建议：建立单一 route 常量表，由 `app.json` 生成/校验；CI 同时校验精确大小写、页面注册和所有静态跳转目标。明确删除或恢复旧页面，避免半存活流程。

### P1-05 固定画布与绝对定位无法适配短屏、横屏和大字号

证据：

- `pages/main-pages/addPlayer/index.wxss:2-8` 页面禁止溢出；`:314-349` 在剩余区域内绝对定位 `660rpx` 圆盘。
- `pages/main-pages/selectBG/index.wxss:2-8` 预留固定 `220rpx` footer；`:129-137` swiper 固定 `680rpx`；`components/page-footer/index.wxss:1-7` footer 固定在视口底部。
- `pages/main-pages/selectPlayer/index.wxss:82-110` 把提示与触摸区固定在 `280rpx/440rpx`，底部再保留 `250rpx`。
- `pages/main-pages/selectPlayer/index.js:163-218` 直接保存 viewport `clientX/clientY`；没有依据 `.touch-area` 的 rect 做归一化，布局变化或旋转后状态语义不稳定。

影响：iPhone SE 类短屏、Android 导航栏高度差异、系统大字号、键盘弹起和横屏时会出现裁剪、footer 盖住卡片、触摸区高度过小或视觉触点偏移。

建议：所有主页面使用统一 page shell；通过 `windowHeight - nav - footer - safeArea - keyboard` 得到可用高度；圆盘和 swiper 使用 `min()/max()` 约束或 JS 测量后的 CSS 变量；触点存为交互区域内的归一化坐标。

### P1-06 自定义导航栏安全区策略不统一

证据：

- 全局 `app.json:43` 使用 `navigationStyle: custom`。
- `utils/capsuleTopBar.js:25-72` 和 `components/player-top-bar/index.js:87-114` 已有按胶囊位置计算的实现。
- 但 `pages/main-pages/addPlayer/index.wxss:51-56`、`partnerMode/gamepage/index.wxss:10-13` 等仍只使用 `env(safe-area-inset-top)`。
- `pages/main-pages/selectPlayer/index.wxss:9-17` 使用 `safe-area-inset-top - 18px` 的特殊公式。

影响：Android、全面屏、旧基础库和状态栏高度特殊的设备上，标题/返回按钮可能偏移或被胶囊遮挡。

建议：所有页面统一复用 `player-top-bar` 或同一个 page shell，不再在页面级手写顶部安全区公式。

### P2-01 共享云环境补丁改变了同步 API 语义，旧页面会崩溃

证据：

- `app.js:29-31` 将 `wx.cloud.database()` 改为返回 Promise。
- `utils/cloudDb.js:4-24` 已正确兼容该异步语义。
- 但 `pages/sub-pages/selectProblem/index.js:54`、`:118` 和 `pages/main-pages/createRoom/index.js:167` 仍同步调用 `db.collection()`。

影响：这些页面当前未注册，因此属于潜伏缺陷；一旦恢复旧流程会报 `db.collection is not a function`。

建议：禁止全局 monkey patch 公共 API；所有云能力通过项目自己的 adapter 暴露，旧页面要么删除，要么统一迁移。

### P2-02 仓库包含缺失资源引用

静态扫描确认以下文件不存在：

- `components/user-list/index.wxml:70`：`/assets/icons/add-icon.png`
- `pages/inspiration/index.wxml:26`：`link-icon.png`
- `pages/inspiration/index.wxml:47`：`check-icon.png`
- `pages/inspiration/index.wxml:62`：`play-icon.png`
- `pages/sub-pages/subAwait/index.wxml:6`：`back-arrow.png`

其中灵感页 AI 区当前受 feature flag 控制，部分资源可能暂不显示；`user-list` 的 add icon 取决于 `enableAdd`。仍应在构建期禁止缺失静态资源进入发布包。

### P2-03 云函数依赖不可复现，仓库还跟踪了 node_modules

证据：

- 31 个云函数都有独立 `package.json`，其中 24 个把 `wx-server-sdk` 写为 `latest`，例如 `cloudfunctions/updateRoomState/package.json:6-8`。
- 只有 7 个云函数有 lockfile；另有 3 个云函数的 `node_modules` 已被 Git 跟踪，共约 66 MB，尽管 `.gitignore:5-7` 明确要求忽略。
- `getInspiration` 等少数函数固定为 `~3.0.4`，与其他函数策略不一致。

影响：不同时间部署得到不同 SDK；本地、云端和不同函数之间行为不可复现，仓库体积及合并冲突也被放大。

建议：按项目约定使用 pnpm，建立 workspace 或统一部署脚本，锁定同一 SDK 版本；从版本控制中移除已跟踪依赖目录（后续实施时单独操作，不在本次报告中执行）。

### P2-04 多个轮询页只在 onUnload 停止定时器

例如 `pages/sub-pages/subAwait/index.js:39-45`、`pages/Leaderboard/index.js:30-57`、`pages/main-pages/modeIndex/index.js:64-75` 没有在 `onHide` 停止轮询。当前部分跳转使用 redirect，风险被掩盖；一旦页面通过 `navigateTo` 被覆盖，隐藏页仍会请求、`setData` 或发起导航。

建议：所有订阅/轮询遵循 `onShow start -> onHide stop -> onUnload stop`，并统一由一个 visibility-aware helper 管理。核心游戏页已经按此方式处理，可作为迁移起点。

## 4. 横向卡片闪烁专项判断

### 游戏页

`gamepage` 已经用 fingerprint 避免完全相同快照的重复 `setData`，因此“每 800ms 必然重建 swiper”并不准确。但以下组合仍然危险：

1. 轮询无单飞锁，慢网会产生并行请求和乱序响应。
2. 任意聊天、图片、纪要、成员头像或卡片索引变化都会更新一组很大的页面数据。
3. swiper 内同时存在滚动容器、图片、输入控件和自定义 canvas。
4. 页面另有 250ms 一次、目前没有视图绑定价值的 `setData`。
5. 卡片切换事件修改 `cardIndex`，下一次 room fingerprint 又包含该索引，容易在动画窗口内发生第二次数据提交。

建议先做性能埋点再改：记录每次 `setData` 的字段数、JSON 字节数、耗时、swiper 是否处于 changing 状态和当时 FPS。预计收益最大的调整顺序是：删除无用高频 `setData`；增加 poll 单飞/序列；把卡片索引从远端快照 patch 中隔离；按数据域增量更新；最后再处理 WXML 结构。

### 选情境页

`pages/main-pages/selectBG/index.wxml:25-45` 使用 swiper；`components/bg-card/index.wxss:2-16` 对 active/inactive 子树同时做 opacity 与 transform 动画；`components/bg-card/index.wxml:23-31` 每个 item 内含原生 `textarea`。swiper 自身动画、子树合成动画和原生输入层叠加，在部分 Android 设备上容易闪烁或抢手势。

建议只让当前卡渲染可编辑 textarea，非当前卡渲染普通文本占位；避免在 swiper item 根节点同时做 scale/opacity 过渡；输入聚焦时禁止切卡，切卡前主动 blur。

## 5. 按钮“偶尔点不动”专项判断

已确认的逻辑路径：

1. “开始表态”依赖 `scoredCount >= totalRequired`（`gamepage/index.js:1622-1635`）。重复成员、隐藏第 7 人、90 秒清理和非成员评分都会改变两侧计数，按钮状态自然不稳定。
2. 选择玩家、情境和首位玩家页面先本地跳转、后端同步失败不阻止导航，造成主副屏分叉，随后轮询表现为按钮无效或页面回跳。
3. 轮询乱序可把新的角色/阶段快照覆盖为旧值，使 handler 内的 `isHost/canConfirm/isCurrentPlayer` guard 直接 return。

需要真机验证的交互路径：

- `gamepage/index.wxml:956-990` 有两个全屏 mask。首次提示 mask 是设计行为；灵感聚焦 mask 会拦截输入栏之外的点击。应记录 mask 可见状态来确认线上“点不动”发生时是否有透明遮罩。
- `addPlayer/index.wxml:185-190` 的拖拽 mask 仅在 `isDragging` 时启用 pointer events；已有 3 秒 watchdog，不像常态根因。
- 原生 textarea、swiper 和 fixed footer 在 Android 上的层级/手势行为需真机确认，静态代码不能证明某一设备必现。

建议给所有关键按钮统一记录：`page/roomId/sessionSeq/revision/button/actionAllowed/disabledReason/maskState/pollInFlight`。不要只记录 tap handler 是否执行，否则无法区分触摸被遮挡、逻辑 guard return、云端失败和状态回滚。

## 6. 架构与 MVC 评估

当前实现没有清晰 MVC，更接近“大 Page 对象 + 大房间文档”：

- `pages/main-pages/partnerMode/gamepage/index.js` 3702 行、WXML 991 行、WXSS 2411 行。
- Page 同时承担路由、轮询、状态合并、领域规则、计时、手势、图片上传、语音、持久化和视图状态。
- `cloudfunctions/updateRoomState/index.js` 642 行，是一个宽接口；调用者需要了解大量字段组合和调用顺序。
- `getAddPlayerData` 同时查询、写心跳、删成员、修复进度、做权限判断、转换文件 URL 并投影多个游戏模式。

对原生小程序而言，建议采用轻量 MVVM/状态机，而不是机械套用传统 MVC：

```text
Page/View
  -> ViewModel（只负责页面交互态和格式化）
  -> RoomSession（订阅 snapshot、提交 command、处理重连）
  -> RoomStateMachine（服务端唯一领域规则）
  -> Repository/Cloud Adapter（真实云环境或内存测试实现）
```

核心模块应提供少量深接口：

- `joinRoom(profile)` / `leaveRoom()`
- `dispatchRoomCommand(command)`
- `subscribeRoomSnapshot(listener)`
- `dispose()`

建议快照协议：

```js
{
  roomId,
  revision,
  serverTime,
  sessionId,
  state: { page, phase, round, currentPlayerIndex },
  members,
  presence,
  capabilities: { canAdvance, canScore, canVote }
}
```

建议命令协议：

```js
{
  roomId,
  commandId,
  actorSessionId,
  expectedRevision,
  type,
  payload
}
```

页面不再自行推导“是否可点”，而是消费服务端下发的 capabilities；服务端拒绝命令时返回稳定错误码和最新 snapshot。这样能显著减少不同页面复制规则后产生的漂移。

## 7. 分阶段治理建议

### 第一阶段：立即止血（1-3 天）

1. 服务端限制最多 6 人，事务化 join，修复 playerIndex 分配和唯一性。
2. 停止在 `getAddPlayerData` 中删除成员，只保留心跳或拆成独立接口。
3. 给评分、清分、开始工作坊、排行榜等接口补成员/房主鉴权和幂等键。
4. 所有关键导航必须等待 `{ok:true}`，失败不离开当前页。
5. 给核心轮询加 in-flight guard 和响应序号；移除未绑定视图的 250ms `setData`。
6. 修正 leaderboard 大小写与缺失资源，决定旧页面是注册还是删除。

### 第二阶段：稳定联机协议（1-2 周）

1. 引入 room `revision/sessionId` 和命令状态机，列出每个角色允许的状态转换。
2. 投票、评分、消息、语音、素材改为独立文档及幂等 upsert/append。
3. 拆分轻量 room head 和各数据域快照，只有 revision 变化时拉取详情。
4. 统一云调用错误模型、重试策略、超时、日志关联 ID 和可观察指标。
5. 合并设计问题协议并迁移旧数据。

### 第三阶段：页面与布局治理（2-4 周）

1. 将 gamepage 拆为 RoomSession、GameViewModel、CardSwiper、ScorePanel、InspirationComposer、ClosingFlow。
2. 全站迁移统一导航栏/page shell，统一 safe area、键盘和 footer 高度。
3. swiper 仅持有展示节点；可编辑原生控件移出动画子树或只渲染 active item。
4. 建立响应式尺寸 token 和设备截图回归，不再按单一 Figma 画板写固定高度。
5. 建立 pnpm workspace、锁定依赖并清理已跟踪 node_modules。

## 8. 推荐测试与验收矩阵

### 协议与并发

- 6 台设备同时加入；第 2 人退出后再加入；同一用户双击加入；第 7 人加入必须得到明确 `ROOM_FULL`。
- 两人同时评分、重复提交同一评分、非成员评分、非房主清分。
- 2-6 人同时投 closing vote，重复投票和乱序到达，最终票数不得丢失。
- 同时提交消息、语音、图片和纪要，任何一项都不能被另一项覆盖。
- 请求延迟 0/500/2000/5000ms、响应乱序、重复请求、断网重连。
- 前后台切换 30/90/180 秒后，成员只变 offline，不应被删除。

### UI 与布局

- iPhone SE、常规 iPhone、灵动岛设备、主流低端/高端 Android、平板。
- 系统字体 100%/最大、深色模式、键盘弹起/收起、横竖屏切换（若产品允许）。
- 连续快速切换 swiper 50 次，同时接收聊天/评分/成员更新。
- 在 textarea 聚焦、选图、预览图、showLoading、首次引导 mask 状态下点击所有底部按钮。
- 视觉回归检查顶部胶囊、固定 footer、短屏裁剪、文本溢出和安全区。

### 自动化基线

- 状态机单元测试：角色权限、合法转换、不变量。
- 云函数集成测试：使用内存 repository 注入并发、超时和乱序。
- 路由/资源静态测试：注册、精确大小写、跳转目标、usingComponents、静态资源存在性。
- WXML 事件 handler、JSON 解析和 JS 语法检查纳入 CI。
- 关键页面用微信自动化/真机农场做截图和交互回归。

关键不变量建议直接写成测试断言：

- 同一房间 `userId` 和 `playerIndex` 唯一，成员数 `<= 6`。
- `revision` 只增不减；旧 revision 命令不得覆盖新状态。
- 只有服务端状态机能改变 page/phase/round/currentPlayer。
- 评分、投票按用户与 session 幂等。
- 查询接口不修改业务事实，不删除成员。

## 9. 本次静态验证结果

- 所有业务源码 JS 均通过 `node --check`。
- 所有非依赖目录 JSON 均可解析。
- WXML 事件绑定静态扫描未发现缺失 handler。
- 路由精确大小写、页面注册、静态资源和云函数名称已做只读扫描。
- 未发现现成单元测试、集成测试或小程序模拟器测试配置。
- 未做微信开发者工具编译、云函数部署、云数据库索引/权限规则检查和真机测试；这些属于剩余风险，不能用静态审查替代。
