# 个人版 AI 视频工作流实现文档

本文把 FrameOS 的工作模式抽象成一个适合 NoriVideo 当前仓库落地的“个人使用版”工作流。本文档用于交给另一个 Agent 直接拆任务实现。

## 0. FrameOS 页面观察记录

基于 `https://www.frameos.cn/#/login?redirect=/projects` 当前线上包观察到的结构如下。实现时只复用信息架构、流程语义和交互模式，不复制对方代码、素材、品牌资源。

2026-06-13 追加观察：

```text
子账号登录会触发阿里云安全验证：
  请完成安全验证
  确认您不是机器人

自动化环境未绕过验证码；后续若要观察登录态真实数据，需要人工完成验证或提供已登录态。
当前继续基于公开首屏、入口 HTML、静态路由和 lazy chunk 文案做信息架构复刻。
```

### 0.1 登录与主导航

登录页包含两种登录方式：

```text
手机号登录
子账号登录
```

子账号登录的输入提示是“用户名@企业代号”和密码。登录后的主应用采用深色后台工作台布局：

```text
左侧主导航
  项目
  编剧工作台
  工具箱
  Seedance 2.0
  资产库
  素材库
  提示词库
  团队管理

底部快捷入口
  服务记录
  问题反馈
  检查更新 / 立即更新
  用户卡片
```

个人版 NoriVideo 不实现团队管理、子账号权限和充值计费，但视觉与信息结构可以参考“左侧主导航 + 顶部项目上下文 + 主内容工作台”的模式。

### 0.2 路由与页面层级

FrameOS 的核心路由形态：

```text
/projects                         项目列表
/toolbox                          工具箱
/material                         素材库
/prompts                          提示词库
/team                             团队管理
/writer-workbench                 编剧工作台
/writer-workbench/redraw-v2/:scriptId

/workflow/:projectId              项目工作流
/workflow/:projectId/script       剧本拆解
/workflow/:projectId/characters   资产设定
/workflow/:projectId/storyboard   分镜制作

/workflow/:projectId/workbench
/workflow/:projectId/workbench/script-review
/workflow/:projectId/workbench/assets/characters
/workflow/:projectId/workbench/assets/items
/workflow/:projectId/workbench/assets/environments
/workflow/:projectId/workbench/assets/timbre
/workflow/:projectId/workbench/storyboard
/workflow/:projectId/workbench/production/episodes
/workflow/:projectId/workbench/production/timeline
/workflow/:projectId/workbench/production/shot
/workflow/:projectId/workbench/production/shot/:shotId
/workflow/:projectId/workbench/production/export

/workflow/:projectId/workbench-premium2
/workflow/:projectId/workbench-premium2/script-review
/workflow/:projectId/workbench-premium2/assets/characters
/workflow/:projectId/workbench-premium2/assets/items
/workflow/:projectId/workbench-premium2/assets/environments
/workflow/:projectId/workbench-premium2/assets/timbre
/workflow/:projectId/workbench-premium2/storyboard
/workflow/:projectId/workbench-premium2/production/episodes
/workflow/:projectId/workbench-premium2/production/timeline
/workflow/:projectId/workbench-premium2/production/shot
/workflow/:projectId/workbench-premium2/production/shot/:shotId
/workflow/:projectId/workbench-premium2/production/export
```

对应到 NoriVideo 的当前实现，项目列表内部仍复用 `/workspace`，项目工作台内部仍复用 `/workspace/[projectId]`；同时新增 `/projects` 和 `/workflow` 兼容别名来对齐 FrameOS 路由语义：

```text
config      -> 剧本解析
script      -> 资产设定
storyboard  -> 分镜设计
videos      -> 镜头制作
editor      -> 导出交付
```

### 0.3 工作台阶段

FrameOS 不是把 Agent 模式作为显式产品入口，而是把智能执行能力藏在阶段按钮和工作台任务里。NoriVideo 也按这个方向处理：

```text
创建项目时只暴露统一的项目创建/素材输入入口。
Agent 自动规划、拆解、生成作为后台执行能力，不在首页或创建弹窗中提供“Agent 模式”切换。
工作区内通过阶段运行、进度、确认、重试来承载 Agent 能力。
```

阶段命名采用 FrameOS 工作台语言：

```text
剧本解析
  输入素材、解析分集、生成改编结果。

资产设定
  角色、物品、环境、音色。

分镜设计
  分镜结构、提示词、镜头画面。

镜头制作
  单镜头/批量视频生成。

导出交付
  时间线、导出、素材交付。
```

范围约束：

- 只考虑个人使用，不实现团队、子账号、角色权限、协作者。
- 暂不实现计费、余额、金币、积分、成员额度。
- 只要求当前登录用户能创建、查看、编辑、运行自己的项目。
- 长任务必须异步执行，可刷新恢复。
- 优先复用当前 NoriVideo 已有能力，不重写整套系统。

## 1. 目标形态

个人用户进入工作区后，可以完成一条完整 AI 视频生产流水线：

```text
创建项目
  -> 导入/粘贴剧本
  -> AI 拆解剧本
  -> 确认剧本结构
  -> AI 抽取资产
  -> 确认角色/场景/道具/音色
  -> AI 生成分镜
  -> 确认分镜
  -> 批量生成镜头视频
  -> 组装或导出结果
```

核心不是单个生成按钮，而是“阶段化、可确认、可重试、可恢复”的个人工作流。

## 2. 当前仓库可复用能力

当前项目已经具备这些基础：

```text
src/app/[locale]/workspace                 项目列表与工作区页面
src/app/api/projects                       项目 API
src/app/api/novel-promotion                小说推文/短剧生产 API
src/app/api/tasks                          异步任务 API
src/app/api/runs                           GraphRun API
src/lib/workers                            BullMQ worker
src/lib/task                               Task 提交、状态、事件
src/lib/run-runtime                        GraphRun 运行时
src/lib/model-gateway                      模型调用路由
src/lib/media                              媒体对象与 URL 归一化
src/lib/storage                            对象存储抽象
prisma/schema.prisma                       数据模型
```

已有核心数据：

```text
Project
NovelPromotionProject
NovelPromotionEpisode
NovelPromotionClip
NovelPromotionStoryboard
NovelPromotionPanel
NovelPromotionCharacter
NovelPromotionLocation
NovelPromotionVoiceLine
Task
TaskEvent
GraphRun
GraphStep
GraphEvent
GraphArtifact
MediaObject
```

实现策略：新增一个轻量 workflow 编排层，把现有 `novel-promotion` 能力组织成清晰阶段。

## 3. 功能模块拆分

### 3.1 项目管理

用户能力：

```text
查看自己的项目
创建项目
重命名项目
删除项目
进入项目工作流
查看项目当前阶段和运行状态
```

建议路径：

