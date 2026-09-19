# Cardboard 小程序维护说明

请默认使用中文回答和编写面向维护者的说明。Node.js 依赖与脚本统一使用 `pnpm`，Python 工具统一使用 `uv`。

## 活跃文档索引

以下文档描述当前有效的房间协议 V3。理解或修改房间业务时，按顺序阅读：

1. [`CONTEXT.md`](./CONTEXT.md)：统一领域术语，先确认 Room、Member、Session、Participant、Turn 等词的含义。
2. [`docs/ROOM_SYSTEM_INDEX.md`](./docs/ROOM_SYSTEM_INDEX.md)：系统地图、代码入口以及其他活跃文档导航。
3. [`docs/ROOM_PROTOCOL_V3_IMPLEMENTATION.md`](./docs/ROOM_PROTOCOL_V3_IMPLEMENTATION.md)：V3 协议原则、Command、Snapshot、Event、View、恢复和权限边界；协议修改以此为主文档。
4. [`docs/ROOM_BUSINESS_FLOWS.md`](./docs/ROOM_BUSINESS_FLOWS.md)：大厅、公共配置、Partner、Halli Galli、Spy 和成员变化的当前业务流程。
5. [`docs/ROOM_MODEL_STATE.md`](./docs/ROOM_MODEL_STATE.md)：Room、RoomSession、Facts、Event Group、Member View 和瞬时状态的当前模型。
6. [`docs/ROOM_PROTOCOL_V3_DEPLOYMENT.md`](./docs/ROOM_PROTOCOL_V3_DEPLOYMENT.md)：集合、索引、权限、环境变量、云函数发布与真机验收。
7. [`docs/adr/0001-room-snapshot-event-protocol.md`](./docs/adr/0001-room-snapshot-event-protocol.md)：采用权威状态加短期有序 Event 的架构决策。

`prd/` 是产品需求输入，不是当前协议或实现规格；发生冲突时必须核对现行代码与上述活跃文档，不能直接按旧 PRD 推断运行行为。Git 历史承担旧方案、阶段计划和审查报告的归档职责，仓库不继续保留会误导维护者的过时技术文档。

## 文档维护规则

- 修改 `packages/room-contracts`、领域状态机、View 投影、持久化结构、云函数入口或部署资源时，必须在同一变更中更新对应活跃文档。
- 版本号只以 `packages/room-contracts/index.js` 为准；文档不得复制一个未经核对的版本。
- `Member View` 必须同时支持两条等价更新路径：Snapshot 完整替换和连续 Event Patch 增量归约。任何 View 字段变更都要同时检查 Snapshot projector、Event public/actor patch 和客户端 reducer。
- 只要 `Member View` 的结构或可观察语义发生不兼容变化，就必须在同一提交中提升 `packages/room-contracts/index.js` 的 `VIEW_SCHEMA_VERSION`，包括字段增删或类型变化、枚举含义变化、`route/params/navigation/capabilities` 等投影语义变化、Public/Actor Patch 语义变化，以及客户端 reducer 对字段解释的变化。升级后必须重新构建所有 V3 云函数，并验证旧版本 Event/Sync 会触发重新读取 Snapshot、旧版本 Snapshot 会被拒绝安装，不能继续增量归约。
- 页面只消费完整 `Member View`，不得根据 Snapshot 或 Event 来源走两套业务分支，也不得维护第二份权威房间状态。
- 业务流程变化更新 `ROOM_BUSINESS_FLOWS.md`；数据归属或不变量变化更新 `ROOM_MODEL_STATE.md`；协议接口、同步或恢复变化更新 `ROOM_PROTOCOL_V3_IMPLEMENTATION.md`；云资源变化更新部署文档。
- 不新增“计划”“阶段日志”“临时检查清单”作为长期架构文档。已经完成或废弃的内容直接删除，必要背景通过 ADR 或 Git 历史追溯。

## 架构与实现守则

### 房间网络协议

- 房间写操作统一走 V3 `Command`；页面和组件不得直写数据库、直接调用房间云函数，或另建一套轮询/同步协议。接线统一经过 `modules/room-session`、`RoomClient` 和导航协调器。
- 服务端以 Aggregate 为权威状态，并在同一事务提交 State、Event Group 与 Command Receipt。Event 是短期有序同步日志，不是服务端事实源；事件缺口、版本不兼容或水位矛盾时读取 Snapshot，禁止客户端猜测修补。
- `Member View` 是客户端唯一的房间业务模型。正常增量使用公共 Patch 加按成员扇出的 Actor Patch；首次进入、断线恢复和异常恢复使用完整 Snapshot。两条路径必须得到等价 View。
- 单个页面不得创建轮询器或缓存第二份房间状态。所有页面共享单一 `RoomClient`、串行请求队列和协议常量；自动 Sync 从上一 Command/Query 完成后重新静默 2 秒，页面切换不得紧接着重复拉 Snapshot。Presence 可独立降频，但跳过读取时必须通过 stale 语义保留上次成功投影。轮询间隔、批量上限、响应预算等不得散落为魔法数字。
- Command 重试必须复用原 `commandId`；指令结果携带的同步未追上提交水位时，先恢复权威 View 再导航。`roomSignal` 只承载有作用域、可过期的辅助瞬时信号，不得成为第二条状态同步通道。
- 公共数据才进入 Public View/Event；私密信息必须在服务端按调用成员投影。新增字段时同时审查 Snapshot projector、Public/Actor Patch、客户端 reducer、权限与响应体积。

