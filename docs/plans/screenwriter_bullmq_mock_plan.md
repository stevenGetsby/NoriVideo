# 编剧工作台 BullMQ Mock 任务接入计划

- Status: Completed
- Last sync with code: 49a155d3a3a40d5e2296263c57ea7bea1e3a5804
- Date: 2026/7/3

## Changed Items
1. Mock 专用任务类型取名 screenwriter_mock，因为后续编剧工作台链路的其他功能链路也可以用这个 Mock 任务来测试链路流程
2. 已接入 `screenwriter_mock` BullMQ 生产消费链路，现阶段使用 10s sleep 的 Mock worker 推进剧本转绘阶段，并以系统测试覆盖创建任务、两个人工检查点、逐集转绘和目标剧本查看链路。

## 目标

在现有剧本转绘前后端链路基础上，接入 BullMQ 生产消费任务模块。第一阶段不接真实 AI，只接 Mock 任务：API 生产者提交 Mock BullMQ 任务，Text Worker 消费任务并 sleep 10s 模拟耗时处理，随后推进编剧工作台剧本转绘状态，使 `docs/architecture.md` 中的剧本转绘互动链路可以在 `tests/system/` 下跑通。

目标链路以 `docs/architecture.md` 为准：

```text
进入编剧工作台
  -> 新建剧本转绘任务
  -> 上传/粘贴剧本并填写转绘需求
  -> 自动拆集
  -> 事实卡提取
  -> 源设定检查点
  -> 目标设定检查点
  -> 逐集转绘
  -> 查看目标剧本
```

本计划是 `docs/plans/script_repaint_chain_plan.md` 的后续执行计划；前置假设是 `/screenwriter/script-repaint` API 和页面链路已经存在，但后端目前只写入 DB，不会自动推进阶段。

## 相关细节

### 1. 当前代码现状

1. 已有 BullMQ 基础设施
   - `src/lib/task/queues.ts`：按 task type 分配 `image / video / voice / text` 队列，默认未知文本类任务进入 text 队列。
   - `src/lib/task/submitter.ts`：统一创建 `Task`、发布 task event、调用 `addTaskJob` 入队。
   - `src/lib/workers/text.worker.ts`：Text Worker 消费 `nori-text` 队列并按 `TASK_TYPE` 分发 handler。
   - `src/lib/workers/shared.ts`：`withTaskLifecycle` 负责 processing、progress、completed、failed 状态与事件。
   - `tests/system/helpers/workers.ts`：系统测试可启动真实 text worker。
   - `tests/system/helpers/tasks.ts`：系统测试可等待 Task 终态并检查 lifecycle event。

2. 已有编剧工作台对象
   - `ScreenwriterTask`：任务主记录。
   - `ScreenwriterStageState`：阶段状态。
   - `ScreenwriterSettingsReview`：源设定/目标设定检查点产物。
   - `ScreenwriterScriptEpisode`：源剧本/目标剧本分集。
   - `ScreenwriterArtifact`：源剧本原文、事实卡、Mock 中间产物。

3. 当前缺口
   - `POST /api/screenwriter/script-repaint` 创建任务后，没有提交 BullMQ job。
   - `auto_split / fact_extract / target_settings / episode_repaint` 不会被 worker 消费推进。
   - 前端轮询只能看到初始状态，无法自然进入源设定检查点、目标设定检查点和目标剧本页。

### 2. 系统测试设计

先添加必定失败的系统测试：

```text
tests/system/screenwriter-script-repaint.system.test.ts
```

测试目标：证明 `docs/architecture.md` 的剧本转绘互动链路可运行。

测试步骤：

1. reset system DB，并 mock 登录用户。
2. 调用 `POST /api/screenwriter/script-repaint` 创建剧本转绘任务。
3. 启动 `startSystemWorkers(['text'])`。
4. 轮询 `GET /api/screenwriter/script-repaint/:taskId`，等待自动拆集和事实卡提取完成后进入：

```text
currentStage = source_settings
currentStageStatus = waiting_check
```

5. 调用 `POST /api/screenwriter/script-repaint/:taskId/stages/source_settings/approve`。
6. 轮询等待进入：

```text
currentStage = target_settings
currentStageStatus = waiting_check
```

7. 调用 `POST /api/screenwriter/script-repaint/:taskId/stages/target_settings/approve`。
8. 轮询等待逐集转绘完成并进入目标剧本：

```text
currentStage = target_script
currentStageStatus = succeeded
```

9. 调用 `GET /api/screenwriter/script-repaint/:taskId/target-script`，断言至少有一集目标剧本。
10. 查询 Task 表和 TaskEvent 表，断言 Mock BullMQ task 至少经历：

```text
task.created -> task.processing -> task.completed
```

测试第一版应先失败，失败原因是创建任务后没有 producer 入队，也没有 consumer 推进阶段。

