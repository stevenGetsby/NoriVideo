# 批量风格视频工作流（5 阶段）— 部署交接文档

- 日期：2026-11-29
- 状态：**未提交、未迁移、未部署**。任何提交、迁移、切换都必须先得到用户明确确认。
- 基线 HEAD：`a57f77278cbaeef761f0f57eaf641f59277f0fab`（feat(platform): sync production releases）
- 目标服务器：备案机 `14.103.65.61`（`lanmiaoai.com`）。最近一次已记录的线上版本是 `20261127-customer-routing-clean`，需要部署前在主机上确认。
- 禁止事项：不读取 `.env` / `.env.local` / `.deploy.env`；不动 `/opt/norivideo/data/services.prod.json`；不删除 `/data` 上的 MySQL datadir；不使用别名 `lanmiao-prod`。

---

## 0. 部署前必须由用户决定的事项

| # | 问题 | 建议 |
|---|------|------|
| D1 | 提交范围：工作区有 136 个变更，其中约 120 个属于他人（画布、frameos、管理后台、feedback、定价、pitch 等）。 | 只提交本交接文档第 2 节列出的文件。不要 `git add -A`。 |
| D2 | 本功能依赖 8 个他人已修改但未提交的共享文件（见第 2.3 节）。只提交本功能会导致 HEAD 无法编译。 | 二选一：(a) 把这 8 个文件的改动也纳入本次发布，并让对应负责人确认；(b) 只提交本功能，并先在 “HEAD + 本功能” 的干净树里 tsc / vitest 通过。**推荐 (b)**，但必须先完成第 4.1 节的验证。 |
| D3 | `standards/pricing/deepseek-agent.pricing.json` 在工作区被删除。源码和测试都没有引用它，只有旧版 `deploy.sh` 的候选镜像校验会检查它。 | 确认是否为有意删除。若无意，用 `git checkout`/恢复由用户执行，不要由部署 agent 执行。 |
| D4 | 发布流水线：`docs/deployments` 最近的记录使用 `mkrelease2.sh` + `ship2.sh`，但这两个脚本不在工作区中（已搜索 `/Users/headmasterx` 深度 4 内）。`.runtime/20261124-canvas-guard/` 下的脚本是旧模板。 | 请用户提供 `mkrelease2.sh` / `ship2.sh` 的位置，或确认沿用哪个流水线。 |
| D5 | `feedback` 相关 schema 与迁移（`WorkspaceFeedbackRecord` 新字段、`20261128_feedback_attachments`）是否随本次发布。 | 不随本次发布。见第 3.4 节的风险说明。 |

---

## 1. 功能摘要

- 5 个阶段：`script_analysis`（脚本分析）→ `script_rewrite`（脚本改写）→ `assets_lookbook`（素材/造型）→ `storyboard`（分镜）→ `screening_room`（放映/视频生成）。对应视图为 `src/components/batch-workflow/stages/Stage1…5*.tsx`。
- 学员端：简易流程，普通账号只读 Skill。管理员可按阶段调优 Skill，已发布内容不可原地修改，必须 `saveAsNewVersion: true` 另存新版本。
- 并发控制：`BatchItem.revision` 做 CAS，冲突返回 `STALE_REVISION`（409）；`executionKey` 标识一次阶段执行；阶段正在执行返回 `STAGE_ALREADY_RUNNING`（409）。
- 异步执行：新任务类型 `workflow_stage_run`（`TASK_TYPE.WORKFLOW_STAGE_RUN`），单次尝试（`SINGLE_ATTEMPT_TASK_TYPES`），由 text worker 处理。
- 质检：只做机器规则，失败后最多一次纠正重试；保留上一次通过的产物。失败返回 `QC_FAILED`（422）。模型不可用返回 `MODEL_UNAVAILABLE`（503），不会自动切换模型。
- 画布物化：`materialize-canvas` 支持 create / sync / check 三种模式，依据 fingerprint。
- 内置 Skill 与模板是代码常量（`BUILTIN_WORKFLOW_SKILLS` / `BUILTIN_WORKFLOW_TEMPLATES`），不需要种子数据步骤。
- 批量代码本身不读取任何环境变量，也不读取 `standards/` 下的文件。视频阶段通过已有的 provider 栈调用模型，因此会继承线上模型与平台配置。