```text
src/app/[locale]/workspace/page.tsx
src/app/[locale]/workflow/page.tsx                     # 可选，跳转到项目列表
src/app/[locale]/workflow/[projectId]/page.tsx
src/app/api/projects/route.ts
src/app/api/projects/[projectId]/route.ts
src/lib/projects/*
```

如果不想新增 `/workflow` 路由，也可以挂到现有：

```text
src/app/[locale]/workspace/[projectId]/page.tsx
```

但推荐新增 `/workflow/[projectId]`，这样不会和现有 workspace 逻辑强耦合。

### 3.2 工作流 Shell

用户能力：

```text
看到项目标题、配置、当前阶段
看到阶段导航
进入已解锁阶段
运行中的阶段显示遮罩
刷新后恢复运行态
失败后看到错误和重试按钮
阶段完成后可以确认
确认后解锁下一阶段
```

推荐路径：

```text
src/app/[locale]/workflow/[projectId]/layout.tsx
src/app/[locale]/workflow/[projectId]/page.tsx
src/app/[locale]/workflow/[projectId]/script/page.tsx
src/app/[locale]/workflow/[projectId]/assets/page.tsx
src/app/[locale]/workflow/[projectId]/storyboard/page.tsx
src/app/[locale]/workflow/[projectId]/production/page.tsx

src/features/workflow/components/WorkflowShell.tsx
src/features/workflow/components/WorkflowStepper.tsx
src/features/workflow/components/StageStatusPanel.tsx
src/features/workflow/components/StageRunOverlay.tsx
src/features/workflow/components/StageActionBar.tsx
src/features/workflow/components/StageErrorPanel.tsx
src/features/workflow/hooks/useWorkflowProject.ts
src/features/workflow/hooks/useWorkflowStages.ts
src/features/workflow/hooks/useRunEvents.ts
src/features/workflow/types.ts
```

### 3.3 Script 阶段

用户能力：

```text
上传 txt/docx/pdf 或粘贴文本
启动 AI 剧本拆解
查看分集、场次、镜头摘要
编辑基础文本或摘要
确认剧本阶段
失败重试
带反馈重新拆解
```

推荐路径：

```text
src/app/[locale]/workflow/[projectId]/script/page.tsx
src/features/workflow/script/ScriptStage.tsx
src/features/workflow/script/ScriptSourceInput.tsx
src/features/workflow/script/ScriptEpisodeList.tsx
src/features/workflow/script/ScriptReviewPanel.tsx
src/features/workflow/script/ScriptFeedbackDialog.tsx

src/app/api/workflow/projects/[projectId]/script/source/route.ts
src/app/api/workflow/projects/[projectId]/script/run/route.ts
src/app/api/workflow/projects/[projectId]/script/approve/route.ts
src/app/api/workflow/projects/[projectId]/script/unapprove/route.ts

src/lib/workflow/stages/script.ts
src/lib/workflow/services/script-source.ts
src/lib/workers/handlers/workflow-script.ts
```

可复用现有能力：

```text
src/app/api/novel-promotion/[projectId]/episodes/*
src/lib/workers/handlers/analyze-novel.ts
src/lib/workers/handlers/clips-build.ts
src/lib/workers/handlers/episode-split.ts
src/lib/workers/handlers/story-to-script.ts
src/lib/workers/handlers/script-to-storyboard.ts
```

### 3.4 Assets 阶段

用户能力：

```text
从剧本中抽取角色、场景、道具、音色
查看资产列表
为角色/场景/道具生成候选图
选择主图或上传替换图
编辑资产描述
确认资产
撤销确认
确认全部核心资产后解锁分镜阶段
```

推荐路径：

```text
src/app/[locale]/workflow/[projectId]/assets/page.tsx
src/features/workflow/assets/AssetsStage.tsx
src/features/workflow/assets/AssetTabs.tsx
src/features/workflow/assets/AssetCard.tsx
src/features/workflow/assets/AssetDetailPanel.tsx
src/features/workflow/assets/AssetVariantGrid.tsx
src/features/workflow/assets/AssetGenerateButton.tsx

src/app/api/workflow/projects/[projectId]/assets/run/route.ts
src/app/api/workflow/projects/[projectId]/assets/approve/route.ts
src/app/api/workflow/projects/[projectId]/assets/unapprove/route.ts
src/app/api/workflow/projects/[projectId]/assets/[assetId]/route.ts
src/app/api/workflow/projects/[projectId]/assets/[assetId]/generate/route.ts
src/app/api/workflow/projects/[projectId]/assets/[assetId]/select/route.ts

src/lib/workflow/stages/assets.ts
src/lib/workflow/services/workflow-assets.ts
src/lib/workers/handlers/workflow-assets.ts
```

可复用现有能力：

```text
src/app/api/asset-hub/*
src/app/api/novel-promotion/[projectId]/generate-character-image
src/app/api/novel-promotion/[projectId]/location
src/app/api/novel-promotion/[projectId]/character
src/lib/workers/handlers/character-image-task-handler.ts
src/lib/workers/handlers/location-image-task-handler.ts
src/lib/workers/handlers/asset-hub-ai-design.ts
src/lib/workers/handlers/voice-design.ts
```

### 3.5 Storyboard 阶段

用户能力：

```text
选择目标分集
基于剧本和确认资产生成分镜
查看分镜组和分镜面板
查看/编辑图片提示词、视频提示词
生成或重生成分镜图
选择候选图
确认分镜阶段
带反馈按集/场/镜头重生成
```

推荐路径：

```text
src/app/[locale]/workflow/[projectId]/storyboard/page.tsx
src/features/workflow/storyboard/StoryboardStage.tsx
src/features/workflow/storyboard/EpisodeSelector.tsx
src/features/workflow/storyboard/StoryboardGroupList.tsx
src/features/workflow/storyboard/StoryboardPanelCard.tsx
src/features/workflow/storyboard/PanelPromptEditor.tsx
src/features/workflow/storyboard/PanelImageActions.tsx
src/features/workflow/storyboard/StoryboardFeedbackDialog.tsx

src/app/api/workflow/projects/[projectId]/storyboard/run/route.ts
src/app/api/workflow/projects/[projectId]/storyboard/approve/route.ts
src/app/api/workflow/projects/[projectId]/storyboard/unapprove/route.ts
src/app/api/workflow/projects/[projectId]/storyboard/panels/[panelId]/route.ts
src/app/api/workflow/projects/[projectId]/storyboard/panels/[panelId]/generate-image/route.ts
src/app/api/workflow/projects/[projectId]/storyboard/panels/[panelId]/select-candidate/route.ts

src/lib/workflow/stages/storyboard.ts
src/lib/workflow/services/workflow-storyboard.ts
src/lib/workers/handlers/workflow-storyboard.ts
```

可复用现有能力：

