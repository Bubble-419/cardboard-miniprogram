你是一名资深微信小程序 + 云开发工程师。请基于微信开放接口 getQRCode（实际接口：POST /wxa/getwxacode） 或云调用 cloud.openapi.wxacode.get，为“小程序进入指定房间”的业务生成小程序码（二维码）。

目标

小程序端传入 roomId（房间号/房间ID），获取一个可以扫码进入对应房间页面的小程序码图片。

必须在服务端调用（云函数），前端不能直接请求微信接口。

云函数返回图片二进制或可用的临时链接，前端可展示/保存。

约束与要求

调用位置

必须在云函数（Node.js）里调用：

云调用方式：cloud.openapi.wxacode.get({ path, width, env_version, ... })

或 HTTPS：POST https://api.weixin.qq.com/wxa/getwxacode?access_token=ACCESS_TOKEN

请优先给出云调用方式实现（云开发环境）。

path 参数

必填，最大 1024 字符，不能为空，不能包含 scancode_time。

需要把房间参数带到页面路径中，例如：

pages/room/index?roomId=xxxxx

说明：如果是分包页面，也要给出正确的 path。

返回内容

微信接口成功会直接返回图片二进制（Buffer）。

云函数要把图片返回给小程序端，方式二选一（都给出更好）：

A）把 Buffer 转成 base64 返回，前端用 data:image/png;base64, 展示

B）把 Buffer 上传到云存储，返回 fileID + getTempFileURL 临时链接供展示（推荐）

需要解释两种方式优缺点。

参数与配置

云函数需要校验 roomId 是否存在且合法（非空、长度限制、字符限制）。

允许前端可选传入 width（默认 430，范围 280~1280），env_version（默认 release）。

如果用 HTTPS 方式获取 access_token，需要说明 APPID/APP_SECRET 从云函数环境变量读取（例如 process.env.APP_SECRET）。

错误处理

若微信返回 JSON 错误（包含 errcode/errmsg），要能识别并返回给前端。

需要处理常见错误码：40001 / 40159 / 45029 / -1 / 85096，并给出对应排查建议。

云函数返回结构统一，例如：

{ ok: true, fileID, tempUrl }
{ ok: false, errCode, errMsg }


小程序端调用示例

给出小程序端如何调用云函数（wx.cloud.callFunction）并展示二维码（image 组件）。

若返回 base64：如何展示与保存到相册（需要 wx.saveImageToPhotosAlbum 的流程）

若返回 tempUrl：如何直接 <image src="{{tempUrl}}"/>

输出格式

请输出以下内容（必须包含完整可运行代码）：

云函数：generateRoomQrcode（Node.js）完整代码（含 cloud.init、参数校验、调用 wxacode.get、上传云存储、返回值）

小程序端调用示例（JS + WXML 片段）

配置说明：

云函数环境变量 APP_SECRET 如何配置（如果你用 HTTPS 获取 token）

小程序页面 path 应如何填写

常见错误排查清单（按错误码逐条给）