### View、UI 与组件

- 页面只根据完整 `PageSnapshot/Member View` 渲染，不得依据“本次来自 Snapshot 还是 Event”分支，不得从页面路径、按钮点击或本地计时器反推业务状态。
- 服务端业务状态与本地 UI 状态分离：草稿、焦点、键盘高度、手势、动画和临时叠层留在本地；无关的 View 刷新不得重建输入节点、清空草稿或中断当前交互。
- View 中任何可见字段的变化都必须触发对应 UI 更新；不能只比较 route、卡片 ID 或粗粒度指纹。Master/Silent、评分、表态、渐进公开等效果必须在 Snapshot 安装和 Event 归约后表现一致。
- 复杂页面优先拆成低耦合展示模块：模块通过小接口接收模型、发出语义意图，不持有 `RoomSession`，不调用 Command，不自行导航。页面或 RoomShell 负责订阅、命令和路由编排。
- 异步按钮统一使用交互锁并展示明确进行中状态；成功、失败、超时和微信导航无回调都必须释放锁。禁止用固定延时假设云函数或页面跳转已经完成。
- 业务后退执行 `view.navigation.back` 或语义化返回工具，校验预期上一页并提供权威 URL fallback；不可逆运行态禁用物理返回。不要用裸 `navigateBack` 伪造业务状态倒退。

### RoomShell 与导航

- 逻辑 Route 与微信物理页面不要求一一对应。多个连续屏幕共享大量本地状态且切换频繁时，优先用稳定 RoomShell 原地切屏，避免依赖 `redirectTo` 的页面销毁和竞态；不要为无关联页面扩大 Shell 边界。
- RoomShell 通过纯 projector 将最新 `view.route.name + params` 映射成屏幕模型。订阅回调先原子安装完整 PageSnapshot，再协调全局导航；同物理路径返回 `SAME_ROUTE` 时仍必须刷新 Shell。
- 在线 Shell 首屏保持无交互加载态，禁止按 URL 参数猜业务屏幕；导航与各 Shell projector 必须共用同一个 Route 分类器。离开 Shell 边界时先进入无交互过渡态并停止旧屏幕副作用，导航失败仍保留重试水位。
- Shell 不维护第二份业务状态，不以生命周期、计时器或临时叠层猜测当前屏幕。旧 revision 必须丢弃；相同 route 下的可见字段变化仍需刷新，不能被游戏区优化吞掉。
- 屏幕副作用按当前 Shell screen 启停：等待页、投票页不得启动游戏计时、录音等副作用。离开 Shell 的权威 Route 交还全局导航处理，不能闪回旧游戏屏幕。
- 本地叠层不是新 Route。完成后优先关闭叠层并恢复下层 Shell；页面栈不符合预期时，才使用有超时的权威 URL 重建路径。

### 输入框与软键盘

- 每个原生 `input/textarea` 必须显式声明 `adjust-position` 和合适的 `cursor-spacing`，新增输入控件时同步扩展键盘可见性测试。
- 普通流式或卡片内输入优先使用系统避让：`adjust-position="{{true}}"`。贴底、悬浮输入栏需要精确贴住键盘时使用手动避让：`adjust-position="{{false}}"`、绑定该输入框的 `keyboardheightchange`，并复用 `utils/keyboardAvoidance.js`。
- 系统避让与手动位移只能二选一。手动方案只采用原生事件给出的 px 高度，只移动一层容器；不要再叠加全局键盘监听、估算高度或多层 `fixed/transform`。
- blur、关闭叠层和页面卸载时清零键盘高度并释放焦点。双击头像、切卡等非输入手势不得隐式聚焦或拉起软键盘；草稿与焦点不能因房间同步被覆盖。
- 开发者工具可验证输入路径和模拟 `keyboardheightchange`，但不能替代 iOS/Android 真机键盘、刘海屏与安全区验收。

### 测试与部署约束

- 协议或 View 变化至少覆盖：Snapshot/Event 等价、事件缺口恢复、断线重连、重复 Command、权限投影、路由矩阵和全部业务模式；Shell 变化还需覆盖同页切屏、旧 revision、页面返回和屏幕副作用。
- 修复“卡页”或视觉效果时先补可复现测试，再修根因；不得用额外轮询、固定延时、强制 `reLaunch` 或页面本地状态机掩盖协议/导航问题。
- `pnpm build:cloud` 只生成云函数产物，不代表已经部署。云函数部署必须确认目标环境，并且只有用户明确要求时才更新云端；部署后使用多账号覆盖相关业务路径。

## 验证

```bash
pnpm test
pnpm build:cloud
git diff --check
```
