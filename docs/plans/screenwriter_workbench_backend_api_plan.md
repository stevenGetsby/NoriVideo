# 编剧工作台真实后端接口接入计划

- Status: Completed
- Last sync with code: 2026-07-02 working tree (uncommitted)
- Date: 2026/7/2

## Changed Items
1. 不复用现有 API
2. 将后端接口要涉及的数据对象写在 "### 3. 需要创建的后端对象" 中
3. 前端在非检查点阶段页面，通过定时轮询（ 10s ）是否已经全部完成，若完成则跳转到下一个页面
   1. 后端会一直 work 不停（除非有些失败了，就停下），前端轮询后端查看所处阶段，并且渲染对应页面
4. 已新增 screenwriter 专用 Prisma 对象、`/api/screenwriter/*` 接口、前端 API client 与轮询接入；mock store 仅保留为历史测试 fixture，不再作为页面默认数据源。


## 目标

在已完成的 `docs/plans/screenwriter_workbench_frontend_plan.md` 基础上，把 `/screenwriter` 与 `/screenwriter/video-repaint/*` 从浏览器内存 Mock Store 改造成真实后端接口驱动。

本计划按 `Changed Items` 调整为：不复用现有业务 API 作为前端调用对象，新增 `/api/screenwriter/*` 专用 API 与编剧工作台专用后端数据对象。实现时可以复用认证、Prisma、Task、GraphRun、MediaObject、storage、模型网关等底层基础设施，但前端不能直接调用 `/api/projects`、`/api/novel-promotion/*`、`/api/workflow/*` 来拼装编剧工作台状态。

## 相关细节

### 1. 前端当前使用到的对象

前端对象集中在 `src/components/frameos/screenwriter/types.ts`、`screenwriterMockStore.ts`、`useScreenwriterTasks.ts` 和 `useVideoRepaintTask.ts`。

1. `ScreenwriterScriptSummary`
   - 用于 `/screenwriter` 左侧剧本/任务队列。
   - 字段包括 `id`、`title`、`episodeCount`、`taskKind`、`status`、`activeTaskId`、`currentStage`、`currentStageStatus`、`nextRoute`、`updatedAt`。
   - 当前来源是 `listScreenwriterTasks()`，由 `screenwriterDemoScripts` 与内存中新建任务拼接。

2. `VideoRepaintCreateInput`
   - 用于 `/screenwriter/video-repaint` 新建任务表单。
   - 字段包括 `title`、`transferForm`、`uploadMode`、`sourceAssetName`、`requirement`、`checkpoints`。
   - 当前 `sourceAssetName` 只是示例视频名称，不是可持久化的上传文件或媒体对象。

3. `VideoRepaintTaskDetail`
   - 用于 `/screenwriter/video-repaint/[taskId]/*` 流程页。
   - 继承 `VideoRepaintTaskView`，包括任务标题、需求、当前阶段、6 个阶段状态、源设定、目标设定、逐集对齐进度、逐集转绘进度。
   - 额外包含 `routeByStage`、`canConfirmCurrentStage`、`canRetryCurrentStage`。

4. `SettingsReviewView`
   - 用于源设定检查点和目标设定检查点。
   - 字段包括总纲分段、统一名索引或映射分组、复核问题、反馈 placeholder。
   - 当前完全来自 demo 数据，没有后端持久化对象。

5. `EpisodeProcessItem`
   - 用于逐集对齐和逐集转绘网格。
   - 字段包括 `id`、`episodeNumber`、`status`、`errorMessage`。
   - 当前由 demo 数据提供，不对应真实任务或剧集处理记录。

6. `TargetScriptEpisode`
   - 用于目标剧本查看页。
   - 字段包括 `id`、`episodeNumber`、`title`、`status`、`wordCount`、`content`。
   - 当前由 demo 数据提供。

7. Mock 操作边界
   - `listScreenwriterTasks()`：返回任务列表。
   - `createVideoRepaintTask(input)`：创建内存任务并返回 `nextRoute`。
   - `getVideoRepaintTask(taskId)`：返回任务详情。
   - `advanceVideoRepaintTask(taskId, fromStage)`：检查点确认或自动推进。
   - `getVideoRepaintAutoAdvance(taskId, stage)`：非检查点 10s 自动推进。

### 2. 后端实施边界

1. 不复用现有业务 API
   - 前端不直接调用 `/api/projects`、`/api/novel-promotion/*`、`/api/workflow/*`、`/api/runs/*`、`/api/tasks/*` 来完成编剧工作台主链路。
   - 新增 `/api/screenwriter/*` API，所有页面对象都由该 API 返回。
   - 新增 API 内部可以调用底层 service、Prisma model、任务系统、运行时系统和存储系统。