```text
src/app/api/novel-promotion/[projectId]/storyboards
src/app/api/novel-promotion/[projectId]/script-to-storyboard-stream
src/app/api/novel-promotion/[projectId]/generate-image
src/app/api/novel-promotion/[projectId]/regenerate-panel-image
src/app/api/novel-promotion/[projectId]/panel
src/lib/workers/handlers/script-to-storyboard.ts
src/lib/workers/handlers/panel-image-task-handler.ts
```

### 3.6 Production 阶段

用户能力：

```text
查看所有可生成视频的分镜面板
按单个镜头生成视频
按分集批量生成视频
失败镜头单独重试
查看视频生成状态
保存生成结果
下载单个视频或整集素材
可选：调用现有视频编辑器/Remotion 组装
```

推荐路径：

```text
src/app/[locale]/workflow/[projectId]/production/page.tsx
src/features/workflow/production/ProductionStage.tsx
src/features/workflow/production/ProductionEpisodeTabs.tsx
src/features/workflow/production/ShotVideoGrid.tsx
src/features/workflow/production/ShotVideoCard.tsx
src/features/workflow/production/BatchGenerateDialog.tsx
src/features/workflow/production/ProductionDownloadPanel.tsx

src/app/api/workflow/projects/[projectId]/production/run/route.ts
src/app/api/workflow/projects/[projectId]/production/panels/[panelId]/generate-video/route.ts
src/app/api/workflow/projects/[projectId]/production/panels/[panelId]/retry/route.ts
src/app/api/workflow/projects/[projectId]/production/download/route.ts
src/app/api/workflow/projects/[projectId]/production/approve/route.ts

src/lib/workflow/stages/production.ts
src/lib/workflow/services/workflow-production.ts
src/lib/workers/handlers/workflow-production.ts
```

可复用现有能力：

```text
src/app/api/novel-promotion/[projectId]/generate-video
src/app/api/novel-promotion/[projectId]/download-videos
src/app/api/novel-promotion/[projectId]/editor
src/lib/workers/video.worker.ts
src/lib/workers/handlers/shot-ai-tasks.ts
src/features/video-editor/*
```

## 4. 工作流阶段定义

个人版只保留一种主流程：

```text
script -> assets -> storyboard -> production
```

未来可以再增加 quick mode，但第一版建议不要同时做两个模式，避免分支过多。

### 4.1 阶段含义

```text
script
  剧本导入、解析、分集/场次/镜头拆解。

assets
  角色、场景、道具、音色等一致性资产设定。

storyboard
  分镜设计、图片提示词、分镜图、视频提示词。

production
  镜头视频生成、批量生成、下载和可选组装。
```

### 4.2 阶段解锁规则

```text
script
  永远可进入。

assets
  script.status 必须是 approved。

storyboard
  assets.status 必须是 approved。

production
  storyboard.status 必须是 approved。
```

### 4.3 阶段只读规则

```text
当前阶段 running:
  页面可以查看已有数据，但编辑和确认按钮禁用。

当前阶段 approved:
  默认只读。用户需要先点击“撤销确认”才能继续编辑。

上游阶段 unapprove:
  下游阶段标记为 stale，提示“上游已变更，建议重新生成”。
```

## 5. 状态机

建议阶段状态：

```ts
export type WorkflowStageStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'failed'
  | 'pending_review'
  | 'approved'
  | 'canceled'
  | 'stale'
```

状态转换：

```text
idle -> queued
queued -> running
running -> pending_review
running -> failed
running -> canceled
failed -> queued
pending_review -> approved
pending_review -> queued       # 带反馈重生成
approved -> pending_review      # 撤销确认
approved -> stale               # 上游撤销确认或重生成
stale -> queued
stale -> approved               # 用户选择继续沿用旧结果
```

实现注意：

- `approved` 是用户确认状态，不等于任务完成。
- `pending_review` 是 AI 已产出，等待用户确认。
- `stale` 表示下游结果可能与上游最新数据不一致。
- 不要只靠前端推断阶段状态，后端必须保存状态。

## 6. 数据模型设计

第一版推荐新增最小表，不大改已有 `NovelPromotion*` 模型。

### 6.1 新增 WorkflowStageState

在 `prisma/schema.prisma` 中新增：

```prisma
model WorkflowStageState {
  id           String   @id @default(uuid())
  projectId    String
  userId       String
  stage        String
  status       String   @default("idle")
  lastRunId    String?
  lastTaskId   String?
  summary      Json?
  errorCode    String?
  errorMessage String?  @db.Text
  approvedAt   DateTime?
  approvedBy   String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([projectId, stage])
  @@index([userId])
  @@index([projectId])
  @@index([status])
  @@map("workflow_stage_states")
}
```

为什么新增表：

- 避免把阶段状态散落在 `NovelPromotionProject`、`Task`、`GraphRun` 和前端本地状态中。
- Shell 可以一次查询所有阶段状态。
- 刷新页面和 worker 恢复都能找到主状态。

### 6.2 可选 SourceMaterial

第一版可以先不新增表，把剧本内容存到现有 episode/project 字段。若要更清晰，新增：

```prisma
model WorkflowSourceMaterial {
  id            String   @id @default(uuid())
  projectId     String
  userId        String
  kind          String
  title         String
  textContent   String?  @db.LongText
  mediaObjectId String?
  parseStatus   String   @default("idle")
  metadata      Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([projectId])
  @@index([userId])
  @@map("workflow_source_materials")
}
```

建议第一版实现方式：

```text
先不新增 SourceMaterial。
script 页面提交文本或文件后，API 直接转成项目级输入并启动 script run。
后续需要多源素材管理时再补表。
```

### 6.3 不新增 Asset 表的第一版策略

第一版复用现有：

```text
NovelPromotionCharacter
NovelPromotionLocation
NovelPromotionPanel
CharacterAppearance
LocationImage
MediaObject
```

道具如果当前没有稳定表，可以先作为 JSON 存在项目数据或 panel references 中，后续再抽成表。

## 7. 后端服务路径

新增 workflow 服务目录：

```text
src/lib/workflow/
  types.ts
  errors.ts
  project-access.ts
  stage-state.ts
  stage-machine.ts
  stage-summary.ts
  run-stage.ts
  stages/
    script.ts
    assets.ts
    storyboard.ts
    production.ts
  services/
    script-input.ts
    asset-review.ts
    storyboard-review.ts
    production-review.ts
```

### 7.1 `types.ts`

定义：

```ts
export type WorkflowStage = 'script' | 'assets' | 'storyboard' | 'production'
export type WorkflowStageStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'failed'
  | 'pending_review'
  | 'approved'
  | 'canceled'
  | 'stale'

export type WorkflowStageView = {
  stage: WorkflowStage
  status: WorkflowStageStatus
  locked: boolean
  readonly: boolean
  stale: boolean
  lastRunId: string | null
  lastTaskId: string | null
  errorMessage: string | null
  summary: Record<string, unknown> | null
}
```