---

## 2. 改动范围

### 2.1 本功能独占的新文件（未跟踪，共 68 个文件 + 2 个迁移目录）

- `src/lib/batch-workflow/`（8 个）：`builtin-presets.ts`、`builtin-short-drama-commerce.ts`、`executor.ts`、`item-store.ts`、`materialize-canvas.ts`、`quality.ts`、`service.ts`、`types.ts`
- `src/lib/workers/handlers/batch-workflow.ts`
- `src/app/api/batch-workflow/`（16 个 route）：`runs/`、`runs/[runId]/{advance,sync,items,…}`、`skills/`、`skills/refine`、`skills/[skillId]`、`templates/`、`templates/[templateId]`
- `src/components/batch-workflow/`（16 个）：`BatchWorkflowClient.tsx`、`SkillRefinementDock.tsx`、`SkillLibraryModal.tsx`、`ModelConfigPopover.tsx`、`RecipeSummaryPopover.tsx`、`canvas-sync-logic.ts`、`model-config-normalize.ts`、`video-generation-logic.ts`、`workflow-client-utils.ts`、`batch-workflow.css`、`stages/*`
- 页面：`src/app/[locale]/batch-workflow/page.tsx`、`src/app/[locale]/workflow/[projectId]/batch/page.tsx`
- 测试：`tests/unit/batch-workflow/`（19 个）、`tests/unit/components/` 下 7 个文件：`model-config-normalize`、`recipe-summary-popover`、`skill-refinement-dock-scope`（.tsx）、`workflow-client-utils`、`workflow-draft-flush`、`workflow-media-canvas-logic`、`workflow-video-capabilities`
- 迁移目录：`prisma/migrations/20261127_batch_workflow_phase1/`、`prisma/migrations/20261128180000_batch_workflow_revision_contract/`

### 2.2 本功能对共享文件的修改（只提交这些 hunk）

| 文件 | 改动 |
|------|------|
| `src/lib/task/types.ts` | `TASK_TYPE.WORKFLOW_STAGE_RUN: 'workflow_stage_run'` |
| `src/lib/task/intent.ts` | 映射为 `'generate'` |
| `src/lib/task/queues.ts` | 加入 `SINGLE_ATTEMPT_TASK_TYPES` |
| `src/lib/workers/text.worker.ts` | import `handleBatchWorkflowStageTask`，并新增 `case TASK_TYPE.WORKFLOW_STAGE_RUN` |
| `src/lib/api-errors.ts` | 注册 5 个新错误码 |
| `src/lib/errors/codes.ts` | 5 个错误码定义（STALE_REVISION、STAGE_ALREADY_RUNNING、ASSET_NOT_READY、QC_FAILED、MODEL_UNAVAILABLE） |
| `src/lib/errors/user-messages.ts` | 5 条中文提示 |
| `messages/zh/errors.json`、`messages/en/errors.json` | 5 个 key，已核对只有本功能的新增行 |
| `tests/contracts/task-type-catalog.ts` | 归属映射 → `tests/unit/batch-workflow/workflow-stage-worker.test.ts` |
| `tests/contracts/tasktype-behavior-matrix.ts` | 加入 `workflow_stage_run` 分支 |
| `src/lib/volcengine/video-understanding.ts` | **文件末尾新增 222 行**：`understandStorageVideoWithSkill` 及其类型，供工作流视频阶段使用；顶部新增 2 行 import（`getObjectBuffer`、`startVideoTimingProbe`）。此前清单遗漏了该文件。 |
| `prisma/schema.prisma` | **只提交 `// Batch Style-Video Workflow` 之后的模型**：`WorkflowSkill`、`WorkflowTemplate`、`BatchRun`、`BatchItem`（含 `revision`、`executionKey`）。第 1037 行附近 `WorkspaceFeedbackRecord` 的 hunk **不属于本功能**。 |

### 2.3 本功能导入、但由他人修改且未提交的文件（必须验证）

脚本检查确认，以下文件已修改但未提交，且本功能代码会导入它们。在 HEAD 中，所需符号名大多存在（脚本只检查了名字，没有检查签名）。

