# Phase 6 落地说明（分支 `refactor/room-protocol-v2`）

## 本 slice 交付

### 客户端读路径（本步）

- `utils/spyMode.js`：`startSpyRoomPoll` / `stopSpyRoomPoll` 挂 App 级 RoomSession
- **首屏仍走页面自己的 `refresh()`**；轮询 `emitCurrent: false`，避免进页同步 setData 打布局
- 同房只 `reconfigure` 间隔，不 dispose 重建
- `packageSpy` 各局内页已切换；写路径仍是 `roomCommand`
- Halli 未动

### 契约 / 领域 / 仓储（此前已交付）

- Spy 命令矩阵、`roomSecrets`、词库、`_.set` 落库修复

## 真机检查清单（Spy 读路径）

- [ ] 大厅人数刷新正常、头像横排
- [ ] 开局 → 发言页词卡/头像正常
- [ ] 房主开票 → 成员自动跟进投票页
- [ ] 投票进度人数更新
- [ ] 结算/结果页跟页与重启
- [ ] 从大厅进 Spy 再回大厅，RoomSession 不异常

## 上传提示

本步主要是小程序端；云函数无需因读路径重传。
