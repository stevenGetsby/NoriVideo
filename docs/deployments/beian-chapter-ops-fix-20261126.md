# 备案机发布影游章节编辑/删除、跨章节粘贴与画布保存循环修复（2026-11-26）

- 范围：影游章节节点支持编辑名称/简介、删除（`DELETE /api/interactive/[workId]/chapters/[projectId]`）；章节内节点可复制到另一章节画布（`clipboard.ts` / `CanvasGraph.tsx` / `clone-node-data.ts`）；修复画布 ops 保存因 `detailVersion` 泄漏进 `node.upsert` 而 INVALID_PARAMS 无限重试（客户端 `canvas-operations.ts` 剔除，服务端 `operations.ts` parse 容忍）。无 schema 变更。
- 基线：`release-20261126-topenrouter-model-toggle`（source sha `7fd58d4b…`）+ 覆盖。新源码 sha256 `e903833a…`。镜像 `norivideo:release-20261126-chapter-ops-fix`，verify 通过，`switch.done=0`，app/admin healthy。
- 回滚：`norivideo:release-20261126-topenrouter-model-toggle` 重新 tag 为 latest 并 force-recreate app/admin。
- 遗留：未做真实浏览器冒烟（章节编辑/删除、跨章节粘贴、画布保存），需用户验证；代码未进本地 main。