| 文件 | 本功能使用的符号 | 备注 |
|------|----------------|------|
| `src/components/frameos/FosShell.tsx` | `FosShell`、`FosProjectNavigation` | 他人新增了导出 `rememberProjectCreationMode`，本功能未使用 |
| `src/components/frameos/materials/MentionPromptEditor.tsx` | `MentionPromptEditor`、`MentionPromptAsset` | — |
| `src/components/ui/viewport-popover.tsx` | `ViewportPopover` | — |
| `src/lib/account/permissions.ts` | `hasAccountPermissions`、`isManagementRole`、`normalizeAccountRole` | — |
| `src/lib/api-config.ts` | `resolveModelSelection` | 他人改了 `getProviderConfig` 签名，本功能不使用 |
| `src/lib/nori-model-catalog.ts` | `NORI_DEFAULT_MODEL_KEYS` | — |
| `src/lib/platform-services/config.ts` | `getPlatformServiceConfigResponse` | 他人新增 `environmentOpenLuxGroupKeys`，并改了 `PlatformServiceProvider` 类型 |
| `src/lib/platform-services/model-selection.ts` | `listSelectableModelsForViewer`、`resolveModelKeyForViewer`、`resolveSelectableModelKeyForViewer`、`ModelViewerContext` | — |

已确认：`getObjectBuffer` 在 HEAD 的 `src/lib/storage/index.ts` 中导出；`startVideoTimingProbe` 在 HEAD 的 `src/lib/video-repaint/cut-detection.ts` 中导出。

### 2.4 不属于本次发布（不要提交）

- 他人修改：`src/features/canvas/*`、`src/components/frameos/*`（除 2.3 节外）、`src/components/admin/*`、`src/lib/canvas-agent/*`、`src/lib/llm/*`、`src/lib/model-gateway/*`、`src/lib/providers/*`（ailink、openlux、topenrouter）、`src/lib/workers/handlers/toolbox-video-task-handler.ts`、`src/lib/workspace/feedback-store.ts`、`src/app/api/feedback/route.ts`、`src/components/workspace/FrameFeedbackDashboard.tsx`、`src/styles/frameos-replica.css`、`docs/architecture/customer-model-view-design-20261127.md`、`tests/unit/canvas/editor-interactions.test.ts`
- 他人未跟踪：`src/components/workspace/FeedbackImageUploader.tsx`、`src/app/api/feedback/upload/`、`src/features/canvas/drag-perf.ts`、`src/lib/providers/openlux/groups.ts`、`prisma/migrations/20261128_feedback_attachments/`、`docs/pitch/`（含二进制 pdf/pptx）、`docs/deployments/beian-*-2026112*.md`（他人的部署记录）、`tmp/`、`var/`
- 删除/修改的定价文件：`standards/pricing/deepseek-agent.pricing.json`（已删除，见 D3）、`standards/pricing/openlux.pricing.json`（已修改）

---

## 3. 数据库

### 3.1 迁移顺序（MySQL 8.0，容器 `norivideo-mysql-1`）

1. 备份（先于任何 DDL）：沿用 `mysqldump --single-transaction --routines --events --triggers --hex-blob --no-tablespaces --set-gtid-purged=OFF nori | gzip`，输出到备份目录，并执行 `gzip -t`。
2. 检查是否已执行过：`SHOW TABLES LIKE 'batch_%'`、`SHOW TABLES LIKE 'workflow_%'`、`SHOW COLUMNS FROM batch_items LIKE 'revision'`。
3. 执行 `20261127_batch_workflow_phase1/migration.sql`。它是 `CREATE TABLE IF NOT EXISTS`，可以重复执行。
4. **重复数据预检（必做）**。如果返回任何行，停止，等待人工去重方案，不要盲目删除：

   ```sql
   SELECT `userId`, `slug`, `version`, COUNT(*) AS `duplicateCount`,
          GROUP_CONCAT(`id` ORDER BY `createdAt`, `id`) AS `skillIds`
   FROM `workflow_skills`
   WHERE `userId` IS NOT NULL
   GROUP BY `userId`, `slug`, `version`
   HAVING COUNT(*) > 1;
   ```

