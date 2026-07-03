# 编剧工作台流程页面前端实现计划

- Status: Completed
- Last sync with code: 6ca0aa67ffff2c9e2dfbb2885265dd7431a7c0e6
- Date: 2026/7/2

## Changed Items
1. 补充编剧工作台前端互动链路计划：明确任务对象、查询/创建接口边界、按钮跳转、检查点确认推进、非检查点阶段 10s 自动推进，以及当前实现缺口。

## 目标

参考 `plan-file-generator/frontend_plan.md` 的前端规划结构，在现有 `/screenwriter` 编剧工作台主界面基础上，实现“编剧工作台”的流程页面。用户可以从编剧工作台创建或继续一个剧本任务，查看左侧剧本队列与任务状态，进入 `视频 -> 源剧本 -> 目标剧本` 的阶段化流程，在关键检查点审查源设定与目标设定，按集查看逐集对齐和逐集转绘进度，最终形成可继续进入后续剧本/分镜生产链路的前端页面闭环。

Version 1 先使用前端 mock 数据完成完整交互，不依赖真实 AI、上传、任务编排或后端接口。字段命名和 hook 边界需要贴近未来接口，方便后续替换为真实 API。

## 相关细节

### 1. 确立目标

1. 入口目标：保留现有 `/screenwriter` 无剧本时的入口卡片页，同时新增“已有工作进行中”的运行态页面。
2. 流程目标：围绕 `docs/工作计划.md` 的链路 `视频 -> 源剧本 -> 目标剧本`，在前端表现为 6 个步骤：自动拆集、事实卡提取、设定提炼、逐集对齐、目标设定、逐集转绘。
3. 检查点目标：源设定和目标设定必须提供人工审查页面，支持查看总纲、查看索引/映射、查看复核问题、填写反馈、重新生成、确认继续。
4. 批处理目标：逐集对齐和逐集转绘必须提供按集状态网格，支持处理中、完成、失败、重试、完成计数。
5. 架构目标：不得新增与现有 FrameOS 工作台冲突的独立产品入口；优先扩展当前 `screenwriter` 路由和 `src/components/frameos/*` 视觉体系。

### 2. 核心用户流程

```text
进入编剧工作台
  -> 查看顶部转绘模式与左侧我的剧本
  -> 新建视频转绘 2.0 任务或选择进行中的剧本
  -> 上传视频并填写转绘需求
  -> 自动拆集
  -> 事实卡提取
  -> 源设定检查点
  -> 逐集对齐
  -> 目标设定检查点
  -> 逐集转绘
  -> 查看目标剧本并回到编剧工作台
```

简化流程图：

```text
[Screenwriter Workbench]
    |
    | create/select script
    v
[Video Repaint Task]
    |
    v
[Auto Split] -> [Fact Extract] -> [Source Settings Checkpoint]
                                      |
                                      v
                             [Episode Alignment Grid]
                                      |
                                      v
                           [Target Settings Checkpoint]
                                      |
                                      v
                              [Episode Repaint Grid]
                                      |
                                      v
                              [Target Script Review]
```

### 3. 页面信息拆解

#### ScreenwriterWorkbench

编剧工作台页面是用户进入编剧能力后的主工作面。当前仓库已有“无任何剧本时”的入口卡片页，需要扩展为支持有任务数据时的运行态。

页面区域：

1. Header
   - 页面标题：编剧工作台。
   - 顶栏能力：沿用 `FosShell` 的下载入口、余额入口、用户入口。
   - 当前模式：根据顶部模式卡片选择视频转绘 2.0、剧本转绘 2.0、分镜转绘 2.0、单集转绘测试或小说转剧本。

2. Mode Cards
   - 视频转绘 2.0：整剧视频转为目标版本剧本/分镜，保持全剧角色和场景映射一致。
   - 剧本转绘 2.0：整剧剧本转为目标版本。
   - 分镜转绘 2.0：整剧分镜转为目标版本。
   - 单集转绘测试：单集测试入口。
   - 小说转剧本：小说按照剧本改写。