2. 可复用底层基础设施
   - 认证与权限：继续使用 `requireUserAuth` 或等价认证封装。
   - 数据库访问：继续使用 Prisma。
   - 异步任务：可复用 `Task` / BullMQ / worker 机制作为执行底座，但需要新增 screenwriter 专用 task type 或 screenwriter 专用任务服务。
   - 多步骤运行：可复用 `GraphRun` / `GraphStep` / `GraphArtifact` / `GraphCheckpoint` 作为执行记录和产物存储底座，但新增 API 不把 GraphRun 原始结构直接暴露给前端。
   - 媒体存储：可复用 `MediaObject` 与 `storage` 保存视频源文件，但需要新增 screenwriter 源视频绑定对象。
   - 模型调用：继续经过 `model-gateway`、`llm`、`providers`，不得在 API route 直接调用模型。

3. 专用对象优先
   - 编剧工作台的任务、阶段、视频源、检查点、逐集处理、目标剧本版本都应有明确后端对象。
   - 不把编剧工作台状态塞进 `Project.description`、`NovelPromotionEpisode.speakerVoices` 等非专用字段。
   - 如需与后续分镜/生产链路打通，使用显式同步/导出步骤，而不是让 screenwriter 页面直接依赖现有工作区对象形状。

### 3. 需要创建的后端对象

以下对象按前端当前使用到的对象反向设计。具体 Prisma model 名称可在实现时微调，但职责边界应保持稳定。

1. `ScreenwriterTask`
   - 对应前端：`ScreenwriterScriptSummary`、`VideoRepaintTaskDetail` 的任务主信息。
   - 职责：保存编剧工作台中的一份任务或剧本入口。
   - 关键字段：
     - `id`
     - `userId`
     - `title`
     - `taskKind`: `video_repaint_2 | script_repaint_2 | storyboard_repaint_2`
     - `status`: `draft | available | archived`
     - `activeTaskLabel`
     - `currentStage`: `auto_split | fact_extract | source_settings | episode_alignment | target_settings | episode_repaint | target_script`
     - `currentStageStatus`: `not_started | queued | running | waiting_check | approved | succeeded | failed | stale`
     - `episodeCount`
     - `requirement`
     - `transferForm`: `script | board`
     - `uploadMode`: `file | folder`
     - `sourceProjectId` / `targetProjectId`，可选，用于后续与现有工作区项目打通。
     - `activeRunId` / `activeWorkerTaskId`，可选，用于关联底层执行记录。
     - `createdAt`、`updatedAt`、`archivedAt`

2. `ScreenwriterSourceVideo`
   - 对应前端：`VideoRepaintCreateInput.sourceAssetName` 后续真实化后的 `sourceVideos[]`。
   - 职责：保存视频转绘任务的源视频或源视频文件夹条目。
   - 关键字段：
     - `id`
     - `screenwriterTaskId`
     - `episodeNumber`
     - `fileName`
     - `mediaObjectId`
     - `storageKey`
     - `url`
     - `durationSeconds`
     - `fileSize`
     - `mimeType`
     - `uploadStatus`: `local | uploading | uploaded | failed`
     - `transcodeStatus` / `extractStatus`，可选，用于后续视频反译。
     - `errorMessage`
     - `createdAt`、`updatedAt`

3. `ScreenwriterStageState`
   - 对应前端：`VideoRepaintStageItem`、`VideoRepaintTaskDetail.canConfirmCurrentStage`、`canRetryCurrentStage`。
   - 职责：保存每个 screenwriter task 的 6 个流程阶段状态。
   - 关键字段：
     - `id`
     - `screenwriterTaskId`
     - `stageKey`: `auto_split | fact_extract | source_settings | episode_alignment | target_settings | episode_repaint`
     - `title`
     - `subtitle`
     - `status`
     - `checkpoint`: `A | B | null`
     - `progress`
     - `workerTaskId`
     - `runId`
     - `errorCode`
     - `errorMessage`
     - `startedAt`
     - `finishedAt`
     - `approvedAt`
     - `approvedBy`
   - 约束：`screenwriterTaskId + stageKey` 唯一。

