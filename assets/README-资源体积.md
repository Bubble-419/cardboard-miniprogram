# 图片/音频资源体积说明

小程序代码质量要求：**单张图片/音频 ≤ 200K**，主包 ≤ 1.5M。大图会导致「图片和音频资源」不通过。

## 推荐做法

1. **优先使用 WebP**
   - 微信小程序支持 `<image src="xxx.webp">`。
   - 同画质下比 PNG 小约 25%～35%，容易满足 200K。
   - 工具：[Squoosh](https://squoosh.app)、`cwebp` 命令行。

2. **大图转换步骤（如 bg.png）**
   - 用 Squoosh 或 `cwebp -q 80 bg.png -o bg.webp` 生成 `bg.webp`。
   - 将 `bg.webp` 放到 `assets/icons/`，页面改为引用 `bg.webp`。
   - 可删除或不再打包原大 PNG，减小主包。

3. **其他格式**
   - **JPG**：无透明通道的插图/照片可用，体积小。
   - **PNG**：尽量压缩（TinyPNG、ImageOptim）或改用 WebP。

4. **头像等小图标**
   - 保持 PNG 时控制尺寸（如 200×200 内）并压缩，一般不会超 200K。