3. Script Sidebar
   - 标签：草稿、可用、已归档。
   - 剧本条目：剧本名称、集数、任务类型、任务状态。
   - 空状态：没有剧本时仍展示现有入口卡片，不显示空侧栏。

4. Main Canvas
   - 未选择剧本：显示“请从左侧选择一份剧本开始编辑”。
   - 选择进行中剧本：进入当前任务阶段。
   - 选择已完成剧本：进入目标剧本或后续分镜/生产入口。

#### VideoRepaintCreateForm

新建任务页面是现有 `/screenwriter/video-repaint` 的升级版，保留现有字段并作为流程入口。

页面区域：

1. Task Header
   - 任务名称。
   - 视频转译形式：剧本或分镜。

2. Upload Area
   - 上传视频文件 / 上传文件夹。
   - 视频拖拽区。
   - 上传限制与授权提示。

3. Requirement Form
   - 转绘需求。
   - 检查点配置。
   - 后计费提示。

4. Actions
   - 返回编剧工作台。
   - 开始运行。
   - 表单校验错误。

#### VideoRepaintFlowShell

流程页面是所有任务阶段的统一壳。

页面区域：

1. Stage Sidebar
   - 返回编剧工作台。
   - 自动拆集、事实卡提取、设定提炼、逐集对齐、目标设定、逐集转绘。
   - 支持完成、运行中、待检查、未解锁、失败状态。

2. Stage Header
   - 任务类型：剧本转绘 2.0。
   - 剧本名称。
   - 当前检查点：检查点 A / 检查点 B。
   - 查看转绘需求。

3. Stage Body
   - 根据当前阶段渲染源设定检查点、逐集对齐、目标设定检查点、逐集转绘或目标剧本。

#### SettingsReviewPage

检查点页面用于源设定和目标设定两类人工审查。

页面区域：

1. Content Panel
   - 源设定总纲或目标设定总纲。
   - 长文本可滚动。

2. Collapsible Panel
   - 源设定：统一名索引，按人物、地点、关键道具展示别名归一关系。
   - 目标设定：角色 / 场景 / 关键道具映射，展示源名到目标名与说明。

3. Issue Panel
   - 源设定：建议复核点。
   - 目标设定：待确认问题。
   - 每条问题包含集号或主题、问题类型、当前处理、判断依据、风险、需重点确认。

4. Feedback Panel
   - 修改反馈输入。
   - 重新提炼或重新生成。
   - 确认继续。

#### EpisodeProgressGrid

逐集处理页面用于展示逐集对齐和逐集转绘。

页面区域：

1. Summary
   - 阶段标题。
   - 完成计数，例如 `0 / 30 集完成`。
   - 阶段说明。

2. Episode Cards
   - EP 编号。
   - 处理状态：待处理、整理中、处理中、完成、失败、重试中。
   - 失败原因和单集重试入口。

#### TargetScriptReview

目标剧本页面用于展示逐集转绘产物。

页面区域：

1. Episode List
   - 分集列表。
   - 每集字数、完成状态、更新时间。

2. Script Editor
   - 目标剧本文本。
   - 源剧本对照入口。
   - 保存编辑。

3. Actions
   - 重新生成单集。
   - 回到编剧工作台。
   - 进入后续分镜/生产链路。

### 4. 数据模型

Version 1 使用前端 mock 数据。字段命名先贴近未来接口，方便后续替换。

