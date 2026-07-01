# 剧本级视频转绘前端页面实现计划

- Status: Active
- Last sync with code: 6307b7efbe977dea2b0baeb8dca66e891aa5f514
- Date: 2026/7/1

## Changed Items

## 实现意见
1. [&先不依赖任何后端实际接口，先 mock，先将前端互动链路完成&]

## 目标

实现“剧本级视频转绘”用户链路的前端页面方案：用户可以上传单集或多集视频，填写转绘目标与保留策略，启动转绘流程，并在视频反译、设定提炼、逐集对齐、目标设定、逐集转绘等阶段看到进度、进入人工检查点页面、修改阶段产物，最后查看、编辑和导出目标剧本。

本计划只定义前端页面、组件、状态展示、路由和接口依赖，不直接设计数据库 schema 或后端任务编排。后端业务边界参考 `docs/工作计划.md`。

## 相关细节

### 现有可复用前端对象

1. 工作台外壳与导航
   - `src/components/frameos/FosShell.tsx`：可复用主应用 Shell、顶部栏、左侧导航、深色后台工作台视觉。
   - `src/components/frameos/FosProjectHeader.tsx`：可复用项目内页标题、返回、项目上下文。
   - `src/components/frameos/FosWorkflowClient.tsx`：可参考当前工作流视图分发方式，但转绘链路建议新增独立 Client，避免把“短剧生产”和“视频转绘”阶段语义混在同一组件中。

2. 项目与工作流页面模式
   - `src/components/frameos/FosProjectsClient.tsx`：可复用项目列表、创建入口、搜索、空状态和进入项目路径的交互模式。
   - `src/components/frameos/CreateProjectDialog.tsx`：可参考弹窗式创建表单、文件上传入口、分段控件和错误状态。
   - `src/components/frameos/views/FosWorkbenchOverview.tsx`：可参考阶段卡片式总览、阶段状态、主要操作入口。
   - `src/components/frameos/views/FosScriptReview.tsx`：可参考“左侧分集列表 + 右侧正文/结构化内容 + 底部审阅操作”的检查点页面结构。

3. 任务状态与异步反馈
   - `src/components/task/TaskStatusInline.tsx`：可复用行内运行/错误状态。
   - `src/components/task/TaskStatusOverlay.tsx`：可复用局部遮罩式任务状态。
   - `src/app/api/runs/*`、`src/app/api/tasks/*` 对应的前端调用模式可用于阶段进度轮询或 SSE 更新。

4. 上传与资产选择
   - `src/app/api/storage/sign/route.ts`：可作为视频上传签名接口依赖。
   - `src/components/shared/assets/DirectUploadSection.tsx`：目前偏图片上传，可参考交互结构；视频上传应新增专用组件，不直接复用图片过滤逻辑。
   - `src/app/[locale]/workspace/asset-hub/*` 与 `src/components/shared/assets/*`：可参考资产卡片、资产选择器、编辑弹窗、空状态。

5. 编辑类页面
   - `src/components/ui/SegmentedControl.tsx`、`src/components/ui/primitives/*`、`src/components/ui/icons/AppIcon.tsx`：用于构建保留策略、目标类型、导出格式、状态按钮等基础控件。
   - `src/components/llm-console/LLMStageStreamCard.tsx`：如需要展示 AI 阶段输出流，可参考其阶段日志呈现方式。

### 建议路由

新增独立的转绘入口与工作流路由：

```text
/[locale]/video-redraw
/[locale]/video-redraw/new
/[locale]/video-redraw/[redrawProjectId]
/[locale]/video-redraw/[redrawProjectId]/source-settings
/[locale]/video-redraw/[redrawProjectId]/alignment
/[locale]/video-redraw/[redrawProjectId]/target-settings
/[locale]/video-redraw/[redrawProjectId]/target-script
```

如果后续产品希望并入项目工作台，也可以增加项目内别名：

```text
/[locale]/workflow/[projectId]/redraw
```

第一阶段优先使用 `/video-redraw/*` 独立链路，降低对现有 `/workflow/[projectId]/workbench-premium2` 的耦合。

### 页面拆分

1. 转绘项目列表页：`/video-redraw`
   - 展示当前用户的视频转绘项目。
   - 卡片信息包括项目名、视频集数、当前阶段、检查点状态、更新时间。
   - 提供新建项目、搜索、继续处理、查看已完成结果。
   - 可复用 `FosShell` 和 `FosProjectsClient` 的布局思想，但卡片字段应使用转绘业务状态。

2. 新建转绘项目页：`/video-redraw/new`
   - 目前只支持上传一个视频
   - 填写转绘目标：题材、时代、世界观、人物关系、风格、目标受众、输出粒度[&一个输入框的形式&]。
   - 配置保留策略：剧情结构、人物关系、对白、动作、镜头节奏、场景关系。
   - 启动前做本地校验：至少一个视频、目标描述非空、文件上传完成。

3. 转绘总览页：`/video-redraw/[redrawProjectId]`
   - 顶部展示项目名、整体状态、当前阶段、失败/等待检查提示。
   - 主体使用五段阶段卡片：
     1. 视频反译
     2. 设定提炼
     3. 逐集对齐
     4. 目标设定
     5. 逐集转绘
   - 阶段卡片展示状态、产物摘要、错误信息、重试、进入检查点、继续执行。
   - 视频反译支持分集并行进度：按集展示 `pending / running / succeeded / failed`。

4. 源设定检查页：`/source-settings`
   - 对应“设定提炼”人工检查点。
   - 左侧导航为设定类型：人物、世界观、场景、风格、道具/组织。
   - 右侧为结构化编辑表单和原文引用。
   - 用户可修改源设定、保存草稿、请求重新提炼、审阅通过。
   - 审阅通过后解锁逐集对齐阶段。

