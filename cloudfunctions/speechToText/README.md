# speechToText 云函数

## 环境变量（微信云开发控制台 → 云函数 → speechToText → 配置）

| 变量名 | 说明 |
|--------|------|
| `TENCENT_SECRET_ID` | 腾讯云 API 密钥 SecretId |
| `TENCENT_SECRET_KEY` | 腾讯云 API 密钥 SecretKey |
| `TENCENT_ASR_REGION` | 可选，默认 `ap-shanghai` |

**切勿将密钥写入代码仓库。** 若密钥已泄露，请在腾讯云控制台立即禁用并轮换。

## 部署

```bash
pnpm --dir cloudfunctions/speechToText install
```

先在仓库根目录执行 `pnpm build:cloud`，再在微信开发者工具中上传并部署 `speechToText`。该函数只鉴权和转写；转写结果由客户端通过 `APPEND_ARTIFACT` 写入 V3 房间事务。

> `index.js` 是构建产物，不要直接编辑；源文件位于 `src/entry.js`。

## 依赖

- 腾讯云账号已开通 [语音识别 ASR](https://cloud.tencent.com/product/asr)
- 一句话识别：每月 5000 次免费额度