5. 执行 `20261128180000_batch_workflow_revision_contract/migration.sql`。它**不是幂等的**，只能执行一次。它会给 `batch_items` 增加 `revision`、`executionKey`，并在 `workflow_skills (userId, slug, version)` 上建立唯一索引。
6. 验证 schema 与候选代码一致（与 `deploy.sh` 的门禁一致）：

   ```bash
   # 在候选镜像内执行，DATABASE_URL 由容器环境提供，不要在终端打印
   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
   ```

   输出中不应出现 `CREATE` / `ALTER` / `DROP` 语句。

### 3.2 注意：应用容器启动时会执行 `prisma db push`

`docker-compose.prod.yml` 中 `app` 服务的启动命令是 `sh -c "npx prisma db push --skip-generate && ./docker-start.sh"`。因此，每次重建 `app` 容器都会对线上库执行 `db push`。第 6 步的门禁必须在重建前通过。若 DB 与 schema 不一致，`db push` 可能会追加变更，或因为重复数据失败。

### 3.3 Worker 位置（已确认）

`app` 服务没有设置 `SERVICE_MODE`，默认值为 `all`，会在同一容器内启动 worker、watchdog、bull-board 和 `next start`。因此**重建 `app` 即可加载新的 `workflow_stage_run` 处理器**，不需要单独重启 worker。`admin` 服务是 `SERVICE_MODE: web`，只跑 Next。

### 3.4 feedback 相关风险

如果 `20261128_feedback_attachments` 或 `WorkspaceFeedbackRecord` 的新列已经在线上库执行过，而候选 schema 不包含它们，第 6 步的 `migrate diff` 会出现 `DROP COLUMN`，门禁会拒绝切换。这需要在 D5 中定下来：要么一起发布，要么先确认线上库状态。

---

## 4. 发布前置条件

### 4.1 提交范围必须先验证（第一道门禁）

1. 用 `git archive HEAD` 导出到 `/private/tmp/wf-head`（只读，不改仓库）。
2. 把第 2.1 节的文件复制进去，并只应用第 2.2 节的 hunk（其余共享文件用 HEAD 版本，`prisma/schema.prisma` 只加入批量模型）。
3. 对于第 2.3 节的 8 个文件，使用工作区版本，或确认 HEAD 版本能满足本功能的调用签名（若走 D2-b，需要 HEAD 版本）。
4. 在干净镜像中运行 `tsc --noEmit` 和 `vitest run tests/unit/batch-workflow tests/unit/components/…`，并与 HEAD 基线比较错误数。

本次没有完成这一步。当前只验证过工作区副本，见第 6 节。

### 4.2 提交

- 用户确认 D1、D2 后再提交。
- `prepare.mjs` 的逻辑是：`git status --porcelain --untracked-files=no` 有输出就拒绝；只打包 `git ls-files` 的文件。因此**未跟踪的新文件不会进入发布包**，必须先 `git add` 并提交。
- 不要用 `git add -A`、`git add .`，也不要 `git stash`、`git checkout`、`git restore`。

### 4.3 发布脚本

- `.runtime/20261124-canvas-guard/` 是旧模板，且 `.runtime/` 被 `.gitignore` 忽略，只存在于这台 Mac。
- `prepare.mjs` 把路径硬编码为 `.runtime/20261124-canvas-guard`。
- `deploy.sh` 硬编码了旧版本：`previous_image=norivideo:release-20261124-video-download`、`previous_source=50ec66a1…`、`upstream=c8eb8c3…`、`flat_base=norivideo:base-flat-20261124-main-cdad110`。当前线上版本不同，`ensure_previous_live` 会直接拒绝发布（`live image changed; release refused`）。
- 因此**不能直接复用该 `deploy.sh`**。若沿用，必须先更新以上值和检查字符串（`billing_fix_present`、`ledger_present`、`fixed-tos-probe` 等）。
- 若使用 D4 中的 `mkrelease2.sh` / `ship2.sh`，请以用户提供的版本为准。

---

## 5. 切换步骤（用户确认后执行）

1. 确认 `active_tasks`（`tasks` 表中 `status IN ('queued','processing')`）为 0。`ship2.sh` 会优雅排空；旧脚本会直接拒绝。
2. 执行第 3.1 节的迁移，并通过门禁 6。
3. 构建候选镜像，给它打上 `org.norivideo.source-sha256` 标签，并在隔离环境中验证：Prisma client 存在、`dist/worker.js` 存在、`standards/pricing/*` 等文件存在（见 D3）。
4. 重建 `app` 与 `admin`（`docker compose … up -d --no-deps --no-build --pull never --force-recreate app admin`）。
5. 等待两个容器 `healthy`。