### 7.2 `project-access.ts`

只做个人项目校验：

```ts
export async function requireOwnedProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: { novelPromotionData: true },
  })
  if (!project) throw new WorkflowError('PROJECT_NOT_FOUND')
  return project
}
```

不要引入团队权限、角色权限、计费校验。

### 7.3 `stage-state.ts`

职责：

```text
ensureProjectStages(projectId, userId)
getProjectStages(projectId, userId)
getStage(projectId, stage)
markStageQueued
markStageRunning
markStagePendingReview
markStageApproved
markStageFailed
markStageCanceled
markDownstreamStale
```

### 7.4 `stage-machine.ts`

职责：

```text
判断阶段能否进入
判断阶段能否运行
判断阶段能否确认
判断阶段是否只读
根据上游状态计算 locked/stale
```

规则写死即可，不需要复杂 DSL。

### 7.5 `run-stage.ts`

统一创建任务：

```text
validate owner
validate stage preconditions
dedupe active run
mark stage queued
create Task or GraphRun
enqueue worker job
return lastRunId / taskId
```

第一版可以先走 `Task`，不强制所有阶段都用 `GraphRun`。如果已有 run-runtime 容易接入，则优先用 GraphRun。

## 8. API 路由设计

新增统一 workflow API：

```text
src/app/api/workflow/projects/[projectId]/route.ts
src/app/api/workflow/projects/[projectId]/stages/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/run/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/approve/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/unapprove/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/retry/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/cancel/route.ts
```

### 8.1 项目详情

`GET /api/workflow/projects/:projectId`

返回：

```json
{
  "project": {
    "id": "project-id",
    "name": "项目名",
    "description": "",
    "createdAt": "2026-06-13T00:00:00.000Z",
    "updatedAt": "2026-06-13T00:00:00.000Z"
  },
  "workflow": {
    "stages": [
      {
        "stage": "script",
        "status": "approved",
        "locked": false,
        "readonly": true,
        "stale": false,
        "lastRunId": "run-id",
        "lastTaskId": null,
        "errorMessage": null,
        "summary": { "episodeCount": 12 }
      }
    ],
    "activeStage": "assets"
  }
}
```

### 8.2 运行阶段

`POST /api/workflow/projects/:projectId/stages/:stage/run`

请求：

```json
{
  "input": {
    "text": "剧本文本，仅 script 阶段需要",
    "episodeId": "可选",
    "feedback": "可选反馈"
  },
  "options": {
    "force": false,
    "scope": "project"
  }
}
```

返回：

```json
{
  "stage": "script",
  "status": "queued",
  "taskId": "task-id",
  "runId": "run-id"
}
```

### 8.3 确认阶段

`POST /api/workflow/projects/:projectId/stages/:stage/approve`

逻辑：

```text
校验项目归属
校验 stage.status 是 pending_review 或 stale
校验阶段数据满足最低完整性
markStageApproved
解锁下一阶段
```

### 8.4 撤销确认

`POST /api/workflow/projects/:projectId/stages/:stage/unapprove`

逻辑：

```text
校验项目归属
approved -> pending_review
下游阶段全部 mark stale
```

### 8.5 取消运行

`POST /api/workflow/projects/:projectId/stages/:stage/cancel`

第一版可以只做软取消：

```text
stage -> canceled
Task/GraphRun 设置 cancel requested
worker 在安全点检查取消标记
```

## 9. Worker 设计

新增 handler：

```text
src/lib/workers/handlers/workflow-script.ts
src/lib/workers/handlers/workflow-assets.ts
src/lib/workers/handlers/workflow-storyboard.ts
src/lib/workers/handlers/workflow-production.ts
```

在现有 worker 分流里注册新 task type：

```text
workflow_script
workflow_assets
workflow_storyboard
workflow_production
```

建议任务类型归属：

```text
workflow_script       text worker
workflow_assets       text worker + image worker 子任务
workflow_storyboard   text worker + image worker 子任务
workflow_production   video worker
```

第一版可以先让一个 text worker handler 同步调用已有服务，后续再拆子任务。

### 9.1 Script Worker

输入：

```json
{
  "projectId": "project-id",
  "userId": "user-id",
  "text": "剧本文本",
  "feedback": ""
}
```

步骤：

```text
mark stage running
读取项目配置
调用已有剧本解析/拆集能力
写入 NovelPromotionEpisode / Clip / Shot
计算 summary: episodeCount, clipCount, shotCount
mark stage pending_review
写 TaskEvent
```

### 9.2 Assets Worker

步骤：

```text
mark stage running
读取 approved script 输出
抽取角色、场景、道具、音色
写 NovelPromotionCharacter / NovelPromotionLocation 等
可选生成首批候选图
计算 summary: characterTotal, locationTotal, propTotal
mark stage pending_review
```

### 9.3 Storyboard Worker

步骤：

```text
mark stage running
读取 approved script + approved assets
按分集或全项目生成 storyboards/panels
写 NovelPromotionStoryboard / NovelPromotionPanel
生成 imagePrompt / videoPrompt
可选生成分镜图
summary: storyboardCount, panelCount, imageReadyCount
mark stage pending_review
```

### 9.4 Production Worker

步骤：

```text
mark stage running
读取 approved storyboard panels
筛选没有 videoUrl 的 panel
逐个提交或执行视频生成
保存 videoMedia / videoUrl
summary: totalPanels, completedVideos, failedVideos
如果全部成功 mark pending_review
如果部分失败 mark failed，但保留成功结果
```

Production 第一版不强制成片组装，只要能批量生成和下载镜头视频即可。

## 10. 前端实现细节

### 10.1 WorkflowShell

文件：

```text
src/features/workflow/components/WorkflowShell.tsx
```

职责：

```text
请求 /api/workflow/projects/:projectId
渲染顶部项目栏
渲染 WorkflowStepper
根据当前路由渲染 children
如果当前阶段 running，显示 StageRunOverlay
如果阶段 failed，显示 StageErrorPanel
```

### 10.2 WorkflowStepper

文件：

```text
src/features/workflow/components/WorkflowStepper.tsx
```

阶段显示：

```text
剧本
资产
分镜
制作
```

状态映射：

```text
idle            灰色
queued/running 旋转或进度
pending_review 黄色待确认
approved       绿色完成
failed         红色失败
stale          橙色需更新
locked         锁图标
```

点击规则：

```text
locked 阶段不可进入，toast 提示前置阶段未确认。
非 locked 阶段可进入。
```

### 10.3 StageActionBar

文件：

```text
src/features/workflow/components/StageActionBar.tsx
```

按钮：

```text
开始生成 / 重新生成
确认本阶段
撤销确认
取消运行
查看运行详情
```

显示规则：

```text
idle/failed/stale:
  显示开始生成或重新生成

running/queued:
  显示取消运行

pending_review:
  显示确认本阶段、重新生成

approved:
  显示撤销确认
```

