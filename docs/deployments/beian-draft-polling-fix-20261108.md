# 2026-11-08 编辑框轮询保护与 2.5 参考上限动态化

## 变更范围

- FosProductionShot / FosStoryboard 加入 hydration guard（`hydratedIdRef` + `dirtyRef`），切换镜头/片段才完整水合，dirty 时跳过服务器回灌；轮询只合并 videoUrl/imageUrl/lipSyncVideoUrl 任务态字段，不再覆盖正在输入的 prompt 或剧情文字。
- MentionPromptEditor 用 rAF 合并 scroll、去掉 150ms blur 定时器；`replacePromptMention` 收紧子序列匹配，避免中文/重名场景误替换。
- SceneTextEditor 改用原生 `maxLength`、keydown 只拦画布快捷键；CreativeNode 编辑中忽略外部 value，三者共同消除光标跳动/内容回滚。
- CanvasGenerator 显式构建 draftPatch、parameters 加入依赖数组，避免草稿串扰旧值。
- toolbox-video-task-handler 按 `resolveBuiltinCapabilitiesByModelKey` + `resolveCanvasGenerationInputSchema` 推导参考上限，替代硬编码 15；Seedance 2.5 实际放开到 50。
- `standards/capabilities/kuaizi.catalog.json` 为 2.5 补充 `video/audio maxTotalDurationSeconds: 30`；`validateCanvasReferenceMedia` 同步校验参考视频总时长。
- FosStoryboard 前端配额文案由 9/3/3 改为按当前模型动态显示；FosToolbox 草稿恢复按 referenceTotalLimit 裁剪并提示。
- Prisma：`frameos_materials.personalOwnerId`（可空 String VarChar(191)）+ 复合索引，配合素材归属回填。
- 仓库清理：将 `public/* 2.*` 五个 Finder 副本从索引中移除（文件保留本地）。

## 验证

- 源码 `tsc --noEmit` 0 错误、ESLint 0 错误。
- 聚焦单测 63 + 35 + 17 + 9 + 5 + 18 全过；material-interactions 浏览器回归 28 项 passed；toolbox-regeneration 通过。
- prisma validate 通过；`git diff --check` 通过。
- 服务器构建 `npm run build` 成功；候选镜像校验 hydration 守卫字符串、HuiMeng/OpenLux 标准、Prisma client 与 projectLeader/personalOwnerId 字段。
- schema-diff 仅 1 行 `ALTER TABLE frameos_materials ADD COLUMN personalOwnerId VARCHAR(191) NULL`；`prisma db push` 后 schema-after 为空。
- 切换前活动生成任务为 0；备份业务数据库与受保护配置。
- 切换后 app/admin 均 healthy、billing=ENFORCE、test-mode=OFF、TOS 守卫与上传/读/签名读/删除探针通过。
- 受保护配置文件与备份逐字节一致；`frameos_materials.personalOwnerId` 列已存在。

## 发布

- 基础镜像：`norivideo:release-20261108-creative-platform`。
- 候选镜像：`norivideo:release-20261108-draft-polling-fix`。
- 源指纹：`e11937cf7835aee3becde8ea533d542c7b0137b7771ae5f01c5ad5a26be96b3c`。
- 源包 SHA256：`4bbae84b159830edd8e261ad6dff539fd9facdaa0a58bbe753e5549d05b57478`。
- 制品 SHA256：`b1ba11477223bf40bb1711896b454eb198d52502bff2b04cbb27dadda8c76ed2`。
- 镜像 ID：`sha256:e6798d85658775fe0c4845f918b2ab48be8ad5204de08824aee68074768b02b6`。
- 发布包排除服务密钥配置、软著材料、`.runtime/`、`docs/测试输出/` 及全部 `* 2.*`/`* 3.*`/`* 4.*` Finder 副本。
- 构建依赖沿用已验证的 Tailwind `4.1.13` 本地缓存。
- 服务器使用 `--network none` 构建；切换前 schema diff 仅为 additive `personalOwnerId` 列，已执行 `prisma db push` 同步。
- 仅重建 app/admin，自动健康检查与失败回滚沿用部署脚本。

## 回滚

- 重新将 `norivideo:release-20261108-creative-platform` 标记为 `norivideo:latest`，仅重建 app/admin。
- 数据库变更仅为 additive 列 + 索引，可保留；切换前备份位于 `/opt/norivideo/backups/20261108-draft-polling-fix/`。
