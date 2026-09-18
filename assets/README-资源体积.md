# 图片/音频资源体积说明

小程序代码质量要求：代码包里只放必要的小图标（如导航、状态、头像框）；单张以及合计体积过大的插图、音频应放到云存储，用 HTTPS URL 引入。

## 当前策略

1. **代码包内保留**
   - 小图标、SVG、默认头像等 UI chrome。
   - 体积小、首屏立刻需要、且不适合远程拉取的资源。
   - Halli 步骤 PNG：作为 WebP CDN 失败时的随包降级。

2. **云存储 CDN（`miniprogram-static/` 根目录）**
   - Spy 交互卡 WebP、等待页 hero、首页历史空状态、模式封面、Halli 步骤 WebP。
   - 对象 key 为文件名，例如 `miniprogram-static/wait-hero-5a8ea5.webp`。
   - 本地文件仍在仓库，由 `project.config.json` 的 `packOptions.ignore` 排除出代码包。
   - 页面通过 `utils/staticCdn.js` 的 `staticCdnUrl()` 引用。

3. **发布前确认**

```bash
pnpm upload:static
```

若本机没有 `tcb` CLI 或腾讯云密钥，在云开发控制台把文件传到 `miniprogram-static/` 根目录（只保留文件名），并保证该前缀可读。

## 推荐做法

1. **优先使用 WebP**
   - 微信小程序支持 `<image src="xxx.webp">`。
   - 同画质下比 PNG 小约 25%～35%。
   - 工具：[Squoosh](https://squoosh.app)、`cwebp` 命令行。

2. **大图不要打进代码包**
   - 超过约 20K 的插图优先走 CDN。
   - 新增插图时同步改 `utils/staticCdn.js` / `scripts/upload-static-cdn.js` / `packOptions.ignore`，并保证云上文件名不冲突。

3. **其他格式**
   - **JPG**：无透明通道的插图/照片可用。
   - **PNG**：仅用于小图标；大图改 WebP 后上传 CDN。
