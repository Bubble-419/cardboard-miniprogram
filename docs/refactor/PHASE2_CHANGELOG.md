# Phase 2 落地说明（分支 `refactor/room-protocol-v2`）

## 交付

- 根目录 pnpm workspace：`packages/room-contracts|room-domain|room-application|room-cloudbase-adapter`
- RoomKernel 竖切命令：`CREATE_ROOM` / `JOIN_ROOM` / `LEAVE_ROOM` / `REORDER_SEATS` / `DISSOLVE_ROOM` / `UPDATE_MEMBER_PROFILE`
- 命令信封校验、稳定错误码、`commandId` 幂等、`expectedRevision`
- 内存契约测试：`pnpm test`
- 云函数 `roomCommand`：源码在 `src/entry.js`，部署前 `pnpm build:cloud` 生成 `index.js` bundle

## 与现网关系

- **未切换**客户端调用；旧 `roomCreate` / `roomJoin` / `roomLeave` 仍服务 V1 房间
- `roomCommand` 创建的房间带 `protocolVersion: 2`、`revision`、`seatMap`、`lifecycle`
- 同时写 `roomMembers`，便于后续与 `getAddPlayerData` 兼容演进

## 本地命令

```bash
pnpm install
pnpm test
pnpm build:cloud
```

## 上传

仅当你要试用 V2 命令入口时上传 `roomCommand`（需先 build）。Phase 1 云函数清单不变。

## 下一步（Phase 3）

- `roomQuery` head/snapshot
- V2 索引与迁移脚本
- Presence 独立集合
