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

## 验证

```bash
pnpm test
pnpm build:cloud
git diff --check
```
