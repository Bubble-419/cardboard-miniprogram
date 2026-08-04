# Phase 4 落地说明（分支 `refactor/room-protocol-v2`）

## 交付

- `packages/room-client`：`RoomSession`（单飞轮询、revision 丢弃、subscribe/pause/resume/dispose）
- `modules/room-session`：小程序 App 级会话桥接 + legacy `getAddPlayerData` transport
- `modules/room-navigation`：`projectRoute` + revision 导航协调器
- `app.js`：前后台 pause/resume RoomSession；`globalData.roomSession`
- 已迁移页面（去掉页内 `setInterval` 业务轮询）：
  - `addPlayer`
  - `modeIndex`
  - `selectPlayer`
  - `partnerMode/confirmFirstPlayer`

## 行为说明

- 同一 `roomId` 复用一个 RoomSession；页面 onHide 只退订，不销毁会话
- App onHide 暂停同步，onShow 恢复
- 离开/解散/失去成员资格时 `disposeRoomSession()`
- gamepage / statement 等游戏内页仍用原轮询（Phase 5 再迁）

## 测试

```bash
node --require ./scripts/test-register.js --test tests/room-client/*.test.js tests/room-domain/*.test.js tests/room-contract/*.test.js
```

## 真机建议回归

1. 建房进大厅 → 切后台再回 → 成员列表仍刷新
2. 副屏跟随：房主选情境 → 副屏从大厅跟到 modeIndex / selectPlayer
3. 确认首位后进 gamepage（副屏等待页应能跳转）
4. 退出/解散房间后不应残留后台轮询
