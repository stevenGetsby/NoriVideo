# 剧本转绘功能链路实现计划

- Status: Active
- Last sync with code: 13de5bbc6d97825ccb91d94adc7c006638cf2627
- Date: 2026/7/3

## Changed Items

## 目标

仿照已实现的编剧工作台视频转绘链路，在 `/screenwriter` 下实现“剧本转绘 2.0”完整功能链路。用户可以从编剧工作台新建或继续剧本转绘任务，上传或选择源剧本，填写转绘目标，经过自动拆集、事实卡提取、源设定检查点、目标设定检查点、逐集转绘，最终查看和编辑目标剧本。

链路以 `docs/architecture.md` 中的剧本转绘功能为准：

```text
源剧本 -> 目标剧本
```

对应阶段：

```text
1. 自动拆集
2. 事实卡提取
3. 设定提炼（人工检查点）
4. 目标设定（人工检查点）
5. 逐集转绘
```

本计划不修改 `docs/architecture.md`。若后续发现用户提到的 `docs/arch.md` 是新增文档或未跟踪文件，需要先同步该文档内容再调整本计划。

## 相关细节

### 1. 现有链路判断

当前代码已实现视频转绘 2.0 的前后端骨架：

1. 前端页面入口：
   - `src/app/[locale]/screenwriter/page.tsx`
   - `src/app/[locale]/screenwriter/video-repaint/page.tsx`
   - `src/app/[locale]/screenwriter/video-repaint/[taskId]/*`
2. 前端组件：
   - `src/components/frameos/FosScreenwriterClient.tsx`
   - `src/components/frameos/FosVideoRepaintClient.tsx`
   - `src/components/frameos/FosVideoRepaintFlowClient.tsx`
   - `src/components/frameos/screenwriter/*`
3. 后端 API：
   - `GET /api/screenwriter/tasks`
   - `POST /api/screenwriter/video-repaint`
   - `GET/PATCH /api/screenwriter/video-repaint/:taskId`
   - `POST /api/screenwriter/video-repaint/:taskId/stages/:stage/run`
   - `POST /api/screenwriter/video-repaint/:taskId/stages/:stage/retry`
   - `POST /api/screenwriter/video-repaint/:taskId/stages/:stage/approve`
   - `POST /api/screenwriter/video-repaint/:taskId/source-settings/regenerate`
   - `POST /api/screenwriter/video-repaint/:taskId/target-settings/regenerate`
   - `GET/PATCH /api/screenwriter/video-repaint/:taskId/target-script`
4. 后端对象：
   - `ScreenwriterTask`
   - `ScreenwriterStageState`
   - `ScreenwriterSettingsReview`
   - `ScreenwriterReviewFeedback`
   - `ScreenwriterEpisodeProcess`
   - `ScreenwriterScriptEpisode`
   - `ScreenwriterNameMapping`
   - `ScreenwriterArtifact`
   - `ScreenwriterSourceVideo`

视频转绘链路中与“视频源、视频反译、逐集对齐”强相关的内容不应直接搬到剧本转绘；剧本转绘需要复用编剧工作台底座，但阶段集合和输入对象应独立表达。

### 2. 前端可复用页面和对象

优先复用这些组件和交互对象：

1. 编剧工作台入口
   - 复用 `ScreenwriterWorkbench`、`ScreenwriterModeCards`、`ScreenwriterScriptSidebar`。
   - 修改 `FosScreenwriter` 中 `script-repaint-2` 的行为：从当前打开 `RepaintDialog` 改为跳转 `/screenwriter/script-repaint`。
   - `ScreenwriterScriptSummary.taskKind` 已包含 `script_repaint_2`，可复用左侧任务列表与继续任务跳转。

2. 流程壳和阶段导航
   - 复用 `VideoRepaintFlowShell` 与 `VideoRepaintStageNav` 的布局，但建议重命名或包装为 `ScreenwriterRepaintFlowShell` / `RepaintStageNav`，避免组件名继续绑定 video。
   - 剧本转绘阶段不展示 `episode_alignment`。
   - 默认阶段顺序为：

```text
auto_split -> fact_extract -> source_settings -> target_settings -> episode_repaint -> target_script
```

3. 检查点页面
   - 复用 `SettingsReviewPage`、`NameIndexPanel`、`MappingPanel`、`ReviewIssuePanel`。
   - 源设定检查点继续展示人物、世界观、场景、风格、称呼归一、复核问题。
   - 目标设定检查点继续展示用户目标、源设定摘要、源目标映射、改编规则和复核问题。