5. 逐集对齐检查页：`/alignment`
   - 对应“逐集对齐”人工检查点。
   - 左侧为分集列表与对齐状态。
   - 中间为视频播放器/时间轴片段。
   - 右侧为源剧本段落、场景、镜头列表。
   - 支持查看时间码、镜头编号、剧本片段、置信度和异常提示。
   - 第一阶段以查看和轻量修正为主：调整段落归属、标记错误、重新对齐某一集。
   - 审阅通过后解锁目标设定阶段。

6. 目标设定检查页：`/target-settings`
   - 对应“目标设定”人工检查点。
   - 展示用户目标、源设定摘要和 AI 生成的目标设定总纲。
   - 支持编辑目标人物、世界观、场景、风格、改编规则。
   - 支持重新生成目标设定。
   - 审阅通过后解锁逐集转绘阶段。

7. 目标剧本页：`/target-script`
   - 展示逐集转绘生成的目标剧本。
   - 左侧为分集列表，标明生成状态和字数。
   - 右侧为剧本编辑器，支持查看源剧本对照、目标设定引用和对齐片段引用。
   - 支持保存编辑、重新生成单集、导出 Markdown、导出 JSON、进入后续视频生成链路。

### 前端状态模型

前端需要统一渲染这些阶段状态：

```text
not_started
ready
queued
running
waiting_check
approved
failed
canceled
succeeded
```

检查点状态：

```text
unchecked
editing
approved
rejected
regenerating
```

分集并行任务状态：

```text
pending
running
succeeded
failed
retrying
skipped
```

阶段状态展示规则：

1. `running` 阶段显示进度条、当前子任务、分集并行状态和运行日志入口。
2. `waiting_check` 阶段必须显示“进入检查”主按钮。
3. `failed` 阶段显示错误摘要、失败分集、重试按钮和查看日志入口。
4. 未解锁阶段展示前置要求，不提供主操作。
5. 已通过检查点展示审阅人、审阅时间和“撤销通过”入口，撤销能力依赖后端支持。

### 建议前端文件结构

```text
src/app/[locale]/video-redraw/page.tsx
src/app/[locale]/video-redraw/new/page.tsx
src/app/[locale]/video-redraw/[redrawProjectId]/page.tsx
src/app/[locale]/video-redraw/[redrawProjectId]/source-settings/page.tsx
src/app/[locale]/video-redraw/[redrawProjectId]/alignment/page.tsx
src/app/[locale]/video-redraw/[redrawProjectId]/target-settings/page.tsx
src/app/[locale]/video-redraw/[redrawProjectId]/target-script/page.tsx

src/components/video-redraw/VideoRedrawShell.tsx
src/components/video-redraw/VideoRedrawProjectList.tsx
src/components/video-redraw/VideoRedrawCreateForm.tsx
src/components/video-redraw/VideoUploadQueue.tsx
src/components/video-redraw/RedrawStageOverview.tsx
src/components/video-redraw/RedrawStageCard.tsx
src/components/video-redraw/RedrawEpisodeProgress.tsx
src/components/video-redraw/SourceSettingsReview.tsx
src/components/video-redraw/AlignmentReview.tsx
src/components/video-redraw/TargetSettingsReview.tsx
src/components/video-redraw/TargetScriptEditor.tsx
src/components/video-redraw/useVideoRedrawProject.ts
```

### 依赖接口契约

前端实现前需要后端提供或确认以下接口。命名可以调整，但语义应稳定：

```text
GET    /api/video-redraw/projects
POST   /api/video-redraw/projects
GET    /api/video-redraw/projects/:id
PATCH  /api/video-redraw/projects/:id
POST   /api/video-redraw/projects/:id/start
POST   /api/video-redraw/projects/:id/stages/:stage/retry
POST   /api/video-redraw/projects/:id/stages/:stage/approve
POST   /api/video-redraw/projects/:id/stages/:stage/unapprove

POST   /api/video-redraw/projects/:id/videos
PATCH  /api/video-redraw/projects/:id/videos/:videoId
DELETE /api/video-redraw/projects/:id/videos/:videoId

GET    /api/video-redraw/projects/:id/source-settings
PATCH  /api/video-redraw/projects/:id/source-settings
GET    /api/video-redraw/projects/:id/alignment
PATCH  /api/video-redraw/projects/:id/alignment
GET    /api/video-redraw/projects/:id/target-settings
PATCH  /api/video-redraw/projects/:id/target-settings
GET    /api/video-redraw/projects/:id/target-script
PATCH  /api/video-redraw/projects/:id/target-script/:episodeId
POST   /api/video-redraw/projects/:id/export
```

运行中状态可复用现有 `runs` 或 `tasks`：

```text
GET /api/runs/:runId
GET /api/runs/:runId/events
GET /api/tasks/:taskId
```

### 实施顺序

TDD 开发
1. Red：为新建表单、阶段总览、检查点状态渲染补组件测试，先覆盖核心用户行为。
2. Green：实现静态页面和 mock 数据版组件，使路由、布局、状态流转可见。
3. Green：接入项目列表、新建、详情、阶段状态接口。
4. Green：接入视频上传、启动转绘、阶段重试和检查点 approve/unapprove。
5. Refactor：抽出通用阶段卡片、检查点页面布局、分集状态列表和导出操作。
6. Refactor：补齐空状态、错误态、加载态、移动端可读性和 i18n 文案。

## 完成标准

2. 页面链路覆盖上传视频、填写转绘目标、启动流程、阶段总览、三个人工检查点、目标剧本编辑与导出。
