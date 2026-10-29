# LanmiaoTV 品牌标志

用户提供的蓝猫 IP，保留原图配色、线条、表情和底部原有裁切；移除白底与顶部文字。
该素材为确定性像素抠图，不是生成重绘，也没有扩画/虚构脚部。

- `lanmiao-cat.png`：原生 250×210 透明 PNG，UI 统一引用。
- `lanmiao-cat-icon.png`：128×128 透明浏览器图标。
- `lanmiao-cat-apple.png`：180×180 Apple 图标。
- 全局图标还提供根路径 PNG / ICO / 内嵌 PNG 的自包含 SVG 兼容文件。
- 原始 IP 图保存在 `tests/fixtures/brand/lanmiao-ip-source.png`；工作区修改前的旧文件备份位于忽略的 `.runtime/lanmiao-brand/previous/`。

统一入口：`src/components/brand/NoriBrandMark.tsx` 与 `src/lib/brand.ts`。
重建命令：

```sh
node scripts/build-lanmiao-brand-assets.mjs tests/fixtures/brand/lanmiao-ip-source.png
```

使用者明确要求以此 IP 替换产品标志。这里不改变产品名称、模型标识、
业务账号或项目素材，也不代表用户授权重新设计 IP。