4. 逐集处理与目标剧本
   - 复用 `EpisodeProgressGrid` 表达逐集转绘状态。
   - 复用 `TargetScriptReview` 展示和编辑目标剧本。
   - 不复用逐集对齐页面，因为剧本转绘架构没有视频与剧本对齐阶段。

5. 新建任务表单
   - 参考 `VideoRepaintCreateForm` 新增 `ScriptRepaintCreateForm`。
   - 保留字段：任务名称、转绘需求、检查点配置。
   - 替换字段：参考视频上传改为源剧本输入。
   - 源剧本输入第一版支持：
     - 上传文本文件或粘贴全文。
     - 从工作台选择已有剧本稿可作为后续增强。
   - 校验规则：任务名称、源剧本文本或源剧本文件、转绘需求均必填。

6. 前端 API client
   - 参考 `screenwriterApi.ts` 增加 `createScriptRepaintTask`、`fetchScriptRepaintTask` 等函数。
   - 短期可以复用同一 DTO 结构，但命名上应避免新增 `VideoRepaint*` 类型继续扩散。
   - 建议逐步抽象：

```ts
ScreenwriterRepaintStageKey
ScreenwriterRepaintRouteStage
ScreenwriterRepaintTaskDetail
ScriptRepaintCreateInput
```

### 3. 建议前端路由

新增剧本转绘独立路由，保持与视频转绘平行：

```text
/[locale]/screenwriter/script-repaint
/[locale]/screenwriter/script-repaint/[taskId]
/[locale]/screenwriter/script-repaint/[taskId]/source-settings
/[locale]/screenwriter/script-repaint/[taskId]/target-settings
/[locale]/screenwriter/script-repaint/[taskId]/episode-repaint
/[locale]/screenwriter/script-repaint/[taskId]/target-script
```

不新增 `episode-alignment` 路由。任务列表中的 `nextRoute` 需要根据 `taskKind` 返回 video 或 script 对应路径。

### 4. 后端可复用对象和接口

优先复用现有 `screenwriter` 专用对象，不复用 `/api/projects`、`/api/novel-promotion/*`、`/api/workflow/*` 来拼装主链路。

1. `ScreenwriterTask`
   - 复用 `taskKind = script_repaint_2`。
   - 复用 `title`、`requirement`、`episodeCount`、`currentStage`、`currentStageStatus`、`checkpointConfig`。
   - `transferForm` 对剧本转绘可固定为 `script`。
   - `uploadMode` 可继续临时复用为 `file | paste | workspace`，但如果要保持字段语义干净，建议新增 `sourceInputMode` 字段或放入 `ScreenwriterArtifact`。

2. `ScreenwriterScriptEpisode`
   - 用于保存自动拆集后的源剧本和逐集转绘后的目标剧本。
   - `scriptKind = source | target` 可直接满足剧本转绘。
   - `sourceVideoId` 不使用。
   - 若源剧本先以整本形式上传，自动拆集结果写入多条 `source` episode。

3. `ScreenwriterArtifact`
   - 复用保存源剧本原文、自动拆集包、事实卡、模型输入输出摘要。
   - 建议 artifact type：

```text
source_script_raw
auto_split_result
episode_fact_cards
source_settings_input
target_settings_input
episode_repaint_input
episode_repaint_output
```

4. `ScreenwriterStageState`
   - 复用保存每阶段状态、进度、错误和检查点。
   - 剧本转绘创建时只初始化 5 个阶段：

```text
auto_split
fact_extract
source_settings
target_settings
episode_repaint
```

5. `ScreenwriterSettingsReview`
   - 复用保存源设定检查点与目标设定检查点产物。
   - `source_settings` 的 `nameIndexGroups` 保存称呼归一。
   - `target_settings` 的 `mappingGroups` 保存源目标映射。

6. `ScreenwriterReviewFeedback`
   - 复用保存检查点反馈、重新提炼、重新生成、确认通过。

7. `ScreenwriterEpisodeProcess`
   - 复用逐集转绘状态。
   - 剧本转绘不创建 `episode_alignment` 记录。
   - 如需要展示事实卡逐集提取状态，可使用 `stageKey = fact_extract` 的记录；若保持当前类型约束不动，则用 `ScreenwriterArtifact` + 阶段进度先满足第一版。

