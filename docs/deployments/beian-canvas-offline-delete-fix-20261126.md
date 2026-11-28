# 备案机修复画布离线恢复导致删除节点无法保存（2026-11-26）

- 症状：互动影游画布删除节点 → Ctrl+S → 重开，弹「同步服务器版本 / 本地版本」冲突框；点「本地」卡住，点「服务器」回到删除之前。
- 根因：线上未修复版本的离线恢复（`restoreLocalVersion` / `resolveCanvasOfflineRecoveryChoice` 非几何 draft 分支）用**整文档快照覆盖**（`clone(draft.document)` + `forceFullSaveRef=true`），`expectedRevision=serverRevision` 提交 full save。删除本身先因 revision 冲突未落库（服务器仍是删除前版本），于是冲突框两条路都无法正确保存删除：点本地 full-save 挂起，点服务器丢弃删除。
- 修复：本地已存在的三个未提交文件改动，把「整文档快照覆盖」改为「先拉最新服务器文档、用 `applyCanvasOperationsToDocument` 重放本地 pending ops、走 ops diff 提交」：
  - `src/features/canvas/state/canvas-operations.ts`：新增 `applyCanvasOperationsToDocument`（`node.delete` 级联删除关联边；目标不存在的 op 跳过，避免陈旧草稿误删服务器节点）。
  - `src/features/canvas/state/canvas-offline-store.ts`：`resolveCanvasOfflineRecoveryChoice` 非几何分支改为 `applyCanvasOperationsToDocument(currentDocument, draft.pendingOps, ...)`。
  - `src/features/canvas/state/useCanvasAutosave.ts`：`restoreLocalVersion` 先 `canvasApi.get` 拉最新文档、`revisionRef.current=graph.canvas.revision`、`confirmedDocumentRef=serverDocument`、改走 ops 提交；自动合并路径不再用 `pendingFullDocumentRef` 覆盖合并结果。
- 字段名校验：`node.upsert→operation.node`、`node.delete→operation.id`、`edge.add→operation.edge`、`edge.delete→operation.id`、edge 用 `sourceNodeId/targetNodeId`，与 `src/lib/canvas/operations.ts` 的 parse 一致。
- **基线**：线上 latest = `release-20261126-mini-audio-default`（source label `7738e2a3…`）。发布源码 = 该 release 的 `build/source.tar.gz` 解包 + 仅覆盖上述 3 个文件，`diff -rq` 确认全树只有这 3 个文件不同（mini-audio 的 standards 修复随基线带入）。本地 main 的其它未提交改动一律未包含。
- 构建：备案机离线 `--network none` 容器。**注意**：原 build 基底 `release-20261124-main-cdad110` 已被上午的 `docker image prune` 清掉，改用 `release-20261126-mini-audio-default`（含 next/tsc/tailwind/esbuild 完整工具链）作 build 基底；flat_base `base-flat-20261124-main-cdad110` 不变。deps 复用 `20261122-seedance-prompt/node_modules.tar.gz`。源码 tar sha256 `fd3d3a53…`，artifacts sha256 `83ea432d…`。
- 候选：`norivideo:release-20261126-canvas-offline-delete-fix`。load 全树校验通过；mini audio 断言 OK；独立 web 预检 13853 端口 sign-in 200。
- 切换：`drain-and-switch.sh` 拦截新生成 → 队列排空（3→0）→ `deploy.sh switch fd3d3a53…`（schema diff 为空、备份、健康检查、失败自动回滚）。`switch.done=0`，app/admin 均 healthy，nginx 已恢复。latest 与 candidate 同 id `a6474ec4…`。
- 上线后验证：候选客户端 chunk 含 `applyCanvasOperationsToDocument`；公网 sign-in 200；build 目录已清理。
- 备份：`/opt/norivideo/backups/20261126-canvas-offline-delete-fix/`。
- 回滚：`norivideo:release-20261126-mini-audio-default` 重新 tag 为 latest 并 force-recreate app/admin；无 schema 变更。
- 遗留：本地 main 这三个文件改动未提交/推送（建议尽快提交，否则下次发布基线又不含修复）。真实浏览器删除→Ctrl+S→重开→点本地 的端到端冒烟未做（需用户操作验证）。
