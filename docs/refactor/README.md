# 房间协议优化重构

本目录存放 2026-08-01 审查与重构蓝图，实施以 [REFACTORING_BLUEPRINT_2026-08-01.md](./REFACTORING_BLUEPRINT_2026-08-01.md) 为准。

## 分支

`refactor/room-protocol-v2`（自 `april` 切出）

## 进度

- Phase 0/1：见 [PHASE1_CHANGELOG.md](./PHASE1_CHANGELOG.md)
- Phase 2：见 [PHASE2_CHANGELOG.md](./PHASE2_CHANGELOG.md)
- Phase 3：见 [PHASE3_CHANGELOG.md](./PHASE3_CHANGELOG.md)

## 冻结规则（Phase 0）

重构期间禁止：

1. 新增 `updateRoomState` 字段
2. 新增 Page 级业务轮询
3. 用房间号代替权限校验
4. 在查询中写心跳、删成员或修复进度（Presence 须独立）
5. 导航前吞掉云端 `{ ok: false }`
6. 在 `rooms` 中追加新的无限增长数组

## 阶段优先级

数据正确性与权限 > 协议一致性 > 可观测性 > 渲染稳定性 > 布局一致性 > 云成本 > WebSocket

## 文档索引

| 文件 | 用途 |
| --- | --- |
| CONTEXT.md | 领域术语 |
| REVIEW_REPORT_2026-08-01.md | P0/P1 缺陷与证据 |
| TENCENT_CLOUD_COST_RESEARCH_2026-08-01.md | 轮询与成本 |
| REFACTORING_BLUEPRINT_2026-08-01.md | 分阶段实施方案 |
| PHASE1_CHANGELOG.md | Phase 1 落地说明 |
| PHASE2_CHANGELOG.md | Phase 2 落地说明 |
| PHASE3_CHANGELOG.md | Phase 3 落地说明 |