```ts
export type ScreenwriterScriptStatus = 'draft' | 'available' | 'archived'

export type VideoRepaintStageKey =
  | 'auto_split'
  | 'fact_extract'
  | 'source_settings'
  | 'episode_alignment'
  | 'target_settings'
  | 'episode_repaint'

export type VideoRepaintStageStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'waiting_check'
  | 'approved'
  | 'succeeded'
  | 'failed'
  | 'stale'

export type EpisodeProcessStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'retrying'

export interface ScreenwriterScriptSummary {
  id: string
  title: string
  episodeCount: number
  taskKind: 'video_repaint_2' | 'script_repaint_2' | 'storyboard_repaint_2'
  status: ScreenwriterScriptStatus
  activeTaskId?: string
  activeTaskLabel?: string
  activeTaskStatus?: VideoRepaintStageStatus
}

export interface VideoRepaintTaskView {
  id: string
  title: string
  requirement: string
  currentStage: VideoRepaintStageKey
  stages: VideoRepaintStageItem[]
  sourceSettings?: SettingsReviewView
  targetSettings?: SettingsReviewView
  alignmentEpisodes: EpisodeProcessItem[]
  repaintEpisodes: EpisodeProcessItem[]
}

export interface VideoRepaintStageItem {
  key: VideoRepaintStageKey
  title: string
  subtitle: string
  status: VideoRepaintStageStatus
  checkpoint?: 'A' | 'B'
}

export interface SettingsReviewView {
  title: string
  checkpoint: 'A' | 'B'
  body: string
  collapsedPanelTitle: string
  nameIndexGroups: NameIndexGroup[]
  issues: ReviewIssue[]
  feedback: string
}

export interface NameIndexGroup {
  title: string
  rows: Array<{
    sourceName: string
    targetName: string
    description?: string
  }>
}

export interface ReviewIssue {
  id: string
  label: string
  category: string
  currentHandling: string
  evidence: string
  risk: string
  confirmationPrompt: string
}

export interface EpisodeProcessItem {
  id: string
  episodeNumber: number
  status: EpisodeProcessStatus
  errorMessage?: string
}
```

### 5. 路由与模块拆分

保留现有入口：

```text
/[locale]/screenwriter
/[locale]/screenwriter/video-repaint
```

新增任务详情与阶段路由：

```text
/[locale]/screenwriter/video-repaint/[taskId]
/[locale]/screenwriter/video-repaint/[taskId]/source-settings
/[locale]/screenwriter/video-repaint/[taskId]/episode-alignment
/[locale]/screenwriter/video-repaint/[taskId]/target-settings
/[locale]/screenwriter/video-repaint/[taskId]/episode-repaint
/[locale]/screenwriter/video-repaint/[taskId]/target-script
```

建议新增前端模块：

```text
src/components/frameos/screenwriter/ScreenwriterWorkbench.tsx
src/components/frameos/screenwriter/ScreenwriterModeCards.tsx
src/components/frameos/screenwriter/ScreenwriterScriptSidebar.tsx
src/components/frameos/screenwriter/ScreenwriterEmptyCanvas.tsx
src/components/frameos/screenwriter/VideoRepaintCreateForm.tsx
src/components/frameos/screenwriter/VideoRepaintFlowShell.tsx
src/components/frameos/screenwriter/VideoRepaintStageNav.tsx
src/components/frameos/screenwriter/SettingsReviewPage.tsx
src/components/frameos/screenwriter/ReviewIssuePanel.tsx
src/components/frameos/screenwriter/NameIndexPanel.tsx
src/components/frameos/screenwriter/MappingPanel.tsx
src/components/frameos/screenwriter/EpisodeProgressGrid.tsx
src/components/frameos/screenwriter/TargetScriptReview.tsx
src/components/frameos/screenwriter/screenwriterDemoData.ts
src/components/frameos/screenwriter/types.ts
```

### 6. 低保真草图（根据 FOS_screenshot/ 里面的截图来）

编剧工作台运行态：


流程检查点页：


逐集处理页：


### 7. 截图对象对应关系

1. `FOS_screenshot/编剧工作台页面（如果已有工作进行中）.png`
   - 对应 `ScreenwriterWorkbench`、`ScreenwriterModeCards`、`ScreenwriterScriptSidebar`。

2. `FOS_screenshot/源设定检查点.png`
   - 对应 `SettingsReviewPage` 的源设定模式、`ReviewIssuePanel`、`NameIndexPanel` 折叠态。

3. `FOS_screenshot/源设定检查点（统一名索引）.png`
   - 对应 `NameIndexPanel` 展开态。

4. `FOS_screenshot/逐集对齐.png`
   - 对应 `EpisodeProgressGrid` 的 episode alignment 模式。