### 10.4 数据 hooks

```text
src/features/workflow/hooks/useWorkflowProject.ts
src/features/workflow/hooks/useWorkflowStageActions.ts
src/features/workflow/hooks/useRunEvents.ts
```

不强制引入新状态库；可使用现有 React Query 模式。如果当前项目已有 `src/lib/query`，按现有模式加入 query key。

## 11. 阶段页面实现规格

### 11.1 ScriptStage

文件：

```text
src/features/workflow/script/ScriptStage.tsx
```

组件结构：

```text
ScriptSourceInput
ScriptEpisodeList
ScriptReviewPanel
StageActionBar
```

第一版能力：

```text
textarea 粘贴剧本
点击“开始拆解”
显示生成后的 episodes
确认阶段
```

上传 docx/pdf 可以后置。

### 11.2 AssetsStage

文件：

```text
src/features/workflow/assets/AssetsStage.tsx
```

组件结构：

```text
AssetTabs
AssetList
AssetDetailPanel
StageActionBar
```

第一版能力：

```text
显示角色、场景
编辑名称/描述
确认单个资产
确认本阶段
```

道具和音色可以先作为第二轮。

### 11.3 StoryboardStage

文件：

```text
src/features/workflow/storyboard/StoryboardStage.tsx
```

组件结构：

```text
EpisodeSelector
StoryboardGroupList
PanelPromptEditor
StageActionBar
```

第一版能力：

```text
显示分镜组
显示 panel 的 imagePrompt / videoPrompt
生成或重生成 panel 图片
确认本阶段
```

### 11.4 ProductionStage

文件：

```text
src/features/workflow/production/ProductionStage.tsx
```

组件结构：

```text
ProductionEpisodeTabs
ShotVideoGrid
BatchGenerateDialog
ProductionDownloadPanel
StageActionBar
```

第一版能力：

```text
按 panel 生成视频
批量生成当前集视频
显示成功/失败/运行中
下载视频
```

## 12. 路径化任务清单

### Task 1：新增 Prisma 模型

改动：

```text
prisma/schema.prisma
prisma/schema.sqlit.prisma
```

新增：

```text
WorkflowStageState
```

执行：

```bash
npx prisma generate
```

验收：

```text
Prisma Client 可访问 workflowStageState。
```

### Task 2：新增 workflow lib

新增：

```text
src/lib/workflow/types.ts
src/lib/workflow/errors.ts
src/lib/workflow/project-access.ts
src/lib/workflow/stage-state.ts
src/lib/workflow/stage-machine.ts
src/lib/workflow/stage-summary.ts
src/lib/workflow/run-stage.ts
src/lib/workflow/stages/script.ts
src/lib/workflow/stages/assets.ts
src/lib/workflow/stages/storyboard.ts
src/lib/workflow/stages/production.ts
```

验收：

```text
ensureProjectStages 能为项目创建四个 stage。
getProjectStages 能返回 locked/readonly/stale。
approve/unapprove 能正确影响下游 stale。
```

### Task 3：新增 workflow API

新增：

```text
src/app/api/workflow/projects/[projectId]/route.ts
src/app/api/workflow/projects/[projectId]/stages/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/run/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/approve/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/unapprove/route.ts
src/app/api/workflow/projects/[projectId]/stages/[stage]/cancel/route.ts
```

验收：

```text
未登录返回 401。
访问别人的 project 返回 404 或 403。
GET project 返回项目和四个阶段。
POST run 能让阶段进入 queued。
POST approve 能让 pending_review 进入 approved。
```

### Task 4：接入 worker task type

改动：

```text
src/lib/task/types.ts
src/lib/task/queues.ts
src/lib/workers/text.worker.ts
src/lib/workers/video.worker.ts
```

新增：

```text
src/lib/workers/handlers/workflow-script.ts
src/lib/workers/handlers/workflow-assets.ts
src/lib/workers/handlers/workflow-storyboard.ts
src/lib/workers/handlers/workflow-production.ts
```

验收：

```text
提交 workflow_script 后，worker 能消费。
成功后 stage -> pending_review。
失败后 stage -> failed，并写 errorMessage。
```

### Task 5：新增 workflow 前端基础

新增：

```text
src/app/[locale]/workflow/[projectId]/layout.tsx
src/app/[locale]/workflow/[projectId]/page.tsx
src/app/[locale]/workflow/[projectId]/script/page.tsx
src/app/[locale]/workflow/[projectId]/assets/page.tsx
src/app/[locale]/workflow/[projectId]/storyboard/page.tsx
src/app/[locale]/workflow/[projectId]/production/page.tsx

src/features/workflow/types.ts
src/features/workflow/api.ts
src/features/workflow/hooks/useWorkflowProject.ts
src/features/workflow/hooks/useWorkflowStageActions.ts
src/features/workflow/components/WorkflowShell.tsx
src/features/workflow/components/WorkflowStepper.tsx
src/features/workflow/components/StageActionBar.tsx
src/features/workflow/components/StageRunOverlay.tsx
src/features/workflow/components/StageErrorPanel.tsx
```

验收：

```text
/zh/workflow/:projectId 可打开。
顶部能看到四阶段导航。
locked 阶段不可进入。
运行状态刷新后仍显示。
```

### Task 6：实现 Script 页面

新增：

```text
src/features/workflow/script/ScriptStage.tsx
src/features/workflow/script/ScriptSourceInput.tsx
src/features/workflow/script/ScriptEpisodeList.tsx
src/features/workflow/script/ScriptReviewPanel.tsx
```

验收：

```text
用户粘贴文本。
点击开始拆解。
阶段进入 running。
worker 完成后展示 episodes。
用户可确认 script。
assets 阶段解锁。
```

### Task 7：实现 Assets 页面

新增：

```text
src/features/workflow/assets/AssetsStage.tsx
src/features/workflow/assets/AssetTabs.tsx
src/features/workflow/assets/AssetCard.tsx
src/features/workflow/assets/AssetDetailPanel.tsx
```

验收：

```text
用户运行资产抽取。
展示角色/场景。
用户确认 assets。
storyboard 阶段解锁。
```

### Task 8：实现 Storyboard 页面

新增：

```text
src/features/workflow/storyboard/StoryboardStage.tsx
src/features/workflow/storyboard/EpisodeSelector.tsx
src/features/workflow/storyboard/StoryboardGroupList.tsx
src/features/workflow/storyboard/StoryboardPanelCard.tsx
```

验收：

```text
用户运行分镜生成。
展示 storyboard/panels。
用户确认 storyboard。
production 阶段解锁。
```

### Task 9：实现 Production 页面

新增：

```text
src/features/workflow/production/ProductionStage.tsx
src/features/workflow/production/ProductionEpisodeTabs.tsx
src/features/workflow/production/ShotVideoGrid.tsx
src/features/workflow/production/ShotVideoCard.tsx
```