8. `ScreenwriterNameMapping`
   - 复用保存跨集称呼归一和源目标角色、地点、道具、术语映射。

9. `ScreenwriterSourceVideo`
   - 剧本转绘不复用该对象。
   - 不应为了上传文本而把剧本文本塞进 `sourceVideos.fileName` 或视频字段。

### 5. 建议后端接口

新增 `/api/screenwriter/script-repaint/*`，与现有 video 接口平行：

```text
POST   /api/screenwriter/script-repaint
GET    /api/screenwriter/script-repaint/:taskId
PATCH  /api/screenwriter/script-repaint/:taskId
POST   /api/screenwriter/script-repaint/:taskId/stages/:stage/run
POST   /api/screenwriter/script-repaint/:taskId/stages/:stage/retry
POST   /api/screenwriter/script-repaint/:taskId/stages/:stage/approve
POST   /api/screenwriter/script-repaint/:taskId/source-settings/regenerate
POST   /api/screenwriter/script-repaint/:taskId/target-settings/regenerate
GET    /api/screenwriter/script-repaint/:taskId/source-script
PATCH  /api/screenwriter/script-repaint/:taskId/source-script
GET    /api/screenwriter/script-repaint/:taskId/target-script
PATCH  /api/screenwriter/script-repaint/:taskId/target-script/:episodeId
```

`GET /api/screenwriter/tasks` 继续作为统一任务列表接口，但需要支持 `taskKind=script_repaint_2`，并在 DTO 中返回正确 `nextRoute`。

服务层建议新增或抽象：

```text
createScriptRepaintTask
getScriptRepaintTaskDetail
updateScriptRepaintRequirement
runScriptRepaintStage
retryScriptRepaintStage
approveScriptRepaintStage
regenerateScriptRepaintSettings
listScriptRepaintTargetEpisodes
updateScriptRepaintTargetEpisode
```

实现时可以先抽出公共 `screenwriter repaint` 服务能力，避免复制 `createStageRows`、`nextStage`、DTO 转换、检查点 approve 逻辑。

### 6. 执行编排边界

第一版可以先实现真实持久化接口和可轮询状态，但 AI 处理可保持任务状态占位；后续接入 worker 时必须通过模型网关和任务系统，不允许 API route 直接调用模型。

阶段产物建议：

1. 自动拆集
   - 输入：源剧本文本或源剧本文件内容。
   - 输出：`ScreenwriterScriptEpisode(scriptKind=source)` 多集记录、`auto_split_result` artifact。
2. 事实卡提取
   - 输入：源剧本分集。
   - 输出：逐集事实卡 artifact。
3. 源设定
   - 输入：事实卡集合。
   - 输出：`ScreenwriterSettingsReview(stageKey=source_settings)`、`ScreenwriterNameMapping`。
4. 目标设定
   - 输入：用户转绘需求、源设定、称呼归一。
   - 输出：`ScreenwriterSettingsReview(stageKey=target_settings)`、源目标映射。
5. 逐集转绘
   - 输入：源剧本分集、源设定、目标设定。
   - 输出：`ScreenwriterScriptEpisode(scriptKind=target)`、`ScreenwriterEpisodeProcess(stageKey=episode_repaint)`。

### 7. TDD 实施顺序

按 Red-Green-Refactor 执行：

1. Red：新增前端路由与跳转测试
   - `script-repaint-2` 模式卡点击后应跳转 `/screenwriter/script-repaint`。
   - `script_repaint_2` 任务的 `nextRoute` 应返回 `/screenwriter/script-repaint/:taskId/...`。
2. Red：新增 `ScriptRepaintCreateForm` 校验测试
   - 未填写任务名称、源剧本、转绘需求时失败。
   - 粘贴源剧本文本或选择文本文件后可提交。
3. Red：新增 API client 测试
   - `createScriptRepaintTask` 调用 `/api/screenwriter/script-repaint`。
   - `fetchScriptRepaintTask`、approve、regenerate、target-script 使用 script 路径。
4. Red：新增 route 测试
   - `POST /api/screenwriter/script-repaint` 创建 `script_repaint_2`。
   - `GET /api/screenwriter/script-repaint/:taskId` 只返回当前用户任务。
   - `approve` 不允许非检查点阶段。
