---
status: proposed
---

# 房间同步采用权威状态加短期有序事件

房间协议采用服务端事务维护的权威状态和短期有序事件日志，客户端通过一致 Snapshot 加后续 Event 还原成员视图；它不是从创世事件重放状态的完整事件溯源。每个 Command 使用 `commandId` 幂等，核心 State、Event 与 Command Receipt 在同一事务提交；不使用全局 `expectedRevision` 作为业务前置条件，而使用 `sessionId`、`turnId`、`voteSessionId` 等领域上下文令牌拒绝过期意图。该选择以一次性序列化房间内可见变化和增加事件存储为代价，换取短请求乱序、并发写入、重试和断线恢复下的确定性。