验收：

```text
用户可生成单个 panel 视频。
用户可批量生成当前集视频。
成功后可播放和下载视频。
失败 panel 可重试。
```

## 13. 最小可用版本边界

第一版只做这些：

```text
四阶段状态机
项目归属校验
粘贴剧本
剧本拆解
资产抽取
分镜生成
单 panel 图片生成
单 panel 视频生成
阶段确认/撤销确认
任务刷新恢复
失败重试
```

第一版不做这些：

```text
团队/子账号/协作者
角色权限系统
计费/余额
金币/积分
复杂交付包
多人同时编辑
完整审计后台
客户端下载
阿里云验证码
```

## 14. 测试建议

新增测试目录：

```text
tests/unit/workflow/stage-machine.test.ts
tests/unit/workflow/stage-state.test.ts
tests/integration/api/specific/workflow-project-route.test.ts
tests/integration/api/specific/workflow-stage-run-route.test.ts
tests/unit/worker/workflow-script.test.ts
```

重点覆盖：

```text
初始项目创建四个阶段
script approved 后 assets 解锁
assets approved 后 storyboard 解锁
storyboard approved 后 production 解锁
unapprove script 后下游 stale
running 阶段不可重复 run
非项目 owner 不能访问
worker 成功更新 pending_review
worker 失败更新 failed
```

## 15. 实现顺序建议

推荐顺序：

```text
1. WorkflowStageState 数据模型
2. stage-state / stage-machine 服务
3. workflow API
4. WorkflowShell 前端
5. Script 阶段打通
6. Assets 阶段打通
7. Storyboard 阶段打通
8. Production 单 panel 视频生成
9. 批量生成与下载
```

不要一开始做复杂 UI。先让状态机和阶段运行闭环可靠，再做视觉优化。

## 16. 给实现 Agent 的关键原则

1. 不要引入团队和计费逻辑。
2. 所有 API 只校验当前用户是否拥有项目。
3. 不要在 API route 中长时间等待模型，长任务走 Task/Worker。
4. 阶段状态以后端 `WorkflowStageState` 为准。
5. 前端刷新后必须能从 API 恢复状态。
6. 已确认阶段默认只读，编辑前先撤销确认。
7. 撤销上游确认必须把下游标记为 `stale`。
8. 生成产物必须落库，不依赖前端内存。
9. 媒体 URL 必须走现有 media/storage 逻辑。
10. 优先复用现有 novel-promotion API 和 worker，避免平行造一套重复能力。

## 17. 当前仓库落地记录

本轮先不做登录复刻，登录、子账号、团队权限、计费相关入口全部不进入当前目标。已落地的方向如下：

```text
项目列表
  /workspace 保持现有项目数据和创建逻辑。
  视觉收敛为深色后台工作台：左侧主导航、顶部项目上下文、项目卡片区。
  创建项目仍只暴露项目名和描述，不提供 Agent 模式选择。

项目工作台
  /workspace/[projectId] 保持现有 novel-promotion 能力。
  大屏新增左侧项目工作流侧栏：项目、当前剧集、阶段状态、剧集列表、工作台分组。
  小屏保留原 CapsuleNav 和 EpisodeSelector。
  阶段文案改为：剧本解析、资产设定、分镜设计、镜头制作、导出交付。

智能导入
  首次进入项目时不再显示“Agent 自动创作模式”卡片。
  可见入口收敛为“从第一集开始创作”和“智能文本分集”。
  Agent/SuperInputBox 仅保留为内部恢复和后台能力，不作为创建项目的显式入口。
```

当前仍未完成的 FrameOS 对齐点：

```text
1. 导出交付已有独立阶段页、视频 ZIP、图片 ZIP、交付清单下载、后端派生历史 API、服务端持久化下载记录和后台导出队列；仍缺真正剪映工程草稿生成与 worker 执行。
2. 工作台分组子项目已具备 script-review、items、environments、timeline、shot/:id 等桥接视图；仍需继续细化成更接近 FrameOS 的独立生产子页面。
3. 阶段状态已新增后端派生状态 API 并接入工作台导航；人工确认/需复核状态已通过 workflow-stage-review API 持久化到服务端文件存储，仍未新增数据库版 WorkflowStageState 数据表。
4. 主导航里的工具箱、素材库、提示词库、Seedance 2.0 与底部入口已接入现有项目、任务、素材、提示词、视频增强和系统状态 API；服务记录已加入任务派生的用量/估算账单预览，并已接入真实余额、费用汇总、最近流水和内置价格目录 API；仍缺 FrameOS 级别的套餐配置和团队数据模型。
5. 当前页面视觉已接近后台工作台，但资产、分镜、镜头详情页还需要继续逐页细化。
```

2026-06-13 本轮追加落地：