5. `FOS_screenshot/目标设定检查点.png`
   - 对应 `SettingsReviewPage` 的目标设定模式、`ReviewIssuePanel`、`MappingPanel` 折叠态。

6. `FOS_screenshot/目标设定检查点（道具映射）.png`
   - 对应 `MappingPanel` 展开态。

7. `FOS_screenshot/逐集转绘.png`
   - 对应 `EpisodeProgressGrid` 的 episode repaint 模式。

### 8. 技术栈

1. 页面框架：Next.js App Router、React 19、TypeScript。
2. 样式体系：Tailwind CSS 4、现有 `src/styles/frameos-*` token、`fos-*` class。
3. UI 基础：`FosShell`、`AppIcon`、现有 `src/components/ui/primitives/*`。
4. 数据层：Version 1 使用本地 demo 数据和 hook 适配层；后续接入 `apiFetch`、`/api/projects`、`/api/novel-promotion/*`、`/api/runs/*` 或新增 `/api/screenwriter/*`。
5. 测试：Vitest、Testing Library、`npm run typecheck`。

### 9. 接口依赖

第一阶段可使用本地 demo 数据；接后端时建议接口语义如下：

```text
GET    /api/screenwriter/scripts
POST   /api/screenwriter/video-repaint
GET    /api/screenwriter/video-repaint/:taskId
PATCH  /api/screenwriter/video-repaint/:taskId/requirement
POST   /api/screenwriter/video-repaint/:taskId/stages/:stage/retry
POST   /api/screenwriter/video-repaint/:taskId/source-settings/regenerate
POST   /api/screenwriter/video-repaint/:taskId/source-settings/approve
POST   /api/screenwriter/video-repaint/:taskId/target-settings/regenerate
POST   /api/screenwriter/video-repaint/:taskId/target-settings/approve
GET    /api/screenwriter/video-repaint/:taskId/target-script
PATCH  /api/screenwriter/video-repaint/:taskId/target-script/:episodeId
```

若后端决定复用现有 `/api/projects`、`/api/novel-promotion/*`、`/api/runs/*`，前端需在 `useScreenwriterScripts` / `useVideoRepaintTask` hook 内做适配，不要让页面组件直接感知多套接口来源。

### 10. Version 1 完成标准

1. 使用前端 demo 数据即可完整走通编剧工作台运行态、任务创建页、源设定检查点、逐集对齐、目标设定检查点、逐集转绘和目标剧本页。
2. 所有路由和组件命名贴近未来接口字段，后续替换真实 API 时不需要重写页面结构。
3. 页面视觉与 `FOS_screenshot` 的信息层级一致，允许内容为本地模拟数据，但按钮、状态、折叠区和反馈区必须可交互。

### 11. 实施步骤

1. Red：为编剧工作台运行态补组件测试，覆盖无剧本显示入口卡片、有草稿显示左侧剧本队列、点击剧本进入任务流程入口。
2. Green：抽出 `ScreenwriterWorkbench`、`ScreenwriterModeCards`、`ScreenwriterScriptSidebar`，用 demo 数据复刻“已有工作进行中”截图，同时保留现有无剧本空态。
3. Red：为任务流程壳补测试，覆盖 6 步阶段渲染、当前阶段高亮、完成/待检查/未解锁状态和返回编剧工作台。
4. Green：实现 `VideoRepaintFlowShell` 与 `VideoRepaintStageNav`，把现有 `/screenwriter/video-repaint` 表单改造成流程体系中的“新建任务”页。
5. Red：为源设定检查点补测试，覆盖设定总纲、统一名索引折叠、复核点列表、反馈输入、确认按钮和重新提炼禁用/启用状态。
6. Green：实现 `SettingsReviewPage`、`ReviewIssuePanel`、`NameIndexPanel`，完成 `/source-settings` 页面。
7. Red：为逐集对齐/逐集转绘补测试，覆盖 30 集网格、处理中、完成、失败、重试入口和完成计数。
8. Green：实现 `EpisodeProgressGrid`，完成 `/episode-alignment` 与 `/episode-repaint` 页面。
9. Red：为目标设定检查点补测试，覆盖目标设定总纲、角色/场景/关键道具映射折叠、待确认问题、重新生成和确认锁定。
10. Green：复用 `SettingsReviewPage` 并增加 `MappingPanel`，完成 `/target-settings` 页面。
11. Green：实现 `TargetScriptReview` 的基础页面，支持按集选择、剧本文本查看、保存按钮占位和回到编剧工作台。
12. Refactor：将 demo 数据替换入口集中到 hook 层，准备接入真实接口；统一 loading、empty、error、running、failed、stale 状态组件。
13. Refactor：补齐响应式布局，确保 1920 宽截图布局完整，小屏下顶部模式卡、左侧剧本队列和任务进度栏可滚动访问且不遮挡主内容。