4. `ScreenwriterSettingsReview`
   - 对应前端：`SettingsReviewView`。
   - 职责：保存源设定检查点和目标设定检查点的可审查产物。
   - 关键字段：
     - `id`
     - `screenwriterTaskId`
     - `stageKey`: `source_settings | target_settings`
     - `checkpoint`: `A | B`
     - `version`
     - `status`: `draft | waiting_check | approved | regenerating | stale`
     - `outlineTitle`
     - `bodySections` Json
     - `collapsedPanelTitle`
     - `nameIndexGroups` Json
     - `mappingGroups` Json
     - `issues` Json
     - `feedbackPlaceholder`
     - `latestFeedback`
     - `approvedAt`
     - `createdAt`、`updatedAt`
   - 约束：`screenwriterTaskId + stageKey + version` 唯一。

5. `ScreenwriterReviewFeedback`
   - 对应前端：检查点反馈输入、重新提炼、重新生成。
   - 职责：保存用户对检查点产物的每一轮反馈与后端处理结果。
   - 关键字段：
     - `id`
     - `settingsReviewId`
     - `screenwriterTaskId`
     - `stageKey`
     - `content`
     - `action`: `regenerate | approve | comment`
     - `runId`
     - `workerTaskId`
     - `createdBy`
     - `createdAt`

6. `ScreenwriterEpisodeProcess`
   - 对应前端：`EpisodeProcessItem`。
   - 职责：保存逐集对齐和逐集转绘的单集处理状态。
   - 关键字段：
     - `id`
     - `screenwriterTaskId`
     - `stageKey`: `episode_alignment | episode_repaint`
     - `episodeNumber`
     - `status`: `pending | running | succeeded | failed | retrying`
     - `workerTaskId`
     - `runId`
     - `sourceEpisodeId`
     - `targetEpisodeId`
     - `progress`
     - `errorCode`
     - `errorMessage`
     - `startedAt`
     - `finishedAt`
   - 约束：`screenwriterTaskId + stageKey + episodeNumber` 唯一。

7. `ScreenwriterScriptEpisode`
   - 对应前端：`TargetScriptEpisode`，也可用于保留源剧本、目标剧本对照。
   - 职责：保存编剧工作台产出的逐集剧本文本。
   - 关键字段：
     - `id`
     - `screenwriterTaskId`
     - `episodeNumber`
     - `scriptKind`: `source | target`
     - `title`
     - `content`
     - `wordCount`
     - `status`
     - `sourceVideoId`
     - `sourceEpisodeId`
     - `version`
     - `updatedBy`
     - `createdAt`、`updatedAt`
   - 约束：`screenwriterTaskId + scriptKind + episodeNumber + version` 唯一。

8. `ScreenwriterNameMapping`
   - 对应前端：源设定统一名索引、目标设定角色/场景/道具映射。
   - 职责：保存跨集称呼归一和源目标映射，便于后续单集转绘和人工编辑。
   - 关键字段：
     - `id`
     - `screenwriterTaskId`
     - `mappingKind`: `character | location | prop | term`
     - `sourceName`
     - `targetName`
     - `aliases` Json
     - `description`
     - `sourceEvidence` Json
     - `status`: `draft | confirmed | stale`
     - `createdAt`、`updatedAt`

9. `ScreenwriterArtifact`
   - 对应前端：阶段中间产物和后续调试/恢复。
   - 职责：保存事实卡、拆集结果、对齐包、转绘输入输出、模型原始响应摘要等不适合拆成强类型表的产物。
   - 关键字段：
     - `id`
     - `screenwriterTaskId`
     - `stageKey`
     - `artifactType`
     - `refId`
     - `payload` Json
     - `version`
     - `runId`
     - `createdAt`
   - 约束：`screenwriterTaskId + stageKey + artifactType + refId + version` 唯一。

10. 后端 DTO 对象
   - `ScreenwriterTaskSummaryDto`：返回给 `GET /api/screenwriter/tasks`。
   - `VideoRepaintCreateRequest` / `VideoRepaintCreateResponse`：对应创建页提交与成功跳转。
   - `VideoRepaintTaskDetailDto`：返回给流程页，字段对齐 `VideoRepaintTaskDetail`。
   - `SettingsReviewDto`：字段对齐 `SettingsReviewView`。
   - `EpisodeProcessDto`：字段对齐 `EpisodeProcessItem`。
   - `TargetScriptEpisodeDto`：字段对齐 `TargetScriptEpisode`。

### 4. 新增后端 API 边界

前端只调用以下新增 API。接口内部可以复用底层 service，但不能要求前端理解现有 Project、NovelPromotion、Workflow 或 Run 的原始结构。