```text
导出交付
  editor 阶段不再复用最终视频列表。
  新增独立 ExportDeliveryStage，呈现成片、资产包、剪辑草稿、交付检查、导出历史。
  交付检查基于当前剧集 panels/videoUrl 统计缺失镜头，并提供返回镜头制作入口。
  成片卡片已接入 /api/novel-promotion/:projectId/download-videos，可按当前剧集下载已生成视频 ZIP。
  资产包卡片已接入 /api/novel-promotion/:projectId/download-images，可按当前剧集下载分镜图片 ZIP。
  新增 /api/novel-promotion/:projectId/export-manifest，输出项目、剧集、场次、镜头、提示词和媒体 URL 的 JSON 交付清单。
  剪辑草稿卡片当前下载交付清单，作为可复核的轻量草稿交付。
  新增 /api/novel-promotion/:projectId/export-history，GET 合并当前剧集可交付派生记录和服务端持久化下载记录，POST 在每次成片、资产包或清单下载成功后写入记录类型、文件名、时间、状态和统计信息。
  导出历史已从 localStorage 升级为 .runtime/export-history 服务端文件持久化；前端下载成功后写入后端并重新读取历史列表。
  新增 /api/novel-promotion/:projectId/export-queue，支持将成片、资产包、剪辑草稿加入后台导出队列；队列记录按 userId/projectId/episodeId 写入 .runtime/export-queue，导出页会显示“未入队 / 后台队列中”等状态。
  真正剪映工程包和导出 worker 执行仍待后续任务化。
  导出交付页新增导出任务队列，按成片、资产包、剪辑草稿显示可执行/待补齐/可生成清单状态，并给出缺视频、缺图、缺镜头等阻塞原因；本轮已接入后端 export-queue 持久化入队状态。

项目列表与创建弹窗
  /workspace 项目卡片从旧 glass 面板改为深色项目封面卡，包含状态徽标、内容统计、更新时间和悬浮编辑/删除操作。
  新建项目卡和空态补齐“剧本拆解、角色资产、自动分镜”工作流提示。
  创建弹窗改为 FrameOS 式两栏工作流表单：基础信息、生产设置、剧本来源、项目水准、工作流预览。
  后端创建合同保持不变，仍只提交 name/description；生产设置作为前端工作流初始化 UI，不暴露登录和 Agent 模式。
  创建弹窗底部新增边界提示：智能执行能力由工作台阶段按钮触发，创建时只保留统一项目入口；页面文案不出现 Agent 模式选项。
  /super-agent 显式页面已改为重定向到 /projects；首页已删除旧 mode/agent 文案块，避免把内部自动执行能力作为外部入口。
  工作台内 Agent 修改和 Agent Workflow 浮动面板默认隐藏，仅在 NEXT_PUBLIC_NORI_INTERNAL_AGENT_TOOLS=true 时作为内部工具显示。
  SmartImportWizard 已移除 Agent 创建分支和 agentCreate 文案；首次项目导入只保留手动创建与智能文本分集入口。
  项目详情页已移除 Agent 运行恢复对导入向导的显式控制；普通剧本到分镜阶段运行继续以 srt workflowMode 保存，避免把阶段流标记成外部 Agent 项目。

主导航页面
  新增共享 FrameWorkbenchShell，抽出 FrameOS 风格左侧主导航、顶部 Navbar、底部服务记录/用户入口。
  FrameWorkbenchShell 已补齐移动端横向导航条：小屏不再隐藏主导航，项目、编剧工作台、工具箱、Seedance、资产库、素材库、提示词库、团队管理和底部辅助入口均可横向访问。
  全局 Navbar 的项目入口已从旧 /workspace 改为 /projects，顶部文案改为“项目 / Projects”，和 FrameOS 项目列表入口一致。
  /workspace 侧边栏从静态按钮改为真实导航链接，项目入口已改为 FrameOS 风格 /projects。
  资产库入口已改为顶层 /asset-hub，并新增 /asset-hub、/assets 兼容别名，内部复用 /workspace/asset-hub。
  /workspace/asset-hub 已接入共享 FrameWorkbenchShell，资产库页面现在使用同一套左侧主导航、顶部 Navbar 和高亮状态。
  新增 /projects 兼容入口，保留查询参数后重定向到 /workspace，复用当前项目列表和创建弹窗实现。
  新增 /workflow 顶层兼容入口，保留查询参数后重定向到 /projects，用作 FrameOS 工作流根路径回退。
  项目列表已读取 URL 的 search/page 参数；从 /projects?search=xxx&page=n 进入时会同步搜索框、分页状态和 /api/projects 请求，搜索/翻页交互也会写回 URL；项目入口新增项目生产概览，按草稿、剧本解析、分镜制作和导出交付汇总当前项目状态。
  新增 /writer-workbench、/writer-workbench/redraw-v2/:scriptId、/toolbox、/material、/prompts、/team 页面骨架。
  编剧工作台、工具箱、素材库、提示词库、团队管理先以功能卡片和工作流预览呈现，后续逐步接真实 API。
  /team 保留个人版信息架构入口，接入个人账号、项目/任务统计、成员席位矩阵、角色边界、权限矩阵和额度预览；不实现子账号登录、真实团队权限和计费额度。
  新增 /seedance 页面，对齐 FrameOS 的 Seedance 2.0 主导航入口，用于承载模型预设、参考资产、批量镜头和生成诊断。
  底部服务记录、问题反馈、检查更新从静态按钮改为真实路由入口，新增 /service-records、/feedback、/updates 页面骨架。
  /service-records 已接入现有 /api/tasks?limit=80，展示当前用户异步任务统计、服务用量概览、估算账单预览、最近失败和任务明细表。
  /service-records 新增服务配置矩阵，按视频生成、图像资产、音频音色、文本分析四类展示价格范围、成功率、调用次数和启用状态；本轮已接入 /api/user/balance、/api/user/costs、/api/user/transactions 和 /api/system/pricing，展示真实余额、冻结金额、累计消耗、项目费用排行、最近扣费流水、价格目录版本、模型覆盖和价格范围；真实套餐和团队额度仍待后续接后端模型。
  /service-records 可见统计和任务表过滤 super_agent、NORI_AGENT、自动创作模式等内部任务标记，避免把内部 Agent 能力作为外部服务记录类型暴露。
  /seedance 已接入现有 /api/video-enhance?limit=40，展示视频任务统计、Seedance 能力矩阵、最近视频增强历史、Seedance 模型预设和跳转到 /video-enhance 的操作入口。
  /prompts 已接入现有 /api/prompt-templates，展示提示词模板目录、提示词覆盖矩阵、中文/英文覆盖统计、变量占位和剧本/资产/分镜/视频分组。
  /material 已接入现有 /api/assets?scope=global，展示全局素材统计、素材生产矩阵、角色/场景/道具/音色分组、最近素材预览和跳转到 /asset-hub 的入口。
  /toolbox 已接入 /api/user/api-config、/api/tasks?limit=60、/api/assets?scope=global、/api/prompt-templates，展示模型配置、任务状态、素材库、提示词模板的生产诊断、生产能力矩阵、最近任务队列和快捷入口。
  /writer-workbench 已接入 /api/projects?page=1&pageSize=8，展示剧本项目队列、剧本准备矩阵、第一集文本预览、分集/分镜/视频统计，并链接到项目剧本页和 redraw-v2 入口。
  /writer-workbench/redraw-v2/:scriptId 已接入 /api/projects/:scriptId/data，展示项目原稿预览、重绘准备矩阵、分集列表、字数/角色/场景统计和重绘检查清单。
  /updates 已新增并接入 /api/system/status，展示 package 版本、服务启动 ID、Node/NPM/Next/React 依赖状态、模块更新矩阵、发布轨道、最近变更和更新检查项。
  /feedback 已加入个人版反馈记录表单和处理看板，支持问题类型、标题、路由、描述、浏览器上下文、分诊/解决状态和按类型汇总；本轮已接入 /api/feedback 与 .runtime/feedback 后端持久化，刷新后可恢复账号反馈记录，API 不可用时才降级到 localStorage。
  /team 已接入 /api/projects?page=1&pageSize=6 和 /api/tasks?limit=40，展示个人账号、拥有者角色、成员席位矩阵、项目/分集/任务统计、任务负载分布、额度预览、权限矩阵和团队角色预留边界。

项目 workbench 子路由
  新增 /workspace/:projectId/script、/characters、/storyboard 桥接入口，对齐 FrameOS 顶层 workflow 子页面。
  新增 /workspace/:projectId/workbench/[[...segments]] 和 /workbench-premium2/[[...segments]] 桥接入口。
  新增 /workflow、/workflow/:projectId、/workflow/:projectId/script、/characters、/storyboard、/workbench/[[...segments]]、/workbench-premium2/[[...segments]] 兼容别名。
  /workflow 路由不复制一套页面，统一重定向到 /workspace/:projectId 并携带 stage、focus、episode、shotId、workbench=premium2 等查询参数。
  script-review -> stage=config，assets/characters/items/environments -> stage=script，assets/timbre -> stage=voice。
  production/episodes、production/timeline、production/shot、production/shot/:shotId -> stage=videos。
  production/export -> stage=editor，即独立导出交付页。
  项目内大屏 workbench 分组子项从纯前端按钮改为真实路由链接，再由桥接层落到现有阶段实现。

workbench focus 子视图
  新增 WorkbenchFocusPanel，根据 URL focus 参数展示 FrameOS 子页面上下文。
  script、script-review、characters、items、environments、timbre、storyboard、episodes、timeline、shot、shot-detail、export 均有独立标题、路由标识和三段式操作说明。
  workbench=premium2 时显示“精品版 2.0”上下文，但仍复用当前个人版阶段能力。
  /workbench 根页面已从说明性卡片升级为阶段生产总览，读取 workflow-state 展示 6 个阶段卡、后端派生状态、进度条、关键产物统计和跳转入口。
  focus 视图已读取当前项目/剧集数据，展示角色、道具、环境、剧本片段、分镜、镜头、视频完成度等概览。
  script 子视图新增剧本解析入口检查面板，展示当前剧集原稿/SRT 预览、字数、生产配置、解析模型、片段/角色/场景/道具产物状态，并可进入解析结果或分镜。
  script-review 子视图新增剧本拆解复核面板，按片段展示场景、角色、道具、剧本正文、分镜关联、镜头数量和进入分镜/镜头的跳转入口。
  workbench focus 子视图新增显示层清洗：脚本、剧集、资产、分镜、镜头、时间线和详情输入的可见文本会过滤 NORI_AGENT / Super Agent / 自动创作模式等内部标记，保留个人版统一工作台入口而不暴露 Agent 模式。
  characters/items/environments/shot-detail 已加入详情检查台：左侧预览图，右侧描述、引用统计、提示词、输出状态和下一步动作。
  characters/items/environments 子视图已加入资产生产看板，按资产类型统计图像就绪、缺图像、已绑镜头、仅剧本引用，并列出图像待补齐和待绑定镜头队列，便于从资产页批量补齐生产缺口。
  characters/items/environments 子视图已加入资产详情选择器，可通过 characterId、itemId、environmentId 查询参数选中具体资产，刷新或分享 URL 后仍保持选中状态。
  items/environments 检查台已支持编辑名称和摘要；environments 通过 locationId 保存，items 通过 propId 别名保存到复用的 /api/novel-promotion/:projectId/location。
  characters 检查台已支持编辑角色名称和介绍，并通过 /api/novel-promotion/:projectId/character 保存。
  shot-detail 检查台已支持编辑镜头描述、景别/镜头类型、运镜、场景、角色、道具、画面/视频提示词和镜头时长，并通过 /api/novel-promotion/:projectId/panel 保存；本轮已新增单镜头生产检查台，汇总画面、视频、资产引用、提示词、时长、任务运行和失败信息，编辑前即可判断当前镜头缺口。
  timbre 子视图新增角色音色匹配检查台，按角色展示音色绑定状态、音色来源、上传参考音频、剧本引用、镜头引用和角色资产入口。
  episodes 子视图新增剧集制作检查列表，按集展示镜头数、画面数、视频数和视频完成进度，并可直接进入对应剧集 timeline。
  storyboard 子视图新增分镜组检查列表，按组展示关联 clip 摘要、镜头数、画面数、视频数、资产引用数量和视频完成进度，并可直接进入该组首个镜头详情；本轮已升级为分镜生产看板，按镜头待补齐、资产引用待补齐、画面待生成、视频已完成分组，同时展示计划镜头、已拆镜头、画面/视频覆盖和分镜质量检查。
  shot 子视图新增镜头制作队列，按镜头展示预览图、提示词摘要、顺序、时长、画面/视频/资产引用就绪状态和生产完成度，并可进入单镜头详情处理缺失项；本轮已升级为生产看板，按画面待生成、视频待生成、可交付、需关注分组，同时展示运行中任务、失败数、缺引用数和平均时长，并提供进入时间线/导出的动作入口。
  timeline 子视图新增时间线镜头检查列表，展示总时长、缺画面、缺视频统计，以及每个镜头的顺序、画面、视频、时长和提示词摘要；本轮已升级为时间线交付总览，补充平均时长、缺引用、缺时长、可交付镜头统计，以及引用待补齐/时长待校准队列。
  timeline 子视图已支持批量编辑镜头时长、景别/镜头类型和运镜方式，并通过 /api/novel-promotion/:projectId/panel 逐项保存变更。
  timeline 子视图已支持同一分镜组内镜头上移/下移重排；前端调用 /api/novel-promotion/:projectId/panel 的 reorderDirection 操作，后端用事务交换 panelIndex/panelNumber 并保持 storyboard 内唯一顺序。
  timeline 镜头条目已链接到 /workspace/:projectId/workbench/production/shot/:shotId，桥接层会将 shotId 写入最终 URL 并选中对应镜头。
  export 子视图新增导出交付检查面板，汇总成片视频、资产包、交付清单和音频素材的就绪状态，并提供时间线和镜头制作回跳入口；实际下载仍由下方 ExportDeliveryStage 承载。
  目前仍复用现有阶段主内容；下一步再扩展到 timeline 跨分镜拖拽排序、批量重排和更完整的镜头字段。

工作流阶段状态
  新增 /api/projects/:projectId/workflow-state，只读汇总当前项目或指定剧集的剧本、资产、分镜、视频、配音和导出交付状态。
  API 当前返回 source=derived，按真实产物计算 empty/active/ready、progress 和 counts，避免工作台完全依赖前端局部推断。
  工作台阶段导航已接入 useWorkflowState；当没有运行中操作时，优先采用后端派生状态显示“待处理 / 进行中 / 已就绪”。
  左侧项目工作流侧边栏已展示阶段进度条和关键产物统计，例如场次数、镜头数、视频数和草稿数。
  /workbench 根总览已复用同一份 workflow-state，形成可点击的阶段生产看板，用户可从总览直达剧本复核、资产设定、分镜、时间线、音色和导出交付。
  刷新项目或剧集数据时会同步刷新 workflow-state。
  /workbench 根总览新增人工校准层，可将每个阶段标记为“人工确认”或“需复核”；本轮已从 localStorage 升级为 /api/projects/:projectId/workflow-stage-review 服务端持久化，并在 workflow-state 响应中返回 reviewStates。
  该结构当前使用 .runtime/workflow-stage-review 文件存储；后续仍需迁移为数据库版 WorkflowStageState，用于失败回滚、跨实例同步和后台任务推进。
```
