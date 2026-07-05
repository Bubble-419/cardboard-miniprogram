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
cd cloudfunctions/speechToText
npm install
```

然后在微信开发者工具中右键上传并部署 `speechToText`、`finalizePartnerTurnRecord`，以及更新后的 `updateRoomState`、`getAddPlayerData`。

> 云函数部署只会打包各自目录内的文件，`cloudfunctions/_shared/` 不会自动上传，因此公共逻辑已复制到各云函数目录下的 `partnerRoundContent.js`。

## 依赖

- 腾讯云账号已开通 [语音识别 ASR](https://cloud.tencent.com/product/asr)
- 一句话识别：每月 5000 次免费额度