### 12. TDD 与验证策略

1. 涉及组件行为时先写 Vitest/Testing Library 测试，再改生产组件。
2. 当前不需要第三方服务 mock；第一阶段使用本地 demo 数据，不触发真实 AI、上传或任务接口。
3. 每个页面对象至少覆盖：空态、运行态、检查态、失败态之一；流程壳和集网格覆盖状态组合。
4. 文档计划完成后无需运行前端测试；开始实现代码后按改动范围运行 `npm run typecheck` 和相关组件测试。

### 13. 前端互动链路补充计划

当前实现已经具备展示型 mock 页面和基础路由，但互动链路还没有跑通。后续需要把“后端接口驱动状态”的真实语义抽象到前端 hook 和状态机里，即使 Version 1 仍使用 mock，也要按真实接口形状实现创建、查询、跳转和阶段推进。

#### 13.1 现有前端对象分析

1. 编剧工作台任务对象
   - 页面：`/screenwriter`。
   - 当前组件：`ScreenwriterWorkbench`、`ScreenwriterScriptSidebar`、`ScreenwriterModeCards`。
   - 真实语义：进入页面时调用后端接口查询当前用户/项目中进行的编剧任务，渲染草稿、可用、归档。
   - 当前缺口：`ScreenwriterWorkbench` 只读取 `screenwriterDemoScripts`，点击“进行中”任务只设置选中态，不会跳转到对应阶段页面。

2. 视频转绘创建对象
   - 页面：`/screenwriter/video-repaint`。
   - 当前组件：`VideoRepaintCreateForm`。
   - 真实语义：填写任务名称、视频转译形式、参考视频、转绘需求、检查点配置；前端先校验必填项，再调用后端接口提交任务。
   - 创建成功后：后端返回 `taskId`；前端跳转到任务详情页，回到 `/screenwriter` 时也能从查询接口看到新增任务。
   - 当前缺口：开始运行按钮直接跳 demo task，没有表单校验、没有提交接口、没有创建后刷新任务列表。

3. 视频转绘流程对象
   - 页面：`/screenwriter/video-repaint/[taskId]/*`。
   - 当前组件：`FosVideoRepaintFlowClient`、`VideoRepaintFlowShell`、`VideoRepaintStageNav`、`SettingsReviewPage`、`EpisodeProgressGrid`、`TargetScriptReview`。
   - 真实语义：进入任一阶段页时通过 `taskId` 查询任务详情、当前阶段、阶段状态、检查点状态和产物数据。
   - 当前缺口：流程页读取固定 `videoRepaintDemoTask`，阶段按钮不负责跳转，检查点确认按钮没有回调，非检查点阶段不会模拟后端完成后自动进入下一阶段。

#### 13.2 建议前端状态对象