### 3. Task 类型和队列设计

新增一个 Mock 专用任务类型：

```ts
TASK_TYPE.SCREENWRITER_SCRIPT_REPAINT_MOCK = 'screenwriter_script_repaint_mock'
```

队列：

```text
text queue / nori-text
```

理由：

1. Mock 任务是文本编排类任务，不涉及图片、视频、语音队列。
2. 复用 `createTextWorker`、`withTaskLifecycle`、系统测试 worker helper。
3. 后续真实 AI 接入时仍可留在 text queue，或拆分为更细 task type。

Mock job payload 建议：

```ts
{
  screenwriterTaskId: string
  stage: 'auto_split' | 'fact_extract' | 'target_settings' | 'episode_repaint'
  sourceStage?: string
  nextStage?: string
  sleepMs: 10_000
}
```

`source_settings` 和 `target_settings` 是人工检查点，不由 worker 自动 approve；worker 只负责生成检查点产物并把阶段置为 `waiting_check`。

### 4. Producer 设计

新增 screenwriter 专用生产者模块，避免 API route 直接操作 BullMQ：

```text
src/lib/screenwriter/task-producer.ts
```

职责：

1. `enqueueScriptRepaintMockStage({ userId, taskId, stage, requestId })`
   - 调用 `submitTask`。
   - `projectId` 可用 `ScreenwriterTask.sourceProjectId || ScreenwriterTask.id`。如果使用 task id 作为 projectId，需要在计划实现时确认 `Task.projectId` 是否有外键约束；若有外键约束，则新增 screenwriter 专用轻量入队函数或显式绑定 project。
   - `targetType = 'screenwriter_task'`
   - `targetId = screenwriterTaskId`
   - `payload.stage = stage`
   - `payload.sleepMs = 10_000`
2. 创建剧本转绘任务后立即提交 `auto_split` Mock job。
3. 人工确认源设定后提交 `target_settings` Mock job。
4. 人工确认目标设定后提交 `episode_repaint` Mock job。

事实卡提取可以有两种实现方式：

1. 方案 A：`auto_split` worker 完成后由 worker 内部继续 enqueue `fact_extract`。
2. 方案 B：`auto_split` worker 完成后只推进到 `fact_extract running`，再由 service 显式 enqueue。

第一版建议采用方案 A，生产者仍通过 `task-producer.ts` 复用入队逻辑；系统测试更接近真实异步串联。

### 5. Consumer 设计

新增 handler：

```text
src/lib/workers/handlers/screenwriter-script-repaint-mock.ts
```

接入点：

```text
src/lib/workers/text.worker.ts
```

处理规则：

1. 进入 handler 后先 `reportTaskProgress(job, 10, { stage })`。
2. `await sleep(payload.sleepMs ?? 10_000)`。
3. 根据 `payload.stage` 写入 Mock 产物并推进阶段。

阶段行为：

1. `auto_split`
   - 标记 `auto_split` succeeded。
   - 根据源剧本原文生成至少 1 条 `ScreenwriterScriptEpisode(scriptKind=source)`。
   - 写入 `ScreenwriterArtifact(auto_split_result)`。
   - 标记 `fact_extract` running。
   - enqueue `fact_extract` Mock job。

2. `fact_extract`
   - 标记 `fact_extract` succeeded。
   - 写入 `ScreenwriterArtifact(episode_fact_cards)`。
   - 创建或更新 `ScreenwriterSettingsReview(stageKey=source_settings, status=waiting_check)`。
   - 标记 `source_settings` waiting_check。
   - 更新 `ScreenwriterTask.currentStage = source_settings`、`currentStageStatus = waiting_check`。

3. `target_settings`
   - 标记 `target_settings` waiting_check。
   - 创建或更新 `ScreenwriterSettingsReview(stageKey=target_settings, status=waiting_check)`。
   - 更新 `ScreenwriterTask.currentStage = target_settings`、`currentStageStatus = waiting_check`。

4. `episode_repaint`
   - 标记 `episode_repaint` running 后逐集写入 `ScreenwriterEpisodeProcess(stageKey=episode_repaint)`。
   - 写入至少 1 条 `ScreenwriterScriptEpisode(scriptKind=target)`。
   - 标记 `episode_repaint` succeeded。
   - 更新 `ScreenwriterTask.currentStage = target_script`、`currentStageStatus = succeeded`。

所有 DB 更新必须做幂等设计：

1. 使用 `upsert` 或先查再写，避免 BullMQ retry 导致重复分集。
2. `ScreenwriterStageState` 以 `screenwriterTaskId + stageKey` 唯一约束更新。
3. `ScreenwriterScriptEpisode` 以 `screenwriterTaskId + scriptKind + episodeNumber + version` 唯一约束更新。
4. handler 开始时检查任务是否仍处于当前阶段，已完成时直接返回 `{ skipped: true }`。