### 5.1 冒烟检查

- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/batch-workflow/runs` → 期望 `401`
- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/batch-workflow/skills` → 期望 `401`
- `curl -fsS -o /dev/null http://127.0.0.1:3000/zh/auth/signin` → 期望成功
- `docker logs --since 10m norivideo-app-1` 中不应出现新的 error 级别日志（尤其是 `workflow_stage_run` 相关报错）
- 对 `batch_runs`、`batch_items`、`workflow_skills`、`workflow_templates` 执行 `SELECT COUNT(*)`，确认表存在
- 用一个学员账号和一个管理员账号登录，打开 `/zh/batch-workflow`（UI 尚未在浏览器中验证，见第 6 节）

### 5.2 回滚

- 把 `previous_image` 重新打到 `norivideo:latest`，然后重建 `app` 与 `admin`。
- 迁移为增量式，不回滚数据库。旧代码忽略新表与新列。回滚后批量数据会留在库中，但旧版本无法访问。
- 不要删除 `/data` 上的 MySQL datadir。

---

## 6. 验证证据

| 项目 | 结果 | 来源 |
|------|------|------|
| 单元测试（batch-workflow + 7 个组件测试） | **39 个文件 / 285 个用例全部通过**（2026-11-28 23:53） | `/private/tmp/ctl-vitest.log`，镜像 `/private/tmp/nori-work-ctl` |
| 镜像与工作区一致性 | 已核对：`src/lib/batch-workflow`、`src/components/batch-workflow`、`src/app/api/batch-workflow`、`tests/unit/batch-workflow`、`src/lib/workers/handlers/batch-workflow.ts`，以及第 2.2 节的 8 个共享文件，与工作区**逐字节一致** | `diff -rq` / `cmp` |
| 未核对的文件 | `src/lib/volcengine/video-understanding.ts` 未与镜像比对；新增的 222 行是否已包含在该镜像中未知 | — |
| `tsc --noEmit` | 21 行错误，全部位于**本功能之外**：`src/features/canvas/CanvasGraph.tsx`、`tests/unit/canvas-agent/model-catalog.test.ts`、`tests/unit/canvas/*`、`tests/unit/platform-services/*`、`tests/unit/mp/preflight.test.ts`。本功能文件无错误。 | `/private/tmp/ctl-tsc.log` |
| 本次未运行 | `npm run test:guards`（API handler、task-type、requirements matrix 等守卫）。旧日志在 `/private/tmp/nori-work-C2-*`，已过时。 | — |
| 浏览器 UI | **未验证**。 | — |

注意：本次在 Desktop 直接运行 `vitest` 失败，因为 `node_modules` 不完整（`.bin/vitest` 不存在），且系统盘剩余 13 GiB（97%）。测试应在干净镜像中运行，参考 `reference_dataless_files` 的做法。

---

## 7. 已知残留风险（上线后需要关注）

1. 真实试拍（trial）在扣费后、返回前若进程崩溃，可能丢失产物登记。已有 `registerLateAsyncArtifact` 做补登，但不是事务性的。
2. 预检与登记之间不是事务。worker 侧仍有 TOCTOU 窗口（已部分处理，未完全消除）。
3. S1 视频质检重试会重新上传（火山引擎路径），不在本次范围内。
4. 列表接口中的 `hasPendingAsyncTasks` 是推断值，不是精确值。
5. 画布同步会覆盖用户手改过的媒体字段。
6. “一键自动 / 检查点”模式本次未做，已延期。
7. 切换时若有阶段正在运行，对应 `tasks` 行会被门禁拦截；超时的阶段在 `sync` 路由中有恢复逻辑（`buildTimeoutRecoveryPatch`、`isTimedOutStageExecution`）。

---

## 8. 部署 agent 的首要动作

1. 向用户确认 D1–D5。
2. 完成第 4.1 节验证，并把结果回报用户。
3. 只有在用户明确确认提交、迁移、切换之后，才执行第 4.2 节及之后的步骤。
4. 任何时候都不读取 `.env*`，不在输出中打印 `DATABASE_URL` 或其他凭据。