```text
GET    /api/screenwriter/tasks
POST   /api/screenwriter/video-repaint
GET    /api/screenwriter/video-repaint/:taskId
PATCH  /api/screenwriter/video-repaint/:taskId/requirement
POST   /api/screenwriter/video-repaint/:taskId/stages/:stage/run
POST   /api/screenwriter/video-repaint/:taskId/stages/:stage/retry
POST   /api/screenwriter/video-repaint/:taskId/stages/:stage/approve
POST   /api/screenwriter/video-repaint/:taskId/source-settings/regenerate
POST   /api/screenwriter/video-repaint/:taskId/target-settings/regenerate
GET    /api/screenwriter/video-repaint/:taskId/target-script
PATCH  /api/screenwriter/video-repaint/:taskId/target-script/:episodeId
```

接口职责：

1. `GET /api/screenwriter/tasks`
   - 返回当前用户的 `ScreenwriterTaskSummaryDto[]`。
   - 支持 `status`、`taskKind`、`search`、`page`、`pageSize`。
   - 不返回 mock 数据。

2. `POST /api/screenwriter/video-repaint`
   - 创建 `ScreenwriterTask`、`ScreenwriterSourceVideo[]`、6 条 `ScreenwriterStageState`。
   - 初始化 `auto_split` 为 `queued` 或 `running`，其他阶段为 `not_started`。
   - 返回 `{ id, title, nextRoute }`。

3. `GET /api/screenwriter/video-repaint/:taskId`
   - 返回完整 `VideoRepaintTaskDetailDto`。
   - 聚合任务主表、阶段状态、检查点产物、逐集进度、目标剧本摘要。

4. `PATCH /api/screenwriter/video-repaint/:taskId/requirement`
   - 更新任务名称、转绘需求、检查点配置。
   - 若任务已进入生成阶段，需要把下游相关阶段标记为 `stale`。

5. `POST /api/screenwriter/video-repaint/:taskId/stages/:stage/run`
   - 触发指定阶段执行。
   - 写入 `workerTaskId` / `runId` 并把阶段置为 `queued`。
   - 仅允许当前阶段或已失败/陈旧阶段运行。

6. `POST /api/screenwriter/video-repaint/:taskId/stages/:stage/retry`
   - 仅允许 `failed` 或 `stale` 阶段重试。
   - 对逐集阶段可支持 `episodeNumber` 参数，仅重试单集。

7. `POST /api/screenwriter/video-repaint/:taskId/stages/:stage/approve`
   - 仅允许 `source_settings` 与 `target_settings`。
   - 保存 `ScreenwriterReviewFeedback`，更新 `ScreenwriterSettingsReview.status=approved`，更新阶段状态，并解锁下一阶段。

8. `POST /api/screenwriter/video-repaint/:taskId/source-settings/regenerate`
   - 保存反馈，创建新版本 `ScreenwriterSettingsReview`。
   - 将 `source_settings` 设置为 `queued/running`，完成后回到 `waiting_check`。

9. `POST /api/screenwriter/video-repaint/:taskId/target-settings/regenerate`
   - 与 source settings regenerate 类似，但产物为目标设定与映射。

10. `GET /api/screenwriter/video-repaint/:taskId/target-script`
   - 返回 `TargetScriptEpisodeDto[]`。
   - 支持 `episodeNumber` 可选过滤。

11. `PATCH /api/screenwriter/video-repaint/:taskId/target-script/:episodeId`
   - 保存人工编辑后的目标剧本。
   - 更新字数、版本和更新时间。

### 5. 状态流转

1. 创建任务
   - `ScreenwriterTask.status=draft`
   - `currentStage=auto_split`
   - `auto_split.status=queued | running`
   - 创建源视频记录和 stage rows。

2. 自动拆集完成
   - 写入 `ScreenwriterScriptEpisode(scriptKind=source)`。
   - 写入 `ScreenwriterEpisodeProcess` 初始数据。
   - `auto_split=succeeded`，`fact_extract=queued | running`。

3. 事实卡提取完成
   - 写入 `ScreenwriterArtifact(artifactType=fact_cards)`。
   - `fact_extract=succeeded`，`source_settings=waiting_check`。

4. 源设定确认
   - `source_settings=approved`
   - `episode_alignment=queued | running`

5. 逐集对齐完成
   - 所有 `ScreenwriterEpisodeProcess(stageKey=episode_alignment)` 为 `succeeded`。
   - 写入 `ScreenwriterNameMapping`。
   - `episode_alignment=succeeded`，`target_settings=waiting_check`。

6. 目标设定确认
   - `target_settings=approved`
   - `episode_repaint=queued | running`

7. 逐集转绘完成
   - 写入 `ScreenwriterScriptEpisode(scriptKind=target)`。
   - 所有 `ScreenwriterEpisodeProcess(stageKey=episode_repaint)` 为 `succeeded`。
   - `episode_repaint=succeeded`
   - `ScreenwriterTask.currentStage=target_script`
   - `ScreenwriterTask.status=available`

