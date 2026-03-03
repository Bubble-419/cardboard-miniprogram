流程与页面拆分
页面流转（你当前要做的部分）

aaa（测试页）：先不做真实“选情境”，只做一个 白底 + 按钮 的测试页

点击按钮 → 调用云函数创建房间，拿到 roomId

navigateTo 跳转到 addPlayer，携带 roomId

addPlayer：展示“添加成员”的房间页

中间：该房间的小程序码/二维码（带 roomId 的 scene）

周围：成员头像 沿圆周均分排列

头像下：成员名按 玩家1、玩家2、玩家3… 顺序显示

当前登录用户的名字后追加 “（我）”
addPlayer 页面 UI 说明（建议规范）
布局结构

整个页面白底（#fff）

顶部：标题“添加成员”（可用原生导航栏或自定义）

主视觉区（居中）：

中心码图：一个圆角白卡片里放二维码图片（建议 220–260rpx）

外环：以二维码中心为圆心，半径 R（建议 260–320rpx）摆放成员头像

成员头像样式：

头像圆形 72–88rpx

头像下方名字 24–26rpx，灰黑色

当前用户名字：玩家k（我）

空位状态（如果还没满员）：

可显示默认“随机头像占位”或“虚线头像框”

你描述的是“随机头像按圆形均分排列在二维码周围”，那就一开始先给 N 个占位头像也可以（比如 6 个）。

均分规则（核心）

假设当前展示 n 个成员（或占位）：

每个成员的角度：angle = startAngle + i * (2π / n)

头像中心点坐标：

x = centerX + R * cos(angle)

y = centerY + R * sin(angle)

头像容器用 position:absolute，通过计算得到 left/top。

3）云开发生成“房间二维码/小程序码”的方式（推荐做法）

微信小程序“带参数进房间”一般用 小程序码（getUnlimited），它支持 scene 参数（长度≤32），非常适合放 roomId。

方案 A（推荐）：云函数调用 OpenAPI 生成小程序码

前端：请求云函数 createRoom

云函数：

生成并写入 roomId（DB 记录房间信息）

调用 cloud.openapi.wxacode.getUnlimited 生成小程序码

page: 你希望扫码进入的页面（例如 pages/addPlayer/addPlayer 或 pages/room/room）

scene: 传 roomId（可做 rid=xxxx）

返回：roomId + 码图片的 cloudFileID（或临时链接）

扫码进入时：

被打开的页面 onLoad(options) 会拿到：

options.scene（如果是扫码进入）

或者你自己 navigateTo 传的 roomId