### 6. Service 改造边界

建议新增 screenwriter workflow service，而不是把所有逻辑塞进 `service.ts`：

```text
src/lib/screenwriter/workflow.ts
```

职责：

1. `markScriptRepaintStageRunning`
2. `completeAutoSplitMockStage`
3. `completeFactExtractMockStage`
4. `completeTargetSettingsMockStage`
5. `completeEpisodeRepaintMockStage`
6. `approveScriptRepaintCheckpointAndEnqueueNext`

现有 `approveStage` 已支持检查点推进，但需要改为：

1. 如果 `taskKind=script_repaint_2` 且 approve `source_settings`，则进入 `target_settings running` 并 enqueue `target_settings`。
2. 如果 `taskKind=script_repaint_2` 且 approve `target_settings`，则进入 `episode_repaint running` 并 enqueue `episode_repaint`。
3. 视频转绘逻辑不受影响。

### 7. 前端轮询影响

前端无需新增页面。现有 `FosScriptRepaintFlowClient` 轮询非检查点阶段即可发现后端状态变化。

需要确认：

1. 轮询阶段包括 `auto_split`、`fact_extract`、`episode_repaint`。
2. 检查点按钮调用 approve 后跳转到后端返回的下一阶段。
3. 目标剧本页通过 `GET /api/screenwriter/script-repaint/:taskId/target-script` 能读到 worker 写入的目标剧本。

### 8. TDD 实施顺序

按 Red-Green-Refactor 执行：

1. Red：新增 `tests/system/screenwriter-script-repaint.system.test.ts`
   - 创建任务。
   - 启动 text worker。
   - 等待 source settings checkpoint。
   - approve source settings。
   - 等待 target settings checkpoint。
   - approve target settings。
   - 等待 target script。
   - 断言目标剧本存在。
   - 断言 Mock Task lifecycle events 存在。

2. Red：新增单元测试
   - `task-producer` 会调用 `submitTask` 并写入正确 payload。
   - Mock handler 对每个 stage 的 DB 更新是幂等的。
   - `approveStage` 对 `script_repaint_2` 会 enqueue 下一阶段 Mock task。
   - `TASK_TYPE.SCREENWRITER_SCRIPT_REPAINT_MOCK` 进入 text queue。

3. Green：实现最小生产者
   - 新 task type。
   - `getQueueTypeByTaskType` 默认 text 可覆盖，但测试应显式证明该 task type 走 text。
   - 创建剧本转绘任务后 enqueue `auto_split`。

4. Green：实现最小消费者
   - 新 handler sleep 10s。
   - 写入 Mock 产物。
   - 推进阶段。
   - 串联 enqueue 下一非检查点阶段。

5. Green：接入 approve 后生产下一阶段
   - source settings approve -> target settings mock job。
   - target settings approve -> episode repaint mock job。

6. Refactor
   - 把 screenwriter 阶段推进封装到 `workflow.ts`。
   - 去掉 handler 中重复 JSON 构造。
   - 补齐错误处理和幂等检查。

### 9. 验证命令

优先运行：

```bash
npx vitest run tests/unit/screenwriter tests/unit/task tests/unit/worker/screenwriter-script-repaint-mock.test.ts
npx vitest run tests/system/screenwriter-script-repaint.system.test.ts
npm run typecheck
```

如果系统测试需要 Redis/MySQL，沿用现有 system 测试环境准备方式。不要在测试中调用真实 AI Provider。

## 完成标准

1. `tests/system/screenwriter-script-repaint.system.test.ts` 先能在未接 BullMQ 时失败，失败原因指向阶段未被 worker 推进。
2. 新增 `TASK_TYPE.SCREENWRITER_SCRIPT_REPAINT_MOCK`，并确认进入 text queue。
3. `POST /api/screenwriter/script-repaint` 创建任务后会提交 `auto_split` Mock BullMQ job。
4. Text Worker 能消费 Mock job，sleep 10s 后推进 `auto_split`、`fact_extract`、`target_settings`、`episode_repaint`。
5. `fact_extract` 完成后任务进入源设定检查点，状态为 `waiting_check`。
6. 源设定 approve 后提交目标设定 Mock job，并最终进入目标设定检查点。
7. 目标设定 approve 后提交逐集转绘 Mock job，并最终生成至少 1 条目标剧本。
8. 系统测试能完整跑通：创建任务 -> 自动拆集 -> 事实卡提取 -> 源设定检查点 -> 目标设定检查点 -> 逐集转绘 -> 目标剧本。
9. Mock Task 在 `Task` 和 `TaskEvent` 中有可验证生命周期：created、processing、completed。
10. `npm run typecheck` 通过，相关单元测试和系统测试通过。
