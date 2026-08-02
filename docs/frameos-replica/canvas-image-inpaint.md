# 无限画布蒙版重绘契约

无限画布的“涂抹改图”使用严格的 Inpaint 链路，不允许把蒙版降级成普通参考图。

## 请求与任务字段

- API 请求必须包含 `processType: "image_edit"` 和独立的 `maskMaterialId`。
- `referenceMaterialIds` 必须只包含一张原始图片，禁止包含蒙版素材。
- API 在创建 `FrameosToolboxAsset` 或 `Task` 前验证模型的 `supportsInpaint` 能力；未知或不支持的模型直接返回 400。
- Task payload 显式保存 `processType: "image_edit"`、`editMode: "inpaint"`、`maskImage` 和 `maskMaterialId`。

## Worker 与 Provider

- Worker 分别规范化原图和蒙版的存储地址，并再次校验模型能力与单源图约束。
- OpenAI-compatible provider 只通过标准 `images.edit` 请求提交 Inpaint；蒙版传入独立的 `mask` 字段。
- 兼容模板、自定义普通图片生成端点，以及不支持蒙版的 provider 均不能作为降级路径。
- 提交前会把 FrameOS 黑白蒙版转换为 OpenAI alpha 语义：白色涂抹区为透明（编辑），黑色区域为不透明（保留），并将蒙版尺寸对齐到原图像素尺寸。没有可编辑像素的蒙版会被拒绝。

## 能力声明

模型只有在中央 capability catalog 中显式声明：

```json
{
  "capabilities": {
    "image": {
      "supportsInpaint": true
    }
  }
}
```

才会在改图节点中可选。当前标准链路仅为可访问 `/images/edits` 的 `openai-compatible::gpt-image-1` 声明该能力；自定义 provider ID 通过 provider-key fallback 复用这一声明。

