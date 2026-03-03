0. 当前问题与本 PRD新增目标

现状问题：主页点击「创建房间」后，经常/总是出现“创建失败”。
PRD新增目标：在不改变主要交互的前提下，补齐：

创建失败的可观测性（错误码/日志/上报）

创建房间链路的容错兜底（前端生成 roomId、离线写入、重试）

云开发下的标准实现路径（DB 写入、用户标识、幂等）

1. 角色定义

上帝（God）：创建房间的人，默认拥有房间/工作坊配置权限与发起权限

玩家（Player）：加入房间的人，仅参与脑暴流程

2. 目标

让用户在主页一键创建房间并进入“发起工作坊（set-room）”设置页，配置（可选）工作坊名称/头像/昵称后点击“发起”，进入下一步 Select Mode 页面。

3. 页面与模块范围

主页：包含入口按钮（通过组件 create-room 实现）

组件：create-room（创建房间并跳转）

页面：set-room（创建工作坊设置页）

下一页：select-mode（已存在，本 PRD仅描述跳转触发与传参）

4. 用户流程（User Flow）

用户在主页点击「创建房间」

创建房间（生成 roomId / 写入房间记录 / 写入创建者成员记录 role=GOD）

创建成功后跳转 set-room：/pages/set-room/index?roomId=xxx

set-room 页面可选配置：

工作坊名称（可跳过）

头像（可选）

昵称（可选）

点击「发起」→ 更新工作坊配置 → 房间状态置为 STARTED → 跳转 select-mode（携带 roomId）

5. 功能需求一：create-room 组件（首页按钮）
5.1 功能概述

create-room 组件负责：

渲染“创建房间”按钮

点击后创建房间（云函数/云数据库写入）

成功跳转 set-room 页面

5.2 交互与状态

默认：可点击

点击后：

loading：按钮置灰 + “创建中…”

success：跳转 set-room

fail：toast “创建失败，请重试”，按钮恢复可点

5.3 新增关键需求：创建失败的可观测性（必须）

创建失败不能只 toast，需要能定位原因。
要求：失败时必须拿到并记录：

errMsg（原始错误信息）

errCode（若有）

当前网络状态（可选）

roomId（若已生成）

上报方式（云开发）：

console.error（开发期）

可选：写入 logs 集合（线上排查）

5.4 新增关键需求：幂等与重试（必须）

幂等键：clientCreateId（前端生成 uuid/时间戳+随机数）

云函数 roomCreate 接收 clientCreateId：

若该 clientCreateId 已创建过房间 → 直接返回原 roomId（避免重复房间）

前端重试策略：

首次失败允许用户点击重试

重试时携带同一个 clientCreateId（实现幂等）

5.5 数据与输出

输入：用户点击

输出：

roomId（唯一标识）

创建者 userId/openid（云开发：使用 OPENID）

创建者 role=GOD

初始化工作坊字段（可空）

5.6 跳转与传参

跳转：/pages/set-room/index?roomId=xxx

roomId 必传

6. 功能需求二：set-room 页面（创建工作坊页）
6.1 页面目标

让上帝在发起前完成工作坊基础配置，并在点击“发起”后进入下一流程。

6.2 页面元素与交互
A. 工作坊名称输入框（可跳过）

placeholder：设置工作坊名称

规则：可为空；1~20 字（建议）；trim 首尾空格

清除按钮：有内容显示，点击清空

B. 头像（点击更换，可选/可先不落库）

默认：占位头像（现阶段允许为空）

点击弹出：相册/拍摄

选择后：本地预览更新

若上传失败：toast 提示并回滚（如果你暂时不做上传，则点击提示“功能开发中”也可）

C. 昵称（点击修改，可选/可先不落库）

默认：显示“默认微信名称”或“未设置昵称”

点击编辑：弹窗输入（推荐）

校验：1~12 字，禁止全空格（若你现阶段允许为空，则仅在 V2 开启强校验）

D. 发起按钮

点击后：

更新 WorkshopConfig（可只提交 workshopName）

更新房间状态：STARTED

跳转：/pages/select-mode/index?roomId=xxx

防重入：submitting 期间置灰

7. 新增关键需求：创建房间必须同时写入“创建者成员记录”（避免后续邀请页空）

即使你暂时不展示头像昵称，成员通道要打通：

RoomMember { roomId, userId, role, nickName?, avatarUrl?, joinedAt }

创建房间成功时必须写入第一条 RoomMember（GOD）

8. 数据模型（建议）
8.1 Room

roomId: string

status: "CREATED" | "STARTED" | "ENDED"

creatorId: string

createdAt: number

updatedAt: number

clientCreateId: string（幂等）

8.2 RoomMember

roomId: string

userId: string

role: "GOD" | "PLAYER"

nickName?: string（可空）

avatarUrl?: string（可空）

joinedAt: number

8.3 WorkshopConfig（可挂 room 上）

roomId: string

workshopName?: string（可空）

godNickName?: string（可空）

godAvatarUrl?: string（可空）

9. 云开发实现路径（解决“创建失败”的核心）

你现在点击创建失败，最常见原因来自：

没有启用云开发或未初始化 wx.cloud.init

云函数未部署/名称不一致

云数据库权限规则不允许写入

云函数里未返回正确结构导致前端判失败

未获取 OPENID（没用 getWXContext）或使用了不存在的字段

9.1 推荐：使用云函数创建房间（最稳）

前端：wx.cloud.callFunction({ name: 'roomCreate', data: { clientCreateId }})

云函数做两件事（原子性更好）：

写入 Room

写入 RoomMember（GOD）

并返回 { roomId }

这样可以规避前端直接写 DB 的权限问题（权限规则更容易设置为“仅云函数可写”）。

9.2 云函数需要具备幂等

先用 clientCreateId 查 Room 是否已存在

存在就直接返回原 roomId

不存在再创建

9.3 失败处理与日志

云函数 catch error：

console.error(error)

返回 { ok:false, errMsg, errCode }

前端 toast 同时打印日志

10. 异常与边界情况（补强）

创建失败：toast + 记录 errMsg/errCode + 支持重试（同 clientCreateId）

set-room 无 roomId：toast“参数错误”+ 返回主页

发起失败：toast + 保留输入内容 + 可重试

防重复：创建中/提交中按钮置灰 + 云端幂等兜底

11. 埋点（可选）

home_create_room_click

room_create_success/fail（包含 errMsg）

workshop_start_click

workshop_start_success/fail

12. 验收标准（AC，更新版）

首页点击创建房间：成功跳转 set-room，并且后端/DB存在 Room 记录

Room 创建时：自动写入一条 RoomMember（role=GOD）

创建失败时：toast + 控制台/日志能看到明确 errMsg

set-room 工作坊名可不填，点击发起仍能进入 select-mode

创建房间支持重试且不产生重复房间（幂等生效）