5. Red：新增 service 测试
   - 创建任务时不创建 `ScreenwriterSourceVideo`。
   - 创建任务时初始化 5 个阶段，且没有 `episode_alignment`。
   - 源剧本原文保存到 `ScreenwriterArtifact(source_script_raw)` 或按最终选择的数据对象保存。
6. Green：实现最小前端页面、API route、service 和 DTO，让新增测试通过。
7. Green：接入流程页轮询、检查点确认、目标剧本列表与编辑。
8. Refactor：将 video/script 共用逻辑抽到通用 `screenwriter repaint` 类型、路由和服务工具，保留业务差异配置。
9. Refactor：补齐空状态、加载态、错误态、移动端布局和中英文文案。

如果测试需要模拟第三方 AI 服务，必须先和用户确认；第一阶段测试应优先 mock 本地 service/Prisma 边界，不模拟外部 Provider。

### 8. 推荐实施文件

前端新增或调整：

```text
src/app/[locale]/screenwriter/script-repaint/page.tsx
src/app/[locale]/screenwriter/script-repaint/[taskId]/page.tsx
src/app/[locale]/screenwriter/script-repaint/[taskId]/source-settings/page.tsx
src/app/[locale]/screenwriter/script-repaint/[taskId]/target-settings/page.tsx
src/app/[locale]/screenwriter/script-repaint/[taskId]/episode-repaint/page.tsx
src/app/[locale]/screenwriter/script-repaint/[taskId]/target-script/page.tsx
src/components/frameos/FosScriptRepaintClient.tsx
src/components/frameos/FosScriptRepaintFlowClient.tsx
src/components/frameos/screenwriter/ScriptRepaintCreateForm.tsx
src/components/frameos/screenwriter/screenwriterApi.ts
src/components/frameos/screenwriter/screenwriterRoutes.ts
src/components/frameos/screenwriter/types.ts
```

后端新增或调整：

```text
src/app/api/screenwriter/script-repaint/route.ts
src/app/api/screenwriter/script-repaint/[taskId]/route.ts
src/app/api/screenwriter/script-repaint/[taskId]/stages/[stage]/run/route.ts
src/app/api/screenwriter/script-repaint/[taskId]/stages/[stage]/retry/route.ts
src/app/api/screenwriter/script-repaint/[taskId]/stages/[stage]/approve/route.ts
src/app/api/screenwriter/script-repaint/[taskId]/source-settings/regenerate/route.ts
src/app/api/screenwriter/script-repaint/[taskId]/target-settings/regenerate/route.ts
src/app/api/screenwriter/script-repaint/[taskId]/source-script/route.ts
src/app/api/screenwriter/script-repaint/[taskId]/target-script/route.ts
src/app/api/screenwriter/script-repaint/[taskId]/target-script/[episodeId]/route.ts
src/lib/screenwriter/types.ts
src/lib/screenwriter/routes.ts
src/lib/screenwriter/dto.ts
src/lib/screenwriter/service.ts
```

测试新增或调整：

```text
tests/unit/components/script-repaint-flow.test.ts
tests/unit/components/screenwriter-interaction.test.ts
tests/unit/screenwriter/client.test.ts
tests/unit/screenwriter/routes.test.ts
tests/unit/screenwriter/service.test.ts
```

## 完成标准

1. `/screenwriter` 的“剧本转绘 2.0”入口可以进入新建剧本转绘任务页，不再停留在未接后端的弹窗。
2. 用户可以提交任务名称、源剧本、转绘需求和检查点配置，后端创建 `taskKind=script_repaint_2` 的 `ScreenwriterTask`。
3. 新建剧本转绘任务不会创建 `ScreenwriterSourceVideo`，源剧本使用 `ScreenwriterScriptEpisode` 或 `ScreenwriterArtifact` 持久化。
4. 剧本转绘任务只包含 `auto_split`、`fact_extract`、`source_settings`、`target_settings`、`episode_repaint` 五个业务阶段，并能进入 `target_script` 查看结果页。
5. 源设定和目标设定两个检查点支持查看、反馈重新生成、确认继续。
6. 逐集转绘页面支持按集展示状态，目标剧本页支持读取和保存单集目标剧本。
7. `GET /api/screenwriter/tasks` 对 `video_repaint_2` 与 `script_repaint_2` 返回各自正确的 `nextRoute`。
8. 新增或更新的单元测试覆盖前端表单、路由生成、API client、API route、service 创建和检查点推进逻辑。
9. 相关测试通过，至少运行：

```bash
npm run typecheck
npm run test:unit:all
```