```ts
export interface ScreenwriterTaskSummary {
  id: string
  title: string
  episodeCount: number
  taskType: 'video_repaint_2' | 'script_repaint_2' | 'storyboard_repaint_2'
  bucket: 'draft' | 'available' | 'archived'
  currentStage: VideoRepaintStageKey | 'target_script'
  currentStageStatus: VideoRepaintStageStatus
  nextRoute: string
  updatedAt: string
}

export interface VideoRepaintCreateDraft {
  title: string
  mode: 'script' | 'board'
  uploadMode: 'file' | 'folder'
  sourceVideos: Array<{
    id: string
    name: string
    uploadStatus: 'local' | 'uploading' | 'uploaded' | 'failed'
    url?: string
  }>
  requirement: string
  checkpoints: {
    sourceSettings: boolean
    targetSettings: boolean
  }
}

export interface VideoRepaintTaskDetail extends VideoRepaintTaskView {
  routeByStage: Record<VideoRepaintStageKey | 'target_script', string>
  canConfirmCurrentStage: boolean
  canRetryCurrentStage: boolean
}
```

#### 13.3 Hook 与数据来源

1. `useScreenwriterTasks`
   - Version 1：从 local mock store 读取任务列表。
   - 后续真实接口：`GET /api/screenwriter/scripts`。
   - 返回：`tasks`、`isLoading`、`error`、`reload`。
   - 用途：`/screenwriter` 首屏渲染；创建任务成功后 reload。

2. `useCreateVideoRepaintTask`
   - Version 1：本地校验后把任务写入 mock store，并返回 mock `taskId`。
   - 后续真实接口：`POST /api/screenwriter/video-repaint`。
   - 校验规则：任务名称非空、转绘需求非空、至少 1 个视频且上传状态为 `uploaded`；检查点配置存在默认值。
   - 成功跳转：`/screenwriter/video-repaint/${taskId}` 或后端返回的 `nextRoute`。

3. `useVideoRepaintTask`
   - Version 1：按 `taskId` 从 mock store 查询详情。
   - 后续真实接口：`GET /api/screenwriter/video-repaint/:taskId`。
   - 返回：任务详情、当前阶段、阶段产物、可跳转 route。

4. `useStageAdvance`
   - 负责检查点确认、阶段重试、非检查点自动推进。
   - 后续接口：
     - `POST /api/screenwriter/video-repaint/:taskId/source-settings/approve`
     - `POST /api/screenwriter/video-repaint/:taskId/target-settings/approve`
     - `POST /api/screenwriter/video-repaint/:taskId/stages/:stage/retry`

#### 13.4 页面跳转逻辑

1. `/screenwriter`
   - 加载 `useScreenwriterTasks`。
   - 点击顶部“视频转绘”模式：跳 `/screenwriter/video-repaint`。
   - 点击左侧“进行中”任务：跳到任务的 `nextRoute`。
     - 例如当前阶段为 `source_settings`：跳 `/screenwriter/video-repaint/:taskId/source-settings`。
     - 当前阶段为 `episode_alignment`：跳 `/screenwriter/video-repaint/:taskId/episode-alignment`。
     - 当前阶段为 `target_script`：跳 `/screenwriter/video-repaint/:taskId/target-script`。

2. `/screenwriter/video-repaint`
   - 表单输入变化写入本地 draft state。
   - 点击“开始运行”：
     1. 前端校验。
     2. 校验失败显示字段错误，不跳转。
     3. 校验成功调用创建接口。
     4. 创建成功后跳转后端返回的 `nextRoute`。
   - 回到 `/screenwriter` 后，任务列表查询应包含新任务。

3. 检查点页面
   - `source-settings` 点击“确认设定总纲，继续”：
     1. 调用 approve 接口或 mock advance。
     2. 将 `source_settings` 标记为 `approved`。
     3. 将 `episode_alignment` 标记为 `running`。
     4. 跳转 `/screenwriter/video-repaint/:taskId/episode-alignment`。
   - `target-settings` 点击“确认锁定，开始转绘”：
     1. 调用 approve 接口或 mock advance。
     2. 将 `target_settings` 标记为 `approved`。
     3. 将 `episode_repaint` 标记为 `running`。
     4. 跳转 `/screenwriter/video-repaint/:taskId/episode-repaint`。