8. 失败处理
   - 阶段失败时设置 `stage.status=failed`，写入 `errorCode/errorMessage`。
   - `ScreenwriterTask.currentStageStatus=failed`。
   - 前端不得自动跳转；用户可通过 retry API 重试。

### 6. 实施计划

1. Red：为 Prisma 数据对象映射写测试，覆盖 `ScreenwriterTask`、`ScreenwriterStageState`、`ScreenwriterSettingsReview` 到前端 DTO 的转换。
2. Green：新增 Prisma models 和 `src/lib/screenwriter/types.ts`、`src/lib/screenwriter/dto.ts`。
3. Red：为 `POST /api/screenwriter/video-repaint` 写 route/service 测试，覆盖必填校验、创建任务、创建源视频、初始化 6 阶段、返回 `nextRoute`。
4. Green：实现 `src/lib/screenwriter/create-video-repaint-task.ts` 与创建 API。
5. Red：为 `GET /api/screenwriter/tasks` 写测试，覆盖草稿、可用、归档、搜索、分页和 `nextRoute`。
6. Green：实现任务列表 API 和 `ScreenwriterTaskSummaryDto` 映射。
7. Red：为 `GET /api/screenwriter/video-repaint/:taskId` 写测试，覆盖完整详情、未找到、跨用户隔离、缺少检查点产物时的空状态。
8. Green：实现任务详情 API。
9. Red：为 stage run/retry/approve service 写测试，覆盖非法阶段、非法状态、检查点确认、下游解锁、失败重试。
10. Green：实现 `src/lib/screenwriter/stage-service.ts` 与对应 API。
11. Red：为 source/target settings regenerate 写测试，覆盖反馈保存、新版本产物、旧版本 stale。
12. Green：实现 settings regenerate API 与 `ScreenwriterReviewFeedback` 写入。
13. Red：为 target-script GET/PATCH 写测试，覆盖逐集列表、单集保存、字数更新、版本更新。
14. Green：实现 target script API。
15. Red：为前端 hooks 写测试，使用 fetch mock 覆盖 loading、error、create success、approve success、retry failure。
16. Green：将 `useScreenwriterTasks`、`useVideoRepaintTask`、创建页 `onStart` 从 `screenwriterMockStore` 切换到 `apiFetch`。
17. Refactor：保留 `screenwriterMockStore` 作为测试 fixture，不再作为页面默认数据源。
18. 验证：运行相关 route/service/hook 测试、`npm run typecheck`；新增 API 后更新 `docs/api_doc.md`。

### 7. 阶段性取舍

1. 第一期目标是真实持久化与真实状态推进，不承诺真实视频理解能力。
2. 视频反译、事实卡抽取、设定提炼和转绘生成可以先以 screenwriter 专用任务占位接入，后续再补 worker 实现。
3. 认证、存储、任务队列、模型网关仍应走现有基础设施。
4. 与现有项目工作区打通应作为后续同步能力，例如 “导出为 Project / NovelPromotionProject”，不阻塞第一期 screenwriter 专用任务闭环。

## 完成标准

1. Prisma schema 或等价持久化层新增 screenwriter 专用数据对象，至少覆盖任务、源视频、阶段状态、检查点产物、逐集处理、目标剧本和中间产物。
2. `/screenwriter` 默认从 `/api/screenwriter/tasks` 获取任务队列，不再依赖 `screenwriterDemoScripts`
3. `/screenwriter/video-repaint` 提交后通过 `POST /api/screenwriter/video-repaint` 创建真实持久化任务，刷新页面后任务仍可恢复。
4. `/screenwriter/video-repaint/[taskId]/*` 只从 `/api/screenwriter/video-repaint/:taskId` 及其子接口查询阶段状态、检查点产物、逐集进度和目标剧本。
5. 源设定和目标设定确认会写入后端状态，并解锁或触发下一阶段。
6. 失败阶段可通过真实 API 重试，前端能展示后端错误。
7. 目标剧本可读取和保存；如需进入现有分镜/生产链路，必须通过显式导出或同步接口完成，不让 screenwriter 页面直接依赖现有工作区 API。
8. Mock store 不再是页面默认数据源，只保留为测试 fixture 或显式开发 fallback。
9. 新增 API 后更新 `docs/api_doc.md` 或对应 API 文档。
10. 新增/修改代码遵循 TDD，相关 route/service/hook 测试与 `npm run typecheck` 通过。
