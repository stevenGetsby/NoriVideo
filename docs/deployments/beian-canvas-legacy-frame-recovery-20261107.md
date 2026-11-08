# 2026-11-07 画布旧离线草稿恢复修复

## 根因与变更

- 生产持续出现 `PUT /api/projects/.../canvas/.../document` 400，导致生成前自动保存检查抛出“画布仍有未保存的更改”。该提示是保存失败的结果，不是根因。
- 字段级只读诊断定位到受影响画布本地恢复文档第 71 条连线：`scope=edge`、`index=70`、`field=role`。该 edge id 不在数据库，来自浏览器 IndexedDB 未同步草稿。
- 离线恢复及序列化仅将旧版 `VIDEO_FRAME` 迁移为服务端允许的 `REF`；未知角色仍保留并拒绝，未放宽服务端白名单。
- 为 document 路由增加字段级诊断，仅记录节点/连线 id、索引、错误类别及字段名，不记录 prompt、素材内容或密钥。
- 未修改 Prisma schema，未修改或恢复生产画布业务数据。

## 验证

- `tests/unit/canvas/video-comparison.test.ts` 与 `tests/unit/canvas/document.test.ts`：16 项通过。
- 真实 CanvasGraph headless Chromium 注入 IndexedDB 旧草稿，点击“恢复本地”：旧 `VIDEO_FRAME` 在全量 PUT 前转换为 `REF`，22 个本地节点和 2 条连线完整保留，保存响应为 200。
- 恢复文档通过真实 `validateCanvasDocumentSaveInput()`；浏览器无未捕获异常，未创建付费生成任务。
- 生产只读观察截至 18:32：最后一次受影响画布旧角色校验失败为 18:27，之后暂未出现新错误。旧标签页仍运行旧 JS，用户需刷新并选择“恢复本地版本”后才能确认其真实草稿恢复。

## 发布顺序

1. `norivideo:release-20261107-canvas-document-diagnostic`
   - 源指纹：`28980cabecf0ba404be3d36f4775628bec28159b0daa9dc6cce03c1e9db9364a`
   - 制品 SHA256：`3063bde69a4e23edb2b8f5eaa5af54fcd84e4626c69c2e507f5e519cecdf3c98`
   - 定位到无效连线，未改业务数据。
2. `norivideo:release-20261107-canvas-document-field-diagnostic`
   - 源指纹：`c51ad781913cc4265efbd845a1b96ccb1aff76ea253029b852b9579c050b33d0`
   - 制品 SHA256：`efb13b4a69b158d1b0abe2576331b86a5495fc11c2f1d1eb135908bd944286a0`
   - 进一步确认无效字段为 `role`。
3. `norivideo:release-20261107-canvas-legacy-frame-recovery`
   - 源指纹：`f5a1c20c6eda71c54a7646a672545736c86b97543178b25b3ef96abde4c0d76b`
   - 制品 SHA256：`c19b76b3df6e524929401754c87f4e8b34a1f2971b50c0dea136f29abc35cfde`
   - 镜像 ID：`sha256:6d0b5e47c25e5838345b4f102cfbc01750223cff7df3515a14ede8348ce8a45f`
   - 相比字段诊断版仅修改 `src/features/canvas/CanvasGraph.tsx` 与 `src/features/canvas/editor-types.ts`。

## 发布保护与回滚

- 各阶段均使用受保护发布流程和 `--network none` 构建；切换前活动生成任务为 0。
- 保留业务数据库与受保护配置备份，schema diff 无变更；未覆盖服务器现有数据。
- 最终 app/admin 均为最终镜像且 healthy，billing=ENFORCE、test-mode=OFF，TOS 守卫通过。
- 回滚时将 `norivideo:release-20261107-canvas-document-field-diagnostic` 标记为 `norivideo:latest`，仅重建 app/admin；无数据库回退。
- 最终备份保留在 `/opt/norivideo/backups/20261107-canvas-legacy-frame-recovery/`。