4. 非检查点页面自动推进
   - `episode-alignment` 页面：
     - 初次查询状态为 `running` 时，前端展示处理中网格。
     - Version 1 用 `setTimeout(10_000)` 模拟后端完成并推送。
     - 10s 后把 `episode_alignment` 标记为 `succeeded`，把 `target_settings` 标记为 `waiting_check`，自动跳转 `/target-settings`。
   - `episode-repaint` 页面：
     - 初次查询状态为 `running` 时展示处理中网格。
     - 10s 后把 `episode_repaint` 标记为 `succeeded`，自动跳转 `/target-script`。
   - 如果阶段状态为 `failed`，不得自动跳转，显示失败与重试入口。
   - 如果组件卸载，必须清理 timer，避免重复跳转。

5. StageNav 阶段按钮
   - 已完成或当前阶段可点击跳转。
   - 未解锁阶段禁用。
   - 失败阶段可点击进入失败页查看并重试。
   - 点击行为由 `routeByStage` 决定，不在组件内硬编码路径。

#### 13.5 交互链路实施顺序

1. Red：为 `useScreenwriterTasks` / `useCreateVideoRepaintTask` / `useStageAdvance` 写纯状态测试。
2. Green：实现 mock store 与 hooks，使 `/screenwriter` 从 hook 读取任务，不再直接读 `screenwriterDemoScripts`。
3. Green：让 `VideoRepaintCreateForm` 支持受控 draft、字段错误和提交成功跳转。
4. Green：让 `ScreenwriterScriptSidebar` 点击任务时跳 `task.nextRoute`，而不是只设置选中态。
5. Green：为 `SettingsReviewPage` 增加 `onConfirm` / `onRegenerate` props，确认按钮推进并跳转下一阶段。
6. Green：为 `EpisodeProgressGrid` 所在页面增加 10s 自动推进逻辑；失败状态不推进。
7. Refactor：把 route 构造集中到 `screenwriterRoutes.ts`，避免页面组件手写路径。
8. Refactor：把 mock store 边界设计成未来可替换真实接口的 adapter。

#### 13.6 验证标准

1. 进入 `/screenwriter` 能通过 hook 渲染任务列表。
2. 新建任务页缺少名称、视频或转绘需求时不允许提交，并显示错误。
3. 提交成功后跳转到新任务当前阶段；返回 `/screenwriter` 能看到新任务。
4. 点击“进行中”任务能进入对应阶段页面。
5. `source-settings` 确认后进入 `episode-alignment`。
6. `episode-alignment` 在 running 状态 10s 后自动进入 `target-settings`。
7. `target-settings` 确认后进入 `episode-repaint`。
8. `episode-repaint` 在 running 状态 10s 后自动进入 `target-script`。
9. `failed` 阶段不自动跳转，显示重试入口。
10. 相关测试与 `npm run typecheck` 通过。

## 完成标准

1. `/screenwriter` 同时支持“无任何剧本”入口态和“已有工作进行中”运行态，左侧剧本队列、顶部模式卡片和右侧空白提示与截图语义一致。
2. `/screenwriter/video-repaint` 保留新建任务能力，并能进入带 6 步任务进度栏的流程页面。
3. 源设定检查点页面可展示设定总纲、统一名索引、建议复核点、修改反馈、重新提炼和确认继续。
4. 逐集对齐页面可展示全部集数的并行整理状态、完成计数、失败提示和单集重试入口。
5. 目标设定检查点页面可展示目标设定总纲、角色/场景/关键道具映射、待确认问题、修改反馈、重新生成和确认锁定。
6. 逐集转绘页面可展示全部集数的处理状态、完成计数、失败提示和进入目标剧本结果页的入口。
7. 所有新页面沿用 FrameOS 深色工作台视觉与现有 `FosShell`、`AppIcon`、`fos-*` token，不引入新的全局视觉体系。
8. 组件测试覆盖关键状态渲染与主要点击路径；实现阶段通过 `npm run typecheck`。
9. 前端互动链路可在 mock 模式下跑通：创建任务、回到列表可见、点击任务进入当前阶段、检查点确认跳下一阶段、非检查点 running 状态 10s 后自动推进。
