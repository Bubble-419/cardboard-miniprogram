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

> 公共参考副本放在仓库根目录 `cloud-common/`（不在 `cloudfunctions/` 下，避免被当成云函数上传）。各云函数目录内仍保留独立的 `partnerRoundContent.js` 供部署打包。

## 依赖

- 腾讯云账号已开通 [语音识别 ASR](https://cloud.tencent.com/product/asr)
- 一句话识别：每月 5000 次免费额度
