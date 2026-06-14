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
  /updates 已新增并接入 /api/system/status，展示 package 版本、服务启动 ID、Node/NPM/Next/React 依赖状态、模块更新矩阵、发布轨道、最近变更和更新检查项；本轮已新增 /api/system/update-check 与 .runtime/update-checks 后端检查历史，页面支持“立即检查”并展示最近检查记录。
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

2026-06-13 Prompt 与模型调用策略调优追加记录：

```text
模型调用策略
  文本分析链路统一优先使用 Lumina GPT-5.5，标准模型键为 lumina::gpt-5.5。
  新增 src/lib/lumina-fixed-models.ts，集中定义 Lumina provider、gpt-5.5 modelId 和 modelKey，避免各链路手写字符串。
  config-service 恢复“项目配置 > 用户偏好 > 默认模型”的优先级；仅在项目和用户都未配置分析模型时回退到 lumina::gpt-5.5。
  test-mode 默认分析模型从 HFSY GPT-5.5 切换为 Lumina GPT-5.5；HFSY 仍仅作为图片/视频兼容模型使用。
  SuperAgentLLMClient 不再硬编码 HFSY 文本模型，改为读取用户 analysisModel，缺省回退 Lumina GPT-5.5。
  scripts/setup-test-api-config.ts 已移除明文 API key，改为读取 NORI_TEST_LUMINA_API_KEY/LUMINA_API_KEY 和 NORI_TEST_IMAGE_API_KEY/HFSY_API_KEY。

剧本解析 prompt
  agent_clip 增强导演节拍切分口径：summary 必须标明建立、触发、推进、反应、反转、转场或收束等生产功能。
  agent_clip 强化 characters/location/props 只写真正出镜、被持有、被使用或会参与后续生产的实体，减少只被提及对象污染资产库。
  screenplay_conversion 补充短剧生产约束：scene/content 必须能支撑资产复核、正反打分镜、配音匹配和导出检查；关键动作、道具交付、离场和情绪转折必须保留在 action 文本中。

资产设定与引用一致性
  agent_storyboard_plan 增强 FrameOS 式阶段产物口径：每个镜头必须有主体、动作、场景、引用资产和 source_text，便于后续图片提示词、视频提示词、配音和缺失检查。
  agent_storyboard_plan 增强角色 appearance 连续性：只有原文存在持续换装、年龄变化、伪装或形态变化时才切换子形象。
  agent_storyboard_plan/detail 要求字段中引用的角色、场景、道具必须在 description/video_prompt 中形成同名画面关系，避免字段引用存在但画面描述缺失。

分镜、镜头提示词与配音
  agent_storyboard_detail 强化导出前可检查性：description、shot_type、camera_move、video_prompt、duration、characters、location、props、source_text 必须互相一致。
  agent_storyboard_detail 要求 video_prompt 明确主体动作、镜头运动和引用资产；有台词时写明正在说话，有道具状态变化时写明可见变化。
  agent_cinematographer 增强资产空间连续性，technical_notes 必须给出主体清晰、背景虚化、道具位置、前后景关系或轴线连续等可执行生产提示。
  voice_analysis 增强 speaker 规范名稳定性：同一角色不能在不同台词里混用“我/丈夫/称谓/真名”，并优先匹配 video_prompt 已标注“正在说话”的镜头。
  image_prompt_modify 强化重绘改写：除非用户明确替换，不丢失原角色、场景和道具引用；image_prompt 与 video_prompt 不能互相矛盾。

回归与验证
  新增 tests/unit/test-mode-lumina-defaults.test.ts，锁定 test-mode 分析模型为 lumina::gpt-5.5。
  更新 tests/unit/config-service-project-defaults.test.ts，覆盖项目/用户配置缺省时的 Lumina GPT-5.5 fallback。
  更新 tests/unit/super-agent/llm-client.test.ts，覆盖 SuperAgent 文本链路读取用户模型并在缺省时回退 Lumina GPT-5.5。
  已运行 prompt A/B 占位符回归、英文语义回归和 JSON canary，确认模板占位符、关键 JSON token 和小样本结构仍然稳定。

样例输入输出
  本轮未把桌面 test.docx 的具体内容写入模板或代码。
  小样本结构继续使用 standards/prompt-canary 下的通用片段、剧本、分镜和台词样例；本轮调优只约束通用字段质量和资产引用一致性。

剩余问题
  仍需在真实 TEST 项目里用 /Users/headmasterx/Desktop/test.docx 跑一轮 Lumina GPT-5.5 live 输出，对照 FrameOS 的剧本解析与资产设定结果继续调 prompt。
  当前未新增导出前检查后端规则，只强化了 prompt 输出对现有检查字段的可用性；缺图、缺视频、缺引用、缺提示词、时长异常仍沿用现有工作台检查能力。
  Lumina API key 只应通过环境变量或用户配置中心注入，不写入仓库文件。
```

2026-06-13 资产设定契约调优追加记录：

```text
本轮目的
  继续向 FrameOS 式“先建资产库、再绑定分镜、再做镜头生产”的链路靠拢。
  重点补足角色、场景、道具和角色视觉图 prompt 的资产契约，而不是新增后端规则检查。
  远端 FrameOS 登录已到安全验证页面；需要用户确认后才能继续处理 CAPTCHA 并采集 TEST 项目真实输出。

影响链路
  agent_character_profile:
    name 被明确为剧本解析、分镜、台词匹配、配音绑定和导出检查共用的规范主键。
    aliases 只保留原文真实称呼、代号、关系称谓或第一人称映射，避免把职业/性格/外貌写成别名。
    introduction 必须回答“这个角色是谁、和谁有关、后续哪些称呼映射回此角色”。
    expected_appearances 只保留持续外观版本，不把情绪、动作、受光、镜头状态写成子形象。

  select_location:
    summary 需要说明场景生产用途，如主要冲突场、过渡走廊、角色居住空间、审讯空间等。
    available_slots 被定义为后续分镜角色落位的稳定锚点，必须跨邻近镜头复用。
    descriptions 必须出现 available_slots 提到的锚物并留出人物可站立/进入的空间。
    同一地点只有在时间/状态变化会显著影响生产时才拆成独立场景资产。

  select_prop:
    name 是稳定道具资产名，description 要包含形状、材质、颜色、纹理、标记或结构特征。
    道具状态变化不拆新资产；默认静态外观留在道具库，打开、断裂、裂屏等状态留给分镜 description 和 video_prompt。

  agent_character_visual:
    主形象被定义为全片默认复用资产，三条描述只能细节变化，不能变成不同人。
    子形象必须继承主形象的面部、体型、发型和核心辨识标志，只写持续服装、年龄或特殊装扮变化。
    descriptions 不写镜头、背景、动作、情绪、台词或剧情功能；这些由分镜和 video_prompt 承担。

样例输入输出
  仍使用 standards/prompt-canary 下通用英文小样本作为结构样例。
  未把 /Users/headmasterx/Desktop/test.docx 的正文写入模板、测试或文档。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npm run check:no-model-key-downgrade 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/worker/screenplay-convert.test.ts tests/unit/worker/story-to-script-orchestrator.retry.test.ts 未执行到测试体，仍被本机 Rollup native 包签名问题阻塞：
    @rollup/rollup-darwin-arm64 rollup.darwin-arm64.node Team ID 签名不匹配 / ERR_DLOPEN_FAILED。
  npm run check:no-model-key-downgrade 通过。
  npm run check:prompt-i18n 仍失败于既有 legacy skill prompt 文件：
    lib/prompts/skills/api-config-template.system.txt
    lib/prompts/skills/tutorial.system.txt

剩余问题
  需要用户确认是否处理 FrameOS 页面 CAPTCHA；确认后继续登录 TEST 项目并采集真实剧本解析/资产设定输出。
  真实对标输出尚未采集，因此本轮 asset prompt 调优基于现有架构、FrameOS 页面公开工作流信息和本地 canary 样例。
  仍未新增生产运行时规则检查；后续如果要补结构化 schema，应优先作为 prompt 输出契约和测试样例，而不是在生成链路中硬拦截。
```

2026-06-13 Lumina 真实采样与输出预算追加记录：

```text
本轮目的
  在无法继续远端 FrameOS CAPTCHA 前，先用 /Users/headmasterx/Desktop/test.docx 做本地 Lumina GPT-5.5 真实调用采样。
  采样输出只写入 /tmp/nori-lumina-sample-excerpt，不进入仓库；文档只记录统计和链路发现，不记录 test.docx 正文。

采样输入
  test.docx 可提取文本：21794 字符，762 段。
  首轮整篇 + 大 prompt 调用超时，因此改为开头 6000 字的链路采样。

采样结果
  角色资产抽取：可解析 JSON，抽到 17 个角色。
  场景资产抽取：可解析 JSON，抽到 8 个场景。
  道具资产抽取：可解析 JSON，抽到 3 个道具。
  切片初跑：返回空 text，但 usage 显示消耗 output_tokens，说明长 JSON 输出预算/模型输出策略不足。
  剧本转换初跑：同样返回空 text。
  将切片 max_tokens 提高到 9000 后，Lumina 返回 type=text 内容，可解析 JSON，得到 14 个片段。
  基于第一个片段将 screenplay max_tokens 提高到 8000 后，Lumina 返回可解析 JSON，得到 5 个 scene。

模型调用策略调整
  新增 ChatCompletionOptions.maxTokens 与 AiStepExecutionInput.maxTokens，贯穿 ai-runtime -> model-gateway -> Lumina Anthropic-compatible 调用。
  story-to-script 与 script-to-storyboard worker 的 runStep 不再丢弃 maxOutputTokens，而是作为 maxTokens 传入模型调用，并设置 4096 下限、12000 上限。
  story-to-script orchestrator 输出预算上调：
    analyze_characters: 6500
    analyze_locations: 6500
    analyze_props: 3000
    split_clips: 6500
    screenplay_conversion: 5500
  独立 clips-build 任务使用 maxTokens=6500。
  独立 screenplay-convert 任务使用 maxTokens=5500。

验证
  npx tsc --noEmit --pretty false 通过。
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。

剩余问题
  远端 FrameOS TEST 项目的真实输出仍需用户确认 CAPTCHA 后采集。
  本轮只证明本地 Nori prompt + Lumina 在 test.docx 前 6000 字采样上可产出结构化 JSON；尚未完成整篇自动跑批与 1:1 对标。
  若后续整篇仍超时，需要按 FrameOS 式工作流改为分段运行，而不是把全文和所有资产库塞进单次大 prompt。
```

2026-06-13 FrameOS 前端包契约抽取追加记录：

```text
证据边界
  本轮只基于 FrameOS 公开前端 bundle 抽取接口契约和字段语义。
  远端登录仍停在“确认您不是机器人”安全验证页；未处理 CAPTCHA，未采集 TEST 项目真实输出。
  结论用于调整 Nori 的 prompt 和持久化字段，不把对方代码、素材、品牌资源写入本仓库。

剧本解析契约
  script review 相关接口集中在 /api/episodes/list、/api/estimate-cost、/api/episodes/generate、/api/scenes/update、/api/approve、/api/unapprove、/api/art-direction、/api/worlds/*。
  关键顶层字段包括 status、steps、script_kilo、strategy_thinking、style_reasoning、default_visual_style、items。
  episode 字段包括 episode_id、episode_number/episode_no、title、content、content_kilo、status、info_points、source_anchor、reasoning。
  episode reasoning 可包含 opening_strategy、adaptation_decision、ending_strategy、self_review。
  scene 字段包括 scene_id、scene_number/scene_no、heading、location、time、int_ext、summary、characters、content、scene_reasoning、visual_style、visual_style_description。
  状态语义包含 running/queued/processing/parsing、completed/extracted/success/done/approved、failed、idle/confirmed/pending/active。

资产设定契约
  新资产接口以 /api/asset 为主，包括 /list、/extraction/start、/estimate-cost、/create、/update、/variant/create、/delete、/confirm、/unconfirm、/image/*、/voice/*。
  通用资产字段包括 asset_id、name、asset_type、status、is_confirmed、material_id、material_url、design_status、design_image、coverage_episodes、variants、variant_tags。
  character 字段包括 role_type、appearance/description、background、identity_lock、prompt/base_prompt、voice_id、voice_raw_file、voice_trait、representative_line、voice_audition_prompt、voice_materials、audition_status、selected_voice_material_id、voice_source。
  item/prop 字段包括 item_type、description、significance、background、prompt/base_prompt。
  environment 字段包括 int_ext、description、background、prompt/base_prompt、reference_images。
  variant 字段包括 variant_id、variant_type、label/name、category、description、prompt、visual_delta、material_url、design_status、status、coverage_episodes。
  资产流转顺序是角色/物品/环境列表与详情 -> 编辑 prompt/background -> 生成主图 -> 生成变体 -> 从历史/导入/AI 修改中选图 -> 确认；音色在角色确认后进入 match/list/select/upload/audition。

本轮 Nori 对齐
  agent_character_profile 已新增 background、identity_lock、voice_trait、representative_line、voice_audition_prompt 输出提示，并在 analyze-novel、analyze-global-persist、story-to-script-helpers 中写入 profileData。
  screenplay_conversion 已新增道具资产库输入和 scene_reasoning 输出字段；scene_reasoning 只允许说明原文支撑的场景拆分、资产确认或分镜生产价值。
  独立 screenplay-convert worker 改为通过 buildPrompt 渲染模板，并按 NovelPromotionLocation.assetKind 将 location 与 prop 分流传入 locations_lib_name / props_lib_name，避免道具污染场景库。

仍待后续
  TEST 项目真实输出仍需用户明确确认后再处理 CAPTCHA 并采集。
  episode wrapper、worlds、strategy_thinking、style_reasoning 仍处于未来 schema/文档对齐阶段，尚未强制落库。
  default_visual_style、visual_style、visual_style_description 已进入 screenplay/panel JSON 链路，但未新增独立数据库字段。
  coverage_episodes、统一 variant 抽象和完整 voice source 流程本轮只记录契约，尚未新增数据库迁移。
```

2026-06-13 Clip 复核元数据对齐追加记录：

```text
本轮目的
  将 FrameOS 剧本复核里常见的 source_anchor、info_points、reasoning 下沉到 Nori 的片段切分与剧本转换生成链路。
  不新增数据库迁移，不增加规则检查；只扩展 prompt 输出 schema、内存候选结构和最终 screenplay JSON。

影响链路
  agent_clip:
    输出 schema 新增 source_anchor、info_points、reasoning。
    source_anchor 是片段内部最能定位内容的原文短句。
    info_points 只列原文已有的剧情、资产或动作事实。
    reasoning 只解释切分选择和生产用途，不新增剧情。

  story-to-script orchestrator:
    split_clips 解析时保留 source_anchor、info_points、reasoning。
    screenplay_conversion 成功后将这些字段合并到 screenplay JSON 顶层，供后续剧本复核、资产确认和分镜追溯使用。
    若 screenplay 自身已输出 reasoning/source_anchor/info_points，则保留 screenplay 输出优先级。

  standalone screenplay-convert:
    对已有 clip 记录，用 startText/endText 补 source_anchor，用 summary 补 info_points。
    不由代码生成 reasoning，避免伪造模型推理。

样例输入输出
  回归测试只使用通用短句“甲在门口。乙回答。”验证字段透传。
  未把 /Users/headmasterx/Desktop/test.docx 的正文写入模板、测试或文档。

验证
  新增/更新测试覆盖：
    tests/unit/worker/story-to-script-orchestrator.retry.test.ts
    tests/unit/worker/screenplay-convert.test.ts

剩余问题
  FrameOS TEST 项目真实 output 仍未采集；字段命名来自公开 bundle 契约和当前前端可见结构。
  episode 级 wrapper、strategy_thinking、style_reasoning 和 worlds 仍需后续根据真实输出继续对齐。
  若后续要把 clip 元数据作为独立可查询字段，需要数据库迁移；本轮只写入 screenplay JSON。
```

2026-06-13 视觉风格上下文对齐追加记录：

```text
本轮目的
  将 FrameOS scene 级 visual_style、visual_style_description 和 default_visual_style 的契约接入剧本转换与分镜规划。
  目标是让剧本解析产出的场景视觉风格能继续约束分镜、镜头提示词和后续画面生成，而不是只停留在文档。

影响链路
  screenplay_conversion:
    scene 输出新增 visual_style 与 visual_style_description。
    字段只描述美术方向、光线、色调、质感、构图、氛围或短剧类型，不得添加剧情事实。

  screenplay visual style context:
    新增 buildScreenplayVisualStyleContext，用于从 screenplay JSON 中整理 default_visual_style 和 scene visual style。
    普通 script-to-storyboard orchestrator、atomic retry 和旧 storyboard-phases phase1 路径都会替换 {visual_style_context}。

  agent_storyboard_plan:
    新增剧本视觉风格上下文输入。
    panel 输出新增 visual_style 和 visual_style_description，要求承接 screenplay 风格，只调整光线、色调、质感、构图和氛围。

  agent_storyboard_detail:
    要求保留或细化 panel 的 visual_style 与 visual_style_description，防止 phase3 细化时丢失风格约束。

样例输入输出
  回归测试使用通用短句和通用场景名，验证 screenplay.default_visual_style 与 scenes[].visual_style 会进入 phase1 prompt。
  未把 /Users/headmasterx/Desktop/test.docx 的正文写入模板、测试或文档。

验证
  新增/更新测试覆盖：
    tests/unit/worker/script-to-storyboard-orchestrator.retry.test.ts

剩余问题
  TEST 项目真实 visual style/default_visual_style 输出仍未采集。
  strategy_thinking、style_reasoning、worlds 仍未进入运行链路；后续需要结合真实输出决定是写入 screenplay JSON、artifact，还是只作为 prompt 上下文。
  本轮不新增数据库字段；视觉风格随 screenplay JSON 和 panel JSON 保存。
```

2026-06-13 音色资产上下文对齐追加记录：

```text
本轮目的
  将角色档案中已抽取的 FrameOS 式 voice_trait、representative_line、voice_audition_prompt 接入台词/配音分析。
  目标是让 speaker 规范名、情绪强度和后续音色试镜更稳定，而不是只把音色线索停留在 profileData。

影响链路
  buildCharacterVoiceContext:
    新增专用角色音色上下文构建函数。
    只读取角色 profileData 中的 voice_trait、representative_line、voice_audition_prompt。
    无可用线索时返回“暂无音色资产线索”。

  voice_analysis:
    prompt 新增 character_voice_context 输入。
    规则明确这些音色线索只用于稳定说话气质、情绪强弱和试镜参考。
    speaker 仍必须是角色/发言人身份，不允许输出音色模型名或配音演员名。

  运行入口:
    独立 voice-analyze worker 已传入 character_voice_context。
    script-to-storyboard 内置 voice_analyze step 已传入 character_voice_context。

样例输入输出
  回归测试只使用通用角色 Hero 和通用台词，不使用 /Users/headmasterx/Desktop/test.docx 正文。
  示例音色线索为 voice_trait=低沉克制、representative_line=我来负责，用于验证 prompt 变量传递。

验证
  更新测试覆盖：
    tests/unit/worker/voice-analyze.test.ts

剩余问题
  FrameOS TEST 项目真实音色匹配、voice_source、audition_status、selected_voice_material_id 输出仍未采集。
  Nori 当前只把音色上下文传入台词分析；完整 voice match/list/select/upload/audition 流程仍需后续对齐。
  本轮不新增数据库字段；音色线索继续随 character.profileData 保存。
```

2026-06-13 导出前 LLM 质检 prompt 追加记录：

```text
本轮目的
  在“不新增规则检查”的约束下，补齐 FrameOS 式导出前检查的 LLM 审核模板。
  目标是让缺图、缺视频、缺引用、缺提示词、时长异常、资产缺口、音色缺口和连续性风险能以统一 JSON 质检结果交给工作流阶段消费。

影响链路
  prompt catalog:
    新增 NP_EXPORT_PREFLIGHT_REVIEW / novel-promotion/export_preflight_review 双语模板。
    输入包括 export_target、episodes_json、assets_json、storyboard_json、voice_json。

  export_preflight_review:
    输出 status、readiness、issues、deliverables、next_actions。
    issues.code 覆盖 missing_image、missing_video、missing_reference、missing_prompt、duration_risk、asset_gap、voice_gap、continuity_gap、manifest_gap。
    规则明确只根据输入 JSON 里已有字段、状态、URL、引用关系和说明判断，不编造媒体、资产或配音结果。
    产品文案只描述工作流阶段审核，不暴露 Agent / Super Agent / 自动创作模式。

样例输入输出
  新增单测使用人工构造的 Episode 1 delivery package、Sample episode、Ari、Workshop、panel-1、voice-1。
  样例只验证模板 schema 和变量渲染，不使用 /Users/headmasterx/Desktop/test.docx 正文。

验证
  npm run check:prompt-ab-regression 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-json-canary 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/prompt-i18n/export-preflight-review-template.test.ts 未执行到测试体，仍被本机 Rollup native 包签名问题阻塞：
    @rollup/rollup-darwin-arm64 rollup.darwin-arm64.node Team ID 签名不匹配 / ERR_DLOPEN_FAILED。

剩余问题
  该 prompt 已注册但尚未接入实际导出任务入口；后续可以在最小 worker/任务包装中调用 Lumina GPT-5.5 产出审核 JSON。
  现有导出页仍沿用 UI/工作台的确定性就绪统计；本轮没有新增生产规则检查。
  FrameOS TEST 项目真实导出前检查输出仍未采集，需 CAPTCHA 后才能对标字段细节。
```

2026-06-13 资产出场集与子形象贯穿追加记录：

```text
本轮目的
  补齐 FrameOS 资产契约中的 coverage_episodes 与角色子形象 expected_appearances 贯穿。
  目标是让角色出场范围和持续外观版本从角色档案 prompt 输出后进入 profileData，并继续传给角色形象生成 prompt。

影响链路
  agent_character_profile:
    角色级新增 coverage_episodes 输出要求。
    expected_appearances 子项新增 coverage_episodes 输出要求。
    明确 coverage_episodes 只能来自可定位的分集、章节、场次或剧情段；不确定时输出空数组。

  persist profileData:
    analyze-global-persist、story-to-script-helpers、analyze-novel 三条角色创建路径都保留 coverage_episodes 与 expected_appearances。
    新增 normalizeCoverageEpisodes 与 normalizeExpectedAppearances，用于保存字符串/数字集数标签和子形象变化原因。

  character profile confirmation:
    CharacterProfileData 类型补齐 background、identity_lock、coverage_episodes、voice_trait、representative_line、voice_audition_prompt、expected_appearances。
    角色确认生成形象时，character_profiles JSON 会带上 coverage_episodes 与 expected_appearances。

  agent_character_visual:
    子形象生成跟随 expected_appearances 的 change_reason 与 coverage_episodes 规划。
    coverage_episodes 只作为生产规划元数据，不写进 image descriptions。

样例输入输出
  回归样例使用通用角色“新角色”与通用分集标签“第1集”。
  未把 /Users/headmasterx/Desktop/test.docx 正文写入模板、测试或文档。

验证
  npm run check:prompt-ab-regression 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-json-canary 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。

剩余问题
  本轮不新增数据库字段；coverage_episodes 和 expected_appearances 仍随 character.profileData JSON 保存。
  资产 API/mappers 和前端资产卡片尚未展示 coverage_episodes。
  FrameOS TEST 项目真实资产设定输出仍未采集，需 CAPTCHA 后才能继续 1:1 对齐字段细节。
```

2026-06-14 剧本复核顶层字段对齐追加记录：

```text
本轮目的
  将 FrameOS 剧本复核契约中的 status、steps、script_kilo、strategy_thinking、style_reasoning、default_visual_style、worlds 接入 screenplay_conversion 输出 schema。
  目标是让剧本解析结果不只保存 scenes，还保存制作策略、风格依据、默认视觉风格和世界/时代/空间规则，方便后续资产设定、分镜规划和导出前 LLM 质检复用。

影响链路
  screenplay_conversion:
    顶层输出新增 status、steps、script_kilo、strategy_thinking、style_reasoning、default_visual_style、worlds。
    strategy_thinking 和 style_reasoning 定义为面向制作人员的可展示策略摘要，不输出隐藏推理链、模型自述或系统提示。
    worlds 只记录原文支持的时代、世界观、空间规则、社会关系或生产限制；没有明确依据时输出空数组。
    default_visual_style 必须与 scenes[].visual_style 兼容，不得添加原文没有的事件、角色或道具。

  持久化:
    standalone screenplay-convert 原样保存模型返回的顶层字段，并继续补充 clip_id、original_text、source_anchor、info_points。
    story-to-script orchestrator 的 screenplay_conversion 结果继续透传顶层字段，并合并 clip review 元数据。

  回归:
    screenplay_conversion canary 新增 status、steps、script_kilo、strategy_thinking、style_reasoning、default_visual_style、worlds 样例。
    prompt-json-canary 与 prompt semantic regression 将这些字段纳入关键 token，防止后续模板回退。

样例输入输出
  回归样例使用 Lena/Victor、grand_hall_night 等通用英文短句，以及“甲在门口。乙回答。”通用中文短句。
  未把 /Users/headmasterx/Desktop/test.docx 正文写入模板、测试或文档。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  TEST 项目真实 strategy_thinking、style_reasoning、worlds 输出仍未采集；字段细节仍基于公开 bundle 契约和本地工作流需要。
这些字段当前随 screenplay JSON 保存，未新增数据库字段或独立审核页面。
```

2026-06-14 FrameOS TEST 真实输出结构对齐追加记录：

```text
证据来源
  用户在本机 Chrome 完成 FrameOS 安全验证后，复用登录态读取 TEST 项目的剧本解析与资产设定接口。
  原始响应只保存在 .runtime/frameos-test-output/raw/，不写入仓库、测试、prompt 或文档。
  本记录只保留字段结构、数量和 schema 结论，不包含 /Users/headmasterx/Desktop/test.docx 正文或模型生成原文。

真实结构摘要
  project detail:
    episodes 数量 30。
    asset_stats 显示 character_total=22、item_total=15、environment_total=30。
    director_stats 显示 episode_total=30、shot_total=30、duration_minutes=6。

  screenwriter episodes list:
    顶层字段为 status、steps、default_visual_style、script_kilo、adapted_kilo、items。
    steps 是对象数组，字段为 step、name、status、time。
    items 是分集数组，字段为 episode_id、episode_number、title、content、content_kilo、info_points、source_anchor、reasoning、status、scenes。
    source_anchor 为 start/end 对象；reasoning 为 diagnosis/key_decisions 对象。
    scenes 字段为 scene_id、scene_number、heading、int_ext、location、time、summary、content、content_kilo、characters、visual_style、visual_style_description、visual_style_confirmed。

  art direction:
    顶层字段为 flow_status、flow_id、current_label、derived_phase、default_world_label、worlds。
    worlds 字段为 world_label、world_background、representative_frame、candidates、selected_style_anchor、preview_materials。

  character assets:
    顶层字段为 status、extraction_status、characters、has_deprecated_characters。
    character 字段为 character_id、name、role_type、description、background、representative_line、identity_lock、voice_trait、voice_id、voice_raw_file、relationships、coverage_scenes、coverage_episodes、speech_rate、is_confirmed、prompt、voice_audition_prompt、audition_status、variants、design_image。
    variants 字段为 variant_id、label、variant_type、prompt、coverage_scenes、coverage_episodes、design_image。

  item assets:
    顶层字段为 status、extraction_status、items、has_deprecated_items。
    item 字段为 item_id、name、item_type、description、background、significance、coverage_scenes、coverage_episodes、is_confirmed、prompt、variants、design_image。

  environment assets:
    顶层字段为 status、extraction_status、environments、has_deprecated_environments。
    environment 字段为 environment_id、name、int_ext、description、background、entrance、mood、base_ambience、coverage_scenes、coverage_episodes、is_confirmed、prompt、variants、design_image。

  voice mapping:
    顶层字段为 status、voice_mapping、auditions。
    voice_mapping 字段为 character、character_id、role_type、voice_profile、voice_source、voice_raw_file、candidates。
    voice_profile 字段为 gender、age_range、traits；candidate 字段为 rank、voice_id、voice_name、reason、is_selected、reference_audio_id。

反推到 Nori prompt/workflow
  screenplay_conversion:
    steps 从字符串数组升级为 FrameOS 式对象数组。
    worlds 从 name/description/source_anchor 升级为 world_label/world_background/representative_frame/candidates/selected_style_anchor/preview_materials。

  agent_character_profile:
    新增 role_type、description、relationships、coverage_scenes、prompt、variants、speech_rate、voice_id、voice_raw_file、audition_status、is_confirmed、design_image 输出约束。
    三条角色创建路径会把 role_type、description、relationships、coverage_scenes、prompt、variants、speech_rate、voice_id、voice_raw_file、audition_status 保存到 profileData。

  select_location:
    在保留 Nori 现有 summary、available_slots、descriptions 的基础上，新增 environment_id、int_ext、description、background、entrance、mood、base_ambience、coverage_scenes、coverage_episodes、prompt、variants、is_confirmed、design_image。

  select_prop:
    在保留 Nori 现有 name、summary、description 的基础上，新增 item_id、item_type、background、significance、coverage_scenes、coverage_episodes、prompt、variants、is_confirmed、design_image。
    道具仍保持宁缺毋滥策略，防止把普通场景陈设误报为资产。

验证
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/novel-promotion/character-profile-metadata.test.ts tests/unit/prompt-i18n/select-prop-template.test.ts 未执行到测试体，仍被本机 Rollup optional native 包 @rollup/rollup-darwin-arm64 的 Team ID 签名/ERR_DLOPEN_FAILED 问题阻塞。

剩余问题
  本轮没有把 raw FrameOS 输出或 test.docx 内容写入仓库。
  场景/道具新增 FrameOS 字段目前主要进入 prompt 输出契约；现有持久化仍以 summary、description、available_slots 兼容落库。
  完整的 FrameOS voice match/audition/select 流程仍需后续接入任务和 UI。
```

2026-06-14 FrameOS schema canary 追加记录：

```text
本轮目的
  把真实 TEST 项目里观察到的剧本解析、art direction、资产设定和音色映射结构固化为小样本回归 canary。
  目标是防止后续 prompt 或 schema 调整把 FrameOS 式字段退回到 Nori 旧字段，尤其是 episodes-list、worlds、character/item/environment/voice_mapping 的结构。

影响链路
  standards/prompt-canary/frameos_screenwriter.canary.json:
    新增人工构造的 Ari/Mika/Workshop 样例。
    覆盖 screenwriter 顶层 status、steps、default_visual_style、script_kilo、adapted_kilo、items。
    覆盖 episode item 的 source_anchor、reasoning、scenes。
    覆盖 scene 的 scene_id、heading、int_ext、content_kilo、characters、visual_style_confirmed。
    内嵌 art_direction，覆盖 flow_status、flow_id、current_label、derived_phase、default_world_label、worlds。
    worlds 覆盖 world_label、world_background、representative_frame、candidates、selected_style_anchor、preview_materials。

  standards/prompt-canary/frameos_assets.canary.json:
    新增人工构造的角色、道具、环境、音色映射样例。
    character 覆盖 role_type、description、background、identity_lock、coverage_scenes、coverage_episodes、speech_rate、prompt、voice_audition_prompt、audition_status、variants、design_image。
    item 覆盖 item_type、background、significance、coverage_scenes、coverage_episodes、prompt、variants、design_image。
    environment 覆盖 int_ext、description、background、entrance、mood、base_ambience、coverage_scenes、coverage_episodes、prompt、variants、design_image。
    voice_mapping 覆盖 voice_profile.gender、voice_profile.age_range、voice_profile.traits、voice_source、candidates.rank、voice_id、voice_name、reason、is_selected、reference_audio_id。

  scripts/guards/prompt-json-canary-guard.mjs:
    新增 frameosScreenwriter 与 frameosAssets 两个 fixture。
    新增结构校验函数，明确字段存在性和基础类型。
    该 guard 仍只做 schema canary，不做生产规则检查，不读取 test.docx，不读取 .runtime 原始响应。

样例输入输出
  样例内容为 Ari、Mika、workshop_day、brass calibration key、Clear Young Adult 等人工通用短句。
  未使用 FrameOS TEST 原始正文，未使用 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  该 canary 验证结构形状，不验证真实 LLM 输出与 FrameOS 文本内容的一致性。
  voice_mapping 仍是结构基线；完整音色匹配、试听、选择和素材落库流程仍需后续接入。
```

2026-06-14 FrameOS voice mapping prompt 追加记录：

```text
本轮目的
  补齐 FrameOS 资产设定中的角色音色映射提示词能力。
  TEST 项目真实 voice-list 输出包含 status、voice_mapping、auditions；voice_mapping 内含 character、character_id、role_type、voice_profile、voice_source、voice_raw_file、candidates。
  Nori 之前已有 voice_analysis 台词匹配模板和外部 voice design 接口，但缺少独立的“角色 -> 候选音色”结构化映射 prompt。

影响链路
  prompt catalog:
    新增 NP_VOICE_MAPPING / novel-promotion/voice_mapping 双语模板。
    输入为 characters_json、dialogue_samples_json、voice_library_json。

  voice_mapping prompt:
    输出 status、voice_mapping、auditions。
    voice_profile 包含 gender、age_range、traits。
    candidates 包含 rank、voice_id、voice_name、reason、is_selected、reference_audio_id。
    当音色库没有可用 voice_id 时，不编造音色 id，voice_source 输出 unmatched，candidates 输出空数组。
    auditions 在没有真实试听音频时输出空数组，不编造 reference_audio_id 或试听结果。

  regression:
    prompt semantic guard 将 voice_mapping 的关键字段纳入 token 检查。
    prompt-json-canary guard 将 voice_mapping 模板纳入双语模板 token 检查。
    新增 tests/unit/prompt-i18n/voice-mapping-template.test.ts，验证模板注册、关键 schema token 和变量渲染。

样例输入输出
  样例使用人工构造的 Ari、Clear Young Adult、We can finish this before sunset。
  未使用 FrameOS TEST 原始正文，未使用 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/prompt-i18n/voice-mapping-template.test.ts 未执行到测试体，仍被本机 Rollup optional native 包 @rollup/rollup-darwin-arm64 的 Team ID 签名/ERR_DLOPEN_FAILED 问题阻塞。

剩余问题
  本轮只接入 prompt catalog 和回归，不接 UI/任务调度/音色库查询。
 真正的 voice match/audition/select/save 仍需后续把 voice_mapping 输出接入现有 VoiceSettings、GlobalVoice 和 provider voice binding 流程。
```

2026-06-14 FrameOS storyboard production contract 追加记录：

```text
本轮目的
  对齐 FrameOS TEST 工作台中“分镜设计 / 制作剪辑”阶段需要消费的分镜结构。
  真实 runtime crawl 显示分镜设计按片段切分、场景分析、镜头编排、结果质检推进；制作台会继续消费角色、物品、环境、参考音频和视频提示词。
  本轮只把结构契约反推到 Nori 的分镜提示词、schema canary、guard 和现有 imagePrompt 持久化，不新增数据库迁移、不做前端复刻、不加入生产规则检查。

影响链路
  storyboard panel canary:
    standards/prompt-canary/storyboard_panels.canary.json 从旧的 panel_number/description/source_text/video_prompt 样例升级为 FrameOS 式生产对象。
    新增 panel_id、props、visual_style、visual_style_description、source_anchor、referenced_assets、image_prompt、visual_prompt、continuity_notes、voice_refs、duration。
    referenced_assets 镜像 characters/location/props，用于后续缺失资产检查和生产参考图绑定。

  storyboard prompts:
    agent_storyboard_plan.zh/en 要求初始分镜输出同构生产对象，包含源文本锚点、资产引用包、静帧提示词、视频提示词、声音引用和连续性说明。
    agent_storyboard_detail.zh/en 要求细化阶段保留或补齐 panel_id、source_anchor、referenced_assets、image_prompt、visual_prompt、continuity_notes、voice_refs。
    agent_storyboard_insert.zh/en 要求插入镜头和普通生成镜头同构，避免局部插入后丢失 props、visual_style、source_anchor、referenced_assets、duration。
    agent_cinematographer.zh/en 明确 referenced_assets、image_prompt、visual_prompt、video_prompt 是生产资产契约；摄影规则只能补光线、构图、景深和空间连续，不得改写资产名或添加未引用资产。

  runtime compatibility:
    StoryboardPanel 类型新增上述可选字段，保持 JsonRecord 扩展兼容。
    空响应 fallback 和短剧转绘 fallback 会生成同构字段，避免兜底路径退回旧结构。
    持久化将 panel.image_prompt 或 panel.visual_prompt 写入现有 NovelPromotionPanel.imagePrompt 字段；不新增列、不迁移数据。

  regression:
    prompt-json-canary guard 校验 storyboard panel 新字段的存在性和基础类型。
    prompt semantic regression 将 plan/detail/insert 的关键字段纳入英文模板 token 回归。
    prompt-json-canary 的双语模板 token 检查同步覆盖新增字段。

样例输入输出
  样例使用 Lena、Victor、grand_hall_night、sealed_letter 等人工通用短句。
  未把 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容写入仓库、测试或 prompt。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。

剩余问题
  本轮没有把完整 FrameOS shot/director 数据模型迁移进数据库；episode_id、scene_id、shot_id、director_status、cost_json 等仍停留在反向工程文档和后续模型设计范围。
  referenced_assets 目前主要由提示词输出和现有 Seedance reference asset 逻辑消费；前端展示、人工确认和缺失资产 UI 仍需后续接入。
  voice_refs 目前是分镜生产契约字段；真正的 voice line/lip-sync 绑定仍依赖后续 voice_mapping、voice_analysis 和制作阶段任务整合。
```

2026-06-14 FrameOS redraw prompt contract 追加记录：

```text
本轮目的
  衔接上一轮分镜生产契约，补齐“重绘改写 / 镜头提示词修改”链路。
  旧 image_prompt_modify 只输入当前图片/视频提示词和用户指令，只输出 image_prompt/video_prompt；在 FrameOS 式工作流里会丢失 visual_prompt、referenced_assets、source_text/anchor 和 continuity_notes。
  本轮让重绘改写阶段在不生成新剧情、不新增生产规则检查的前提下，保留同一批角色、场景、道具和镜头连续性。

影响链路
  prompt catalog:
    NP_IMAGE_PROMPT_MODIFY 的变量从 prompt_input、video_prompt_input、user_input 扩展为 prompt_input、video_prompt_input、panel_context_json、referenced_assets_json、user_input。

  image_prompt_modify prompt:
    双语模板新增当前分镜上下文和引用资产 JSON 输入。
    输出从 image_prompt/video_prompt 扩展为 image_prompt、visual_prompt、video_prompt、referenced_assets、continuity_notes、change_summary。
    模板明确 image_prompt/visual_prompt 是静帧提示词，video_prompt 是动态提示词；三者必须引用同一批可见资产、同一地点和同一动作状态。
    referenced_assets 被定义为生产资产契约，除非用户明确替换、删除或新增资产，否则不改名、不丢弃、不新增。

  worker:
    shot-ai-prompt-shot 会把 panel_id、source_text、source_anchor、currentVisualPrompt、continuityNotes、referencedAssets 打包成 panel_context_json。
    referencedAssets 也会作为 referenced_assets_json 单独传给模板。
    解析模型输出时保留 visual_prompt、referenced_assets、continuity_notes、change_summary；旧 prompt 字段输出仍兼容回退到 imagePrompt。

  typing/regression:
    storyboard prompt mutation 与 prompt-stage 修改结果类型新增 modifiedVisualPrompt、continuityNotes、changeSummary，并允许 prop 资产引用类型。
    prompt semantic regression 将 visual_prompt、referenced_assets、continuity_notes、change_summary 纳入 image_prompt_modify 关键 token。
    prompt-json-canary 双语模板 token 检查覆盖 panel_context_json、referenced_assets_json 和新增输出字段。
    新增 tests/unit/prompt-i18n/image-prompt-modify-template.test.ts，使用 Ari/workshop_day/brass_key 等人工样例验证模板注册和变量渲染。
    tests/unit/worker/shot-ai-prompt-shot.test.ts 更新为验证 worker 会传入 panel_context_json/referenced_assets_json，并解析 visual_prompt、referenced_assets、continuity_notes、change_summary。

样例输入输出
  样例使用 Ari、workshop_day、brass_key、Hero/Hall 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/prompt-i18n/image-prompt-modify-template.test.ts tests/unit/worker/shot-ai-prompt-shot.test.ts 未执行到测试体，仍被本机 Rollup optional native 包 @rollup/rollup-darwin-arm64 的 Team ID 签名/ERR_DLOPEN_FAILED 问题阻塞。

剩余问题
  本轮只强化 prompt contract 和 worker 解析，不接 UI 展示 visual_prompt/continuity_notes/change_summary。
  当前 prompt-stage UI 仍主要更新 imagePrompt；后续若要完整 FrameOS 化，可把 visual_prompt 和 change_summary 暴露给镜头详情或导出前检查。
  referenced_assets 的人工确认、缺失资产补齐 UI、以及与制作阶段参考图配额的深度绑定仍待后续接入。
```

2026-06-14 FrameOS export preflight traceability 追加记录：

```text
本轮目的
  衔接分镜生产契约与重绘改写契约，强化导出前检查对 FrameOS 式追踪字段的理解。
  旧 export_preflight_review 只泛化检查 image_prompt/description/video_prompt、characters/location/props 和媒体 URL；没有明确把 visual_prompt、referenced_assets、source_anchor、voice_refs、continuity_notes、coverage_scenes 等作为导出前追踪证据。
  本轮不新增生产规则检查、不改 UI、不迁移数据库；只更新质检 prompt、guard token 和小样本回归。

影响链路
  export_preflight_review prompt:
    双语模板新增静帧提示词兼容说明：image_prompt、visual_prompt、imagePrompt 都可作为静帧提示词证据。
    新增 referenced_assets / referenced_assets_json / characters / location / props 的引用契约说明，用于判断角色、场景、道具是否可被制作人员追踪。
    新增 voice_refs、matchedPanel、voice_line_ids 和已匹配台词字段作为音色/配音追踪证据。
    新增 continuity_notes、source_anchor、source_text 和 panel 原文片段字段作为剧情连续性与原文追踪证据。
    工作流检查面从 6 项扩展到 7 项，新增导出清单保真：panel 行是否保留原文片段、静帧提示词证据、视频提示词证据、媒体 URL、duration 和可追踪资产引用。

  regression:
    tests/unit/prompt-i18n/export-preflight-review-template.test.ts 的人工样例新增 source_anchor、reasoning、visual_style、image_prompt、visual_prompt、referenced_assets、props、continuity_notes、voice_refs。
    prompt semantic regression 将 export_preflight_review 的 status/readiness/issues/deliverables/next_actions 与 source_anchor、referenced_assets、visual_prompt、imagePrompt、continuity_notes、voice_refs、coverage_scenes、coverage_episodes、missing_*、duration_risk、voice_gap、continuity_gap、manifest_gap 纳入关键 token。
    prompt-json-canary guard 的双语模板 token 检查同步覆盖 export_preflight_review。

样例输入输出
  样例使用 Ari、Workshop、brass_key、panel-1、voice-1 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/prompt-i18n/export-preflight-review-template.test.ts 未执行到测试体，仍被本机 Rollup optional native 包 @rollup/rollup-darwin-arm64 的 Team ID 签名/ERR_DLOPEN_FAILED 问题阻塞。

剩余问题
  本轮没有修改 /api/novel-promotion/:projectId/export-manifest；当前 manifest 仍主要输出数据库已有的 imagePrompt/videoPrompt/media 字段。
  visual_prompt 目前通过 prompt 契约与 imagePrompt 兼容理解，尚无独立数据库列或 UI 展示。
  referenced_assets、voice_refs、continuity_notes 若未落库，导出前检查只能从传入 storyboard_json/voice_json 中判断；完整导出清单保真仍需要后续把这些字段贯通到 manifest 或面板详情。
```

2026-06-14 FrameOS panel image and variant prompt 追加记录：

```text
本轮目的
  衔接分镜生产契约、重绘改写契约和导出前检查契约，强化单帧生图与镜头变体图生成阶段。
  旧 single_panel_image 虽然会读取角色、场景、道具和 source_text，但没有显式说明 referenced_assets、visual_prompt、source_anchor、continuity_notes、voice_refs、visual_style 的优先级。
  旧 agent_shot_variant_generate 把 fixed slots / available slots 作为硬限制，容易和前面已对齐的 FrameOS 分镜逻辑冲突。
  本轮不改 UI，不改数据库，不新增生产规则检查；只更新 prompt、panel image 上下文 JSON 和小样本回归。

影响链路
  single_panel_image prompt:
    双语模板新增 referenced_assets 作为生产引用契约，要求角色、场景、道具不能新增、删除、改名或替换。
    明确 image_prompt 与 visual_prompt 是静帧提示词证据，video_prompt 只用于动作和镜头逻辑参考，最终只生成单张静帧。
    新增 source_text/source_anchor 作为剧情和原文追踪证据。
    新增 continuity_notes 用于保持角色外观、道具状态和动作承接，但不得新增剧情事件。
    新增 voice_refs 只用于判断谁在说话或反应，禁止生成字幕或台词文字。
    新增 visual_style / visual_style_description 作为风格、光线、色调、质感、构图参考。

  panel-image worker context:
    buildPanelPromptContext 在 panel JSON 中补 visual_prompt，当前兼容映射到已有 imagePrompt。
    buildPanelPromptContext 新增 referenced_assets，镜像 characters、location、props，供单帧生图 prompt 使用。
    不新增数据库列，不改变图片生成任务输入接口。

  agent_shot_variant_generate prompt:
    双语模板将 fixed slots / available slots 从硬边界改为连续性锚点。
    对移动、入口/出口、路径空间、过渡区域、临时位置、前后景变化或非写实镜头，允许按镜头逻辑偏离静态站位，但不能破坏角色关系和场景连续性。
    模板明确图像生成提示词中若包含 image_prompt、visual_prompt、video_prompt、referenced_assets、source_text、source_anchor、continuity_notes、voice_refs、visual_style、visual_style_description，应视为生产证据。
    仍要求单张图输出，禁止字幕、标签、编号、水印、符号或多格拼图。

  regression:
    prompt semantic regression 将 single_panel_image 与 agent_shot_variant_generate 的 FrameOS 追踪字段纳入关键 token。
    prompt-json-canary guard 的双语模板 token 检查同步覆盖这两个模板。
    新增 tests/unit/prompt-i18n/single-panel-image-template.test.ts，使用 Ari/workshop_day/brass_key 人工样例验证模板注册和变量渲染。
    新增 tests/unit/prompt-i18n/shot-variant-generate-template.test.ts，验证变体图提示词能承载 image_prompt、visual_prompt、referenced_assets、source_anchor、continuity_notes、voice_refs、visual_style。
    tests/unit/worker/panel-image-task-handler.test.ts 增加 panel prompt context 中 visual_prompt 和 referenced_assets 的断言。

样例输入输出
  样例使用 Ari、workshop_day、brass_key、Hero、Old Town 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/prompt-i18n/single-panel-image-template.test.ts tests/unit/prompt-i18n/shot-variant-generate-template.test.ts tests/unit/worker/panel-image-task-handler.test.ts 未执行到测试体，仍被本机 Rollup optional native 包 @rollup/rollup-darwin-arm64 的 Team ID 签名/ERR_DLOPEN_FAILED 问题阻塞。

剩余问题
  visual_prompt 仍通过 imagePrompt 兼容映射进入单帧生图上下文，尚无独立字段持久化。
  panel variant worker 仍主要通过现有 video_prompt 变量承载生产证据；后续若要更完整，可为变体任务新增 panel_context_json / referenced_assets_json，但会扩大调用面。
 单帧生图和变体图只完成 prompt contract 对齐；参考图配额、缺失资产确认和导出 manifest 保真仍需后续继续贯通。
```

2026-06-14 FrameOS acting voice/lip-sync contract 追加记录：

```text
本轮目的
  衔接 FrameOS 分镜生产字段、voice_refs 与当前 NoriVideo 的演技指导阶段。
  现有 agent_acting_direction 输出结构被前端 AIDataModal 稳定当作 name + acting 编辑和保存；如果新增 dialogue_state、lip_sync_required 等字段，会出现编辑态类型与底层 JSON 容忍能力不一致。
  本轮因此不扩展 actingNotes 持久结构，不改 UI，不改数据库；只把 voice_refs、source_anchor、referenced_assets、video_prompt、continuity_notes 等 FrameOS 生产上下文压入 acting 文本指令。

影响链路
  agent_acting_direction prompt:
    双语模板新增 FrameOS panel context contract。
    明确读取 source_text/source_anchor 作为本镜头剧情锚点，避免表演指令扩写无关事件。
    明确读取 referenced_assets 与 continuity_notes，用于保持角色身份、服装、道具接触、场景关系和前后动作承接。
    明确读取 video_prompt，用于对齐镜头运动、可见动作和节奏。
    明确读取 voice_refs 并推断 dialogue_state：speaking、listening/reacting、silent/neutral。
    对 speaking 角色要求 acting 句子包含 lip_sync 准备：口型可读、面部无遮挡、呼吸停顿、嘴唇/下颌运动等。
    对 listening/reacting 角色要求 acting 句子包含可见反应：视线偏移、屏息、眨眼、肩颈收紧、手部动作等。
    保持输出 JSON 结构不变：每个角色仍只有 name 和 acting 两个字段，生产字段必须写进 acting 句子而不是新增 JSON key。
    明确禁止字幕、对白框、屏幕文字或标题字。

  regression:
    prompt-json-canary guard 新增 agent_acting_direction 双语模板 token 检查：panel_number、characters、name、acting、source_text、source_anchor、referenced_assets、video_prompt、continuity_notes、voice_refs、dialogue_state、lip_sync。
    prompt semantic regression 同步将这些字段纳入英文模板关键 token。
    新增 tests/unit/prompt-i18n/acting-direction-template.test.ts，验证模板注册、FrameOS voice/continuity 契约字段，以及 panels_json/panel_count/characters_info 的变量渲染。

样例输入输出
  样例使用 Ari、Mina、workshop_day、brass_key、panel-1 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npx vitest run tests/unit/prompt-i18n/acting-direction-template.test.ts 未执行到测试体，仍被本机 Rollup optional native 包 @rollup/rollup-darwin-arm64 的 Team ID 签名/ERR_DLOPEN_FAILED 问题阻塞。
  npx vitest run tests/unit/prompt-i18n/acting-direction-template.test.ts --runInBand 因当前 Vitest CLI 不支持 --runInBand 参数被拒绝；已用无该参数命令复测，确认实际阻塞点是 Rollup 原生包加载。

剩余问题
  actingNotes UI 仍只展示和编辑 acting 文本；dialogue_state 与 lip_sync 不是独立字段，后续若要做口型校验面板或配音生产看板，需要设计新的可编辑结构。
  voice_analysis 已能把台词匹配到 storyboard panel，但 voice_refs 的完整落库与导出 manifest 保真仍依赖前面分镜生产字段能持续传递。
  本轮只强化表演提示词，不处理真实配音试听、参考音频上传、音色候选选择或口型生成器调用。
```

2026-06-14 FrameOS episode and clip parsing contract 追加记录：

```text
本轮目的
  回到剧本解析入口，补齐 episode_split 与 agent_clip 相对 FrameOS TEST 输出结构的早期追踪字段。
  旧 episode_split 只服务本地边界匹配，输出 number/title/summary/startMarker/endMarker/validation；缺少 FrameOS 式 episode_id、content_kilo、source_anchor、info_points、reasoning、status、scenes 等生产元数据。
  旧 story_to_script_clips canary 只覆盖 start/end/summary/location/characters，而 agent_clip 模板已经要求 source_anchor、info_points、reasoning、props；回归样例太弱，无法防止剧本解析入口退化。
  本轮不改数据库、不改 worker 边界匹配逻辑、不写生产规则检查；只增强 prompt 输出契约、canary fixture、模板 token 守卫和小样本模板测试。

影响链路
  episode_split prompt:
    双语模板保留现有 analysis、episodes、startMarker、endMarker、validation 字段，确保 handleEpisodeSplitTask 仍能用 startMarker/endMarker 做本地原文边界匹配。
    episodes[] 新增 FrameOS 式生产元数据：episode_id、episode_number、content_kilo、source_anchor、info_points、reasoning、status、scenes。
    source_anchor.start/end 必须来自原文并与 startMarker/endMarker 对齐。
    info_points 只记录原文支持的剧情、角色、场景、道具、冲突、转场事实。
    reasoning 只写给制作人员看的 diagnosis/key_decisions，不输出隐藏推理链。
    scenes 是场次大纲，不是完整剧本；只在原文支持时给 scene_number、heading、summary、characters、visual_style。
    不要求 LLM 复制完整 episode content，避免长文本重复和 token 膨胀；真实正文仍由 worker 用边界本地截取。

  agent_clip prompt/canary:
    story_to_script_clips.canary.json 更新为人工样例，补齐 source_anchor、info_points、reasoning.adaptation_decision、reasoning.production_function、reasoning.self_review、props。
    prompt-json-canary guard 对 clip fixture 增加这些字段的结构校验。
    prompt-json-canary guard 对 agent_clip 和 episode_split 双语模板增加 FrameOS 追踪字段 token 检查。
    prompt semantic regression 对英文 agent_clip 和 episode_split 增加关键 token，防止模板后续删除这些生产字段。
    新增 tests/unit/prompt-i18n/agent-clip-template.test.ts 与 tests/unit/prompt-i18n/episode-split-template.test.ts，验证模板注册和变量渲染。

样例输入输出
  样例使用 Ari、Mina、workshop_day、brass_key、Lena、Victor、town_square_day、old_alley_evening 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  npx vitest run tests/unit/prompt-i18n/agent-clip-template.test.ts tests/unit/prompt-i18n/episode-split-template.test.ts 未执行到测试体，仍被本机 Rollup optional native 包 @rollup/rollup-darwin-arm64 的 Team ID 签名/ERR_DLOPEN_FAILED 问题阻塞。

剩余问题
  episode_split worker 当前仍只持久化本地截取出的 episode content、number/title/summary/wordCount；新增 FrameOS 元数据尚未落库或进入导出 manifest。
  standalone clips-build worker 仍只持久化 start/end/summary/location/characters/props/content；source_anchor、info_points、reasoning 目前主要在 story-to-script orchestrator 内继续传给 screenplay metadata。
  后续若要完整贴近 FrameOS TEST 的项目工作台，需要设计 episode/clip metadata 的持久化和展示，但这会超出本轮 prompt/template 范围。
```

2026-06-14 FrameOS character visual asset contract 追加记录：

```text
本轮目的
  衔接角色资产抽取与角色视觉出图描述，补齐 agent_character_visual 对 FrameOS 资产设定字段的承接。
  角色抽取阶段已经输出 identity_lock、prompt、variants、coverage_scenes、coverage_episodes、voice_trait、representative_line、voice_audition_prompt、design_image 等字段；旧视觉提示词主要依赖 expected_appearances 和基础角色档案，没有明确要求使用 identity_lock 与 variants[].prompt。
  本轮不改 UI、不改数据库、不改变 characterAppearance 持久结构；只强化角色视觉 prompt、模板 token 守卫和小样本回归。

影响链路
  agent_character_visual prompt:
    双语模板新增 identity_lock 最高优先级说明：主形象三条 descriptions 都必须包含所有可视觉表达的 identity_lock 锁定项。
    明确 variants 是 FrameOS 式持续资产变体，读取 variants[].variant_id、variants[].variant_type、variants[].prompt 作为生产规划元数据。
    明确 variants[].prompt 用作对应子形象的生产参考，同时必须保持同一 identity_lock，避免同一角色被写成不同人。
    明确 prompt 是角色主图基础提示词，用于稳定年龄段、固定外观、服装、配饰、主体气质和一致性约束。
    明确 coverage_scenes、coverage_episodes、role_type、description、background 只作为生产规划上下文，不得写入 descriptions。
    明确 voice_trait、representative_line、voice_audition_prompt 只能辅助判断头像年龄感或主体气质，不得输出说话、音频、台词、口型或表演指令。
    明确 design_image、variants[].design_image、material_id、图片 URL、确认状态是资产状态字段，不得在视觉输出中编造。

  regression:
    prompt-json-canary guard 对 agent_character_visual 增加双语模板 token 检查：identity_lock、expected_appearances、coverage_scenes、coverage_episodes、variants、variant_id、variant_type、prompt、design_image、voice_trait、representative_line、voice_audition_prompt、appearances、change_reason、descriptions。
    prompt semantic regression 对英文 agent_character_visual 增加同组关键 token。
    新增 tests/unit/prompt-i18n/character-visual-template.test.ts，使用 Ari/workshop_day/brass_key 等人工样例验证模板注册与变量渲染。

样例输入输出
  样例使用 Ari、workshop_day、alley_rain、brass goggles、green work coat 等人工通用资产字段。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。
  npx vitest run tests/unit/prompt-i18n/character-visual-template.test.ts 通过，2 tests passed。
  git diff --check 通过。

剩余问题
  characterAppearance 仍只保存 changeReason、description、descriptions 和 imageUrls；variants[].variant_id、variant_type、coverage_* 与 design_image 状态没有独立贯通到该表。
角色视觉输出仍是 descriptions 文本，不生成或选择真实参考图；真实 design_image 生产、确认状态和素材 ID 仍由后续资产图生成/资产库流程承担。
  voice_trait 只作为头像气质辅助，不等于音色绑定；音色候选、试听和配音文件仍由 voice_mapping/voice_analysis 相关链路继续处理。
```

2026-06-14 FrameOS manual asset create/modify contract 追加记录：

```text
本轮目的
  衔接 FrameOS TEST 的资产设定输出和 NoriVideo 的手动创建/修改资产入口。
  现有 character_create、character_modify、location_create、location_modify、location_description_update、prop_description_update 消费端只解析 prompt，场景额外解析 available_slots。
  因此本轮不扩大 JSON 输出形状，避免破坏 worker/UI；只把 FrameOS 资产字段的生产含义写进 prompt 内容约束和回归守卫。

影响链路
  character_create / character_modify:
    保持输出 { prompt }。
    要求 prompt 可作为角色主资产 identity_lock 基础，固定脸型、五官、发型、体型、服装、鞋子、配饰和独特标记。
    要求内容能跨 coverage_scenes、coverage_episodes 和 variants 复用。
    修改服装或造型时，只输出一条完整 variant-ready prompt，同时保持同一角色身份。
    禁止编造 design_image、素材 ID、图片 URL、确认状态、音频文件、台词或剧情背景。

  location_create / location_modify / location_description_update:
    保持输出 { prompt, available_slots }。
    要求 prompt 内部承载 summary、description、background、entrance、mood、base_ambience 的生产含义，但不新增 JSON 字段。
    要求场景像 environments 的 default variants 背景底图一样稳定，可被 coverage_scenes、coverage_episodes 复用。
    要求明确入口、可通行区域、前中后景、固定锚点和 available_slots。
    禁止编造 environment_id、design_image、素材 ID、图片 URL、确认状态、角色动作或剧情事件。

  prop_description_update:
    保持输出 { prompt }。
    要求 prompt 保持同一道具资产身份，并能被 coverage_scenes、coverage_episodes 和 variants 稳定复用。
    要求通过视觉描述体现 item_type，保留基础结构、材质、颜色、表面处理、装饰细节和数量关系。
    禁止编造 item_id、design_image、素材 ID、图片 URL、确认状态、角色、使用动作或剧情 significance。

  regression:
    prompt-json-canary guard 新增上述六类手动资产模板的双语 token 检查。
    prompt semantic regression 新增上述英文模板的关键 token 检查。
    新增 tests/unit/prompt-i18n/manual-asset-template.test.ts，覆盖角色创建/修改、场景创建/修改/描述更新、道具描述更新的模板注册与变量渲染。

样例输入输出
  样例只使用 Ari、workshop_day、brass_key、repair workshop 等人工通用资产短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx vitest run tests/unit/prompt-i18n/manual-asset-template.test.ts 通过，4 tests passed。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  手动资产入口仍只持久化 prompt 和场景 available_slots；identity_lock、coverage_scenes、coverage_episodes、variants、design_image 等字段没有在该入口独立结构化落库。
  prop 目前只有描述更新模板，没有独立 prop_create 模板；新道具的完整 FrameOS item_id/item_type/significance/variants 结构仍主要依赖 select_prop 抽取链路。
  场景 mood/base_ambience 目前是通过 prompt 文字隐式承载，后续若要做资产表格编辑或导出 manifest，需要补独立字段。
```

2026-06-14 FrameOS asset image sync and variant regeneration contract 追加记录：

```text
本轮目的
  衔接资产图片修改后的描述同步，以及角色/场景描述变体再生成入口。
  character_description_update 由项目资产和全局资产的改图同步链路调用，输出仍只解析 prompt。
  character_regenerate 输出 descriptions，location_regenerate 输出 descriptions 和 available_slots；它们在 prompt catalog 中仍是正式资产提示词入口。
  本轮不改 UI、不改数据库、不新增生产规则检查；只强化 prompt 资产契约、模板 token 守卫和小样本模板回归。

影响链路
  character_description_update:
    保持输出 { prompt }。
    要求参考图或修改指令改变服装/造型时，只输出一条完整 variant-ready prompt。
    要求保留 identity_lock，除非用户明确修改身份锁定特征。
    要求更新后的 prompt 可跨 coverage_scenes、coverage_episodes 和 variants 复用。
    禁止编造 design_image、素材 ID、图片 URL、确认状态、音频文件、台词或剧情背景。

  character_regenerate:
    保持输出 { descriptions }。
    将三条 descriptions 定义为同一角色的候选 variants，而不是三名不同角色。
    三条 descriptions 必须继承同一 identity_lock，只围绕持续服装、年龄状态、伪装或形态变化做差异。
    novel_text 只用于判断 coverage_scenes、coverage_episodes 中是否需要该子形象，不把场次编号、分集编号或剧情说明写入 descriptions。
    禁止编造 design_image、素材 ID、图片 URL、确认状态、音频文件、台词或剧情背景。

  location_regenerate:
    保持输出 { descriptions, available_slots }。
    将三条 descriptions 定义为同一 environment_id 的候选环境 variants。
    三条 descriptions 必须保持同一场景身份、入口逻辑、基础布局和可复用锚点。
    每条 description 通过具体视觉描述承载 summary、description、background、entrance、mood、base_ambience，但不新增 JSON 字段。
    available_slots 必须在三条 descriptions 中都成立，确保后续分镜落位可以复用。
    禁止编造 design_image、素材 ID、图片 URL、确认状态、具名角色或剧情事件。

  regression:
    prompt-json-canary guard 新增 character_description_update、character_regenerate、location_regenerate 双语 token 检查。
    prompt semantic regression 新增上述英文模板的关键 token 检查。
    扩展 tests/unit/prompt-i18n/manual-asset-template.test.ts，覆盖角色描述更新、角色变体再生成、场景变体再生成的模板注册与变量渲染。

样例输入输出
  样例继续使用 Ari、workshop_day、brass_key、repair workshop、rain disguise 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx vitest run tests/unit/prompt-i18n/manual-asset-template.test.ts 通过，4 tests passed。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  character_regenerate 和 location_regenerate 在当前 worker 搜索中未发现直接调用点，可能是旧入口、配置面板或前端待接入口；本轮只保证其作为 catalog 模板不会偏离 FrameOS 资产契约。
  图片修改链路仍只把更新后的 prompt 写回 description/descriptions，未将 identity_lock、coverage_*、variants、design_image 状态拆成独立字段。
  location_regenerate 的 mood/base_ambience 仍是隐式文本约束，后续如果要导出 FrameOS 式资产 manifest，需要补结构化持久字段。
```

2026-06-14 FrameOS shot variant analysis contract 追加记录：

```text
本轮目的
  补齐镜头变体分析入口，使其不再只基于当前图片和简短镜头描述给创意建议，而是读取 FrameOS 式分镜生产上下文。
  该入口服务镜头变体推荐和后续变体图生成，直接影响分镜、镜头提示词、视频提示词、资产引用一致性和口型/配音准备。
  本轮保持 UI 兼容，不改变建议输出字段 id/title/description/shot_type/camera_move/video_prompt/creative_score。

影响链路
  agent_shot_variant_analysis prompt:
    新增 panel_context_json 输入，占位变量已登记到 prompt catalog。
    要求读取 source_text 和 source_anchor 作为剧情证据，变体只能改变镜头表达，不能添加新剧情事件。
    要求读取 referenced_assets、image_prompt、visual_prompt、video_prompt 作为资产和镜头证据，不得新增、删除、改名或替换已引用角色、场景、道具。
    要求读取 continuity_notes，保持空间方向、手持道具状态、视线关系、出入场逻辑和相邻镜头承接。
    要求读取 voice_refs；含台词镜头至少一个变体保留口型同步准备，说话者脸部清晰，其他脸弱化或虚化。
    要求读取 visual_style 和 visual_style_description，除非只在既有风格内调整光线，否则不改变美术方向。
    description 必须说明变体改变了什么，以及为何仍保持 source_anchor、referenced_assets 和 continuity_notes。
    video_prompt 必须聚焦运动，包含主体、动作、目标运镜，以及维持连续性所需的道具或场景锚点。

  shot-ai-variants worker:
    查询 panel 时增加 props、srtSegment、imagePrompt、videoPrompt、sceneType、duration、photographyRules、actingNotes。
    构建 panel_context_json，并传给 NP_AGENT_SHOT_VARIANT_ANALYSIS。
    referenced_assets.characters 改为结构化角色引用数组，保留 name、appearance、slot。
    referenced_assets.props 改为结构化道具名称数组，而不是原始 JSON 字符串。
    source_anchor 当前由 srtSegment 构造 start/end；这是现有持久结构下的保守近似，后续若 panel 独立持久 source_anchor，应改为直接读取。

  regression:
    prompt-json-canary guard 新增 agent_shot_variant_analysis 双语 token 检查：panel_context_json、source_text、source_anchor、referenced_assets、image_prompt、visual_prompt、video_prompt、continuity_notes、voice_refs、visual_style、visual_style_description、shot_type、camera_move、creative_score。
    prompt semantic regression 同步覆盖英文模板关键 token。
    新增 tests/unit/prompt-i18n/shot-variant-analysis-template.test.ts，验证模板注册与 panel_context_json 渲染。
    更新 tests/unit/worker/shot-ai-variants.test.ts，验证 worker 传入 source_text、referenced_assets 和 continuity_notes。

样例输入输出
  样例使用 Ari、Hero、workshop_day、Old Town、brass_key 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx vitest run tests/unit/prompt-i18n/shot-variant-analysis-template.test.ts tests/unit/worker/shot-ai-variants.test.ts 通过，8 tests passed。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  NovelPromotionPanel 当前没有独立 source_anchor、referenced_assets、visual_prompt、continuity_notes、voice_refs 字段；本轮从 srtSegment、characters、location、props、imagePrompt、videoPrompt、photographyRules、actingNotes 组装近似上下文。
  worker 单测中 LLM mock 仍会触发既有无效响应日志，但测试通过；这是旧 mock 与 executeAiVisionStep 内部适配的噪声，不影响本轮契约验证。
  若要 1:1 贴近 FrameOS TEST，还需要在分镜持久结构中独立贯通 source_anchor、referenced_assets、visual_prompt、continuity_notes 和 voice_refs。
```

2026-06-14 FrameOS parse-ready story expansion contract 追加记录：

```text
本轮目的
  补齐 AI 故事扩写入口，使其输出的纯故事正文天然适合后续 FrameOS 式剧本解析、资产抽取、分镜拆解、配音匹配和导出前检查。
  该入口仍返回 expandedText 普通文本，不新增 JSON，不改接口和持久化。
  本轮不引入生产规则检查，只强化 prompt 契约、token 守卫和模板回归。

影响链路
  ai_story_expand prompt:
    将输出明确定位为后续 episode_split、screenplay_conversion、asset extraction、storyboard generation、voice_refs 和 export preflight review 的 source_text。
    要求场景转换通过自然段落、地点和时间变化清楚呈现，但不输出元数据标签、JSON、markdown 或标题。
    要求 characters 角色名稳定，涉及说话者、行动者或资产抽取时避免含混代词。
    要求每个重要 location 首次出现时具备可视化空间锚点，如门口、桌边、窗前、走廊、楼梯、车座、柜台、院门等。
    要求只写有生产价值的 props：反复出现、被交接、打开、隐藏、损坏、阅读、穿戴或推动剧情的物件。
    要求对白归属清楚，便于后续 voice_refs 和音色匹配。
    要求关键剧情包含可分镜视觉动作，如进入、转身、揭示、交接、反应、对峙、追逐、发现、停顿、离开。
    禁止在故事正文中输出 JSON、字段名、隐藏推理、工作流解释、制作备注、Agent/Super Agent/自动创作模式，以及 source_anchor、referenced_assets、image_prompt、visual_prompt、video_prompt 等生产字段。

  regression:
    prompt-json-canary guard 新增 ai_story_expand 双语 token 检查：source_text、episode_split、screenplay_conversion、asset extraction、storyboard generation、voice_refs、export preflight review、characters、location、props。
    prompt semantic regression 同步覆盖英文模板关键 token。
    新增 tests/unit/prompt-i18n/ai-story-expand-template.test.ts，验证模板注册和输入渲染。
    复跑 tests/unit/worker/ai-story-expand.test.ts，确认 worker 返回 expandedText 的接口行为不变。

样例输入输出
  样例使用 courier、workshop、brass key、old gate 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx vitest run tests/unit/prompt-i18n/ai-story-expand-template.test.ts tests/unit/worker/ai-story-expand.test.ts 通过，8 tests passed。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  AI 故事扩写仍是纯正文输出，没有结构化 story package；后续 episode_split 和 screenplay_conversion 仍负责正式结构化。
  长篇输入、已有大纲或用户要求特殊格式时，仍可能需要更细的输入类型识别；本轮只约束通用短剧生产友好正文。
  真正 1:1 对标 FrameOS TEST 仍需要用真实项目输出继续采样并比对正文进入剧本解析后的 episode/scene/asset 质量。
```

2026-06-14 FrameOS cinematography rule contract 追加记录：

```text
本轮目的
  衔接 script-to-storyboard 的第二阶段摄影规则生成，使其同时满足生成链路和分镜 AI 数据编辑面板。
  旧英文模板只要求 composition、lighting、color_palette、atmosphere、technical_notes；中文示例和前端 AIDataModal 还期待 scene_summary、characters、depth_of_field、color_tone。
  本轮不改数据库、不改合并逻辑、不新增规则检查；只让双语 prompt 输出契约对齐，并补模板回归守卫。

影响链路
  agent_cinematographer prompt:
    保留生成链路读取的字段：panel_number、composition、lighting、color_palette、atmosphere、technical_notes。
    新增/明确 UI 兼容字段：scene_summary、characters、depth_of_field、color_tone。
    characters 允许空数组；若有角色，name 必须来自分镜契约，screen_position、posture、facing 必须保持 appearance/slot 连续性。
    要求读取 referenced_assets、image_prompt、visual_prompt、video_prompt，摄影规则只能补充光线、构图、景深、空间连续，不得新增、删除、改名或替换资产。
    要求读取 source_text、source_anchor、continuity_notes、voice_refs、visual_style、visual_style_description，用于保持剧情证据、口型同步准备和美术方向。
    对话或口型同步镜头必须使用浅景深或极浅景深，说话者脸部清晰，其他脸弱化或虚化。

  downstream compatibility:
    script-to-storyboard merge 仍只映射 composition、lighting、color_palette、atmosphere、technical_notes 到 photographyPlan，不改变现有持久结构。
    额外字段 scene_summary、characters、depth_of_field、color_tone 作为 JSON 附加字段保留在 LLM 输出和 artifact 中，可供 AI 数据面板或后续结构化扩展读取。

  regression:
    prompt-json-canary guard 新增 agent_cinematographer 双语 token 检查：panel_number、scene_summary、composition、lighting、color_palette、atmosphere、technical_notes、characters、screen_position、posture、facing、depth_of_field、color_tone、referenced_assets、image_prompt、visual_prompt、video_prompt、source_text、source_anchor、continuity_notes、voice_refs、visual_style、visual_style_description。
    prompt semantic regression 同步覆盖英文模板关键 token。
    新增 tests/unit/prompt-i18n/cinematographer-template.test.ts，验证模板注册和变量渲染。

样例输入输出
  样例使用 Ari、workshop_day、brass_key、rear doorway 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx vitest run tests/unit/prompt-i18n/cinematographer-template.test.ts 通过，2 tests passed。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  当前 mergePanelsWithRules 仍只持久化 composition、lighting、colorPalette、atmosphere、technicalNotes；scene_summary、characters、depth_of_field、color_tone 尚未稳定落到 panel.photographyRules 的 UI 结构。
  旧前端 AIDataModal 的 PhotographyRules 类型要求 lighting 为 {direction, quality}，而生成链路里 lighting 仍常是字符串；后续若要彻底统一，需要设计兼容迁移或读取适配。
  本轮只补 prompt 和回归，不处理摄影规则历史数据迁移。
```

2026-06-14 FrameOS storyboard redraw edit contract 追加记录：

```text
本轮目的
  补齐 storyboard_edit 默认模板，使其作为分镜重绘/改图入口时具备 FrameOS 式资产引用和连续性边界。
  当前代码中未发现稳定的专用 worker 调用点，主要通过 prompt catalog 和提示词编辑面板暴露；本轮不改接口、不新增变量，只强化默认模板。
  目标是避免后续接入图像编辑时，重绘只执行用户一句话而丢失角色、场景、道具、口型和前后镜头连续性。

影响链路
  storyboard_edit prompt:
    将原图定义为 FrameOS 分镜生产帧。
    要求保留 referenced_assets 中的角色身份、角色服装、场景布局、道具身份和可见道具状态，除非用户明确修改。
    要求保持 source_text 和 source_anchor 对应的剧情事件，只修改画面表现，不改写剧情。
    要求保持 image_prompt、visual_prompt、video_prompt 的一致性，修改后的静帧仍符合原本动作和镜头逻辑。
    要求保持 continuity_notes 中的空间方向、视线关系、手持道具状态、出入场逻辑、前后景关系和相邻镜头承接。
    要求保持 visual_style 和 visual_style_description 对应的美术方向、光线体系、色调、质感和构图语言。
    如果存在台词或 voice_refs，要求保留口型同步准备：说话者脸部清晰、嘴部无遮挡，必要时弱化其他脸。
    禁止额外发明新的景别、运镜、角色、场景、道具、标题卡、招牌、UI、水印或符号。
    整组分镜编辑时，要求组内资产名称、服装、道具状态、光线方向和画面方向连续。

  regression:
    prompt-json-canary guard 新增 storyboard_edit 双语 token 检查：referenced_assets、source_text、source_anchor、image_prompt、visual_prompt、video_prompt、continuity_notes、voice_refs、visual_style、visual_style_description。
    prompt semantic regression 同步覆盖英文模板关键 token。
    新增 tests/unit/prompt-i18n/storyboard-edit-template.test.ts，验证模板注册和 user_input 渲染。

样例输入输出
  样例使用 Ari、brass key、warmer lighting 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx vitest run tests/unit/prompt-i18n/storyboard-edit-template.test.ts 通过，2 tests passed。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  storyboard_edit 目前只有 user_input 变量，缺少显式 panel_context_json/referenced_assets_json 输入；本轮只能把上下文边界写入模板，真正 1:1 重绘仍需要调用端传入当前分镜上下文和参考资产。
 未发现稳定专用 worker 调用点；后续接入图像编辑任务时，应复用本模板并显式传入 source_text、referenced_assets、continuity_notes 和 voice_refs。
 本轮不处理图像编辑模型选择、参考图收集、候选图保存或撤回。
```

2026-06-14 FrameOS voice analysis panel matching contract 追加记录：

```text
本轮目的
  补齐 voice_analysis 的 FrameOS 分镜语义，使台词抽取不仅按原文顺序匹配镜头，还能读取 source_text、source_anchor、referenced_assets、voice_refs、video_prompt 和 continuity_notes。
  保持现有输出 JSON 结构不变，只输出 lineIndex、speaker、content、emotionStrength、matchedPanel，不新增生产字段。
  目标是让后续配音、dialogue_state 和 lip_sync 更稳定地落在真正说话或旁白所属镜头，而不是误配到听者反应、纯动作或场景镜头。

影响链路
  voice_analysis prompt:
    双语模板都明确兼容旧分镜字段 text_segment，以及 FrameOS 字段 panel_id、panel_number、source_text、source_anchor、referenced_assets、characters、location、props、video_prompt、continuity_notes、voice_refs、scene_type、duration。
    voice_refs 中已有同 speaker 或同台词内容时优先作为匹配证据；若与原文冲突，则以原文为准，无法可靠匹配时 matchedPanel 设为 null。
    source_text/source_anchor 用于校验台词属于该镜头的原文证据，不允许把台词匹配到只支持动作、反应或场景描述的镜头。
    referenced_assets.characters 与 characters 用于校验发言人身份和可见性；对话优先匹配发言人在场的镜头，旁白或内心独白只有在原文证据支持时才允许离屏。
    video_prompt 明确说话时优先匹配该镜头；听者反应镜头不能承载说话者台词，除非没有说话镜头且仍有旁白证据。
    continuity_notes、scene_type、duration 作为时间和连续性线索，匹配结果需要为 dialogue_state 与 lip_sync 做准备。

  regression:
    prompt-json-canary guard 新增 voice_analysis 双语 token 检查：source_text、source_anchor、referenced_assets、voice_refs、video_prompt、continuity_notes、dialogue_state、lip_sync。
    prompt semantic regression 同步覆盖英文模板关键 token，并保留 storyboardId/panelIndex 输出契约检查。
    新增 tests/unit/prompt-i18n/voice-analysis-template.test.ts，验证双语模板注册、FrameOS 分镜字段 token 和变量渲染。

样例输入输出
  样例使用 Ari、Mina、workshop_day、brass_key、panel-1 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/voice-analysis-template.test.ts tests/unit/worker/voice-analyze.test.ts 通过，6 tests passed。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  敏感信息扫描未命中。

剩余问题
  buildStoryboardJson 当前仍主要输出 storyboardId、panelIndex、text_segment、description、characters；本轮模板已兼容 FrameOS 字段，但运行时要真正用满 source_text/referenced_assets/voice_refs 仍需要后续扩展分镜 JSON 构建。
  emotionStrength prompt 上限仍是 0.5，运行时 clamp 上限仍为 1；本轮保持既有行为不改。
  不处理 CAPTCHA，也不把真实 FrameOS TEST 原始输出写入仓库；真实项目输出继续作为本地对照材料使用。
```

2026-06-14 FrameOS voice storyboard context bridge 追加记录：

```text
本轮目的
  补上 voice_analysis prompt 与运行时分镜 JSON 之间的上下文桥接。
  上一轮模板已经要求读取 FrameOS 字段；本轮让 buildStoryboardJson 在不改数据库、不改 UI 的前提下，从现有 NovelPromotionPanel 字段中输出这些生产证据。
  目标是让台词匹配模型在真实任务中看到更多镜头语义，而不是只看到 storyboardId、panelIndex、text_segment、description、characters。

影响链路
  voice-analyze-helpers buildStoryboardJson:
    保留旧字段 storyboardId、panelIndex、text_segment、description。
    新增 panel_id、panel_number、source_text、source_anchor、characters、location、props、referenced_assets、scene_type、shot_type、camera_move、image_prompt、video_prompt、continuity_notes、voice_refs、duration。
    source_text 暂用 panel.srtSegment，source_anchor 暂用同一文本作为锚点对象；不伪造原文 offset。
    referenced_assets 从现有 characters/location/props 字段整理；characters/props 若是 JSON 数组会解析为名称数组，否则保留原字符串作为单项。
    continuity_notes 合并 photographyRules 与 actingNotes，作为镜头连续性和口型清晰度证据。
    voice_refs 维持空数组，不从单一角色或台词片段中推断说话者，避免错误绑定。

  regression:
    tests/unit/worker/voice-line-parse-helpers.test.ts 新增 buildStoryboardJson 样例，锁定 FrameOS 字段输出形状。
    继续复跑 voice-analyze worker 测试，确认 matchedPanel 的 storyboardId/panelIndex 解析和入库行为不变。

样例输入输出
  样例使用 Ari、Mina、workshop_day、brass_key、panel-1 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npx vitest run --exclude '.worktrees/**' tests/unit/worker/voice-line-parse-helpers.test.ts tests/unit/worker/voice-analyze.test.ts tests/unit/prompt-i18n/voice-analysis-template.test.ts 通过，11 tests passed。
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  source_anchor 仍不是 FrameOS 式真实 start/end 原文片段，只是当前 srtSegment 证据桥接；后续要 1:1 对齐需要在分镜生成阶段持久化真实 source_anchor。
  voice_refs 仍未由分镜生成链路稳定落库；本轮刻意不推断，避免音色/口型误配。
  referenced_assets 受限于现有 characters/props 存储格式，无法保证总是资产 ID 数组；后续需要统一分镜持久结构。
```

2026-06-14 FrameOS script storyboard context bridge 追加记录：

```text
本轮目的
  继续补齐分镜生成到配音/后续检查之间的 FrameOS 生产证据传递。
  上一轮只扩展了独立 voice_analyze 的 buildStoryboardJson；本轮扩展 script-to-storyboard-helpers 中的已持久化分镜 JSON 和本次生成 clipPanels JSON。
  目标是让脚本转分镜链路后续台词匹配、导出前检查和重试上下文看到 panel_id、source_anchor、referenced_assets、video_prompt、continuity_notes、voice_refs 等字段。

影响链路
  script-to-storyboard-helpers buildStoryboardJson:
    保留 storyboardId、panelIndex、text_segment、description、characters、props。
    新增 panel_id、panel_number、source_text、source_anchor、location、referenced_assets、scene_type、shot_type、camera_move、image_prompt、video_prompt、continuity_notes、voice_refs、duration。
    persisted select 从现有 NovelPromotionPanel 中带回 panelNumber、shotType、cameraMove、location、duration、imagePrompt、videoPrompt、photographyRules、actingNotes、sceneType。
    source_text 暂用 srtSegment，source_anchor 暂用同一文本作为锚点对象；不伪造 start/end offset。
    continuity_notes 合并 photographyRules 与 actingNotes，作为摄影连续性、演技和口型清晰度证据。

  script-to-storyboard-helpers buildStoryboardJsonFromClipPanels:
    保留生成阶段已有 panel_id、panel_number、source_text、source_anchor、referenced_assets、visual_prompt、video_prompt、continuity_notes、voice_refs、duration。
    当 referenced_assets 缺失时才从 characters/location/props 组装兜底对象；不覆盖模型已生成的引用契约。
    characters 支持字符串数组或 {name} 对象数组，便于兼容不同分镜阶段输出。

  regression:
    tests/unit/worker/voice-line-parse-helpers.test.ts 新增两组样例，分别锁定 persisted storyboard context 和 clipPanels context 的 FrameOS 字段输出形状。
    继续复跑 tests/unit/worker/script-to-storyboard.test.ts，确认 voice line matchedPanel 映射和 script-to-storyboard worker 行为不变。

样例输入输出
  样例使用 Ari、Mina、workshop_day、brass_key、panel-1 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npx vitest run --exclude '.worktrees/**' tests/unit/worker/voice-line-parse-helpers.test.ts tests/unit/worker/script-to-storyboard.test.ts 通过，12 tests passed。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  source_anchor 仍是由 srtSegment 桥接的对象，不是真实 episode 原文 start/end；完整 1:1 对齐需要在分镜生成阶段把 source_anchor 独立落库或写入稳定 metadata。
  voice_refs 只有本次生成 clipPanels 已有时才会保留；已持久化旧 panel 仍无法从数据库恢复真实 voice_refs。
  referenced_assets 仍受 characters/props 的历史存储格式限制；后续需要统一资产 ID 与资产名称的双轨引用结构。
```

2026-06-14 FrameOS panel metadata persistence bridge 追加记录：

```text
本轮目的
  将 FrameOS 分镜生产字段通过现有 actingNotes JSON 载体随 panel 持久化，避免 source_anchor、referenced_assets、visual_prompt、continuity_notes、voice_refs 在入库后丢失。
  不新增数据库 schema，不改 UI，不新增生产规则检查；只增加结构化 metadata 读写 helper，并让现有 worker 上下文优先读取。

影响链路
  panel-frameos-metadata:
    新增 _frameosPanelMetadata 作为 actingNotes 内部 metadata key。
    支持字段：panel_id、panel_number、source_text、source_anchor、referenced_assets、visual_prompt、visual_style、visual_style_description、continuity_notes、voice_refs。
    若 actingNotes 原本是数组，则包装为 {characters: [...]} 后再写入 metadata，保留原演技数据。
    readActingNotesContinuityText 会把 characters 里的 name + acting/expression 整理为连续性文本，用于 prompt 上下文，不把 metadata 自身重复混入表演文本。

  script-to-storyboard persistence:
    persistStoryboardsAndPanels 与 persistStoryboardOutputs 在创建 NovelPromotionPanel 前，将生成阶段 panel 的 FrameOS 字段写入 actingNotes。
    同一 actingNotes 随后继续写入 _seedanceReferenceAssets，两个内部 metadata key 共存。
    buildStoryboardJson 读取已持久化 panel 时，优先从 _frameosPanelMetadata 还原 panel_id、panel_number、source_text、source_anchor、referenced_assets、visual_prompt、visual_style、visual_style_description、continuity_notes、voice_refs。

  voice and image prompt context:
    voice-analyze-helpers buildStoryboardJson 读取 _frameosPanelMetadata，独立台词分析任务也能看到真实 source_anchor、referenced_assets 和 voice_refs。
    panel-image-task-handler 的 single_panel_image 上下文读取 _frameosPanelMetadata，图片生成/重绘能拿到 source_anchor、voice_refs、continuity_notes、visual_style 和 visual_prompt。

  regression:
    tests/unit/worker/voice-line-parse-helpers.test.ts 新增 persisted metadata 恢复样例，同时覆盖 script-to-storyboard 与 standalone voice_analyze 两条 JSON builder。
    tests/unit/worker/panel-image-task-handler.test.ts 新增 _frameosPanelMetadata 样例，验证单帧图片 prompt 输入中包含 panel_id、source_anchor、voice_refs、continuity_notes，并验证 visual_prompt 优先使用 metadata。

样例输入输出
  样例使用 Ari、Hero、Mina、Old Town、workshop_day、brass_key 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npx vitest run --exclude '.worktrees/**' tests/unit/worker/voice-line-parse-helpers.test.ts tests/unit/worker/panel-image-task-handler.test.ts tests/unit/worker/script-to-storyboard.test.ts 通过，16 tests passed。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  _frameosPanelMetadata 是 actingNotes 内部桥接方案，不是最终理想 schema；长期仍应有独立 panel metadata 或 JSON 字段承载 FrameOS 生产证据。
  旧数据没有 _frameosPanelMetadata 时仍只能从 srtSegment、characters、props、photographyRules、actingNotes 做近似恢复。
  voice_refs 的真实性仍依赖分镜生成 prompt 输出；本轮只保证已有 voice_refs 不在持久化后丢失。
```

2026-06-14 FrameOS video prompt metadata bridge 追加记录：

```text
本轮目的
  让视频生成阶段也能读取上一轮持久化到 actingNotes._frameosPanelMetadata 的 FrameOS 分镜生产证据。
  目标是视频模型不仅看到 panel.videoPrompt，还能看到 source_anchor、referenced_assets、continuity_notes、voice_refs 和 visual_style 等上下文，减少视频生成偏离剧情证据、资产引用和口型准备。

影响链路
  video.worker:
    新增 buildPanelVideoPromptWithFrameOSEvidence，在默认使用 panel.videoPrompt 或 panel.description 时追加 FrameOS production evidence JSON。
    追加字段包括 panel_id、panel_number、source_text、source_anchor、referenced_assets、continuity_notes、voice_refs、visual_style、visual_style_description。
    自定义 payload.customPrompt 与 firstLastFrame.customPrompt 不追加 metadata，保留人工重试或首尾帧自定义提示的明确优先级。
    Ark 输入图审核失败后的 text-only fallback 也使用扩展后的 prompt，因此 fallback 仍保留同一份 FrameOS 证据。
    提示中明确 voice_refs 只是生产证据，不能生成字幕或可见文字。

  regression:
    tests/unit/worker/video-worker.test.ts 新增默认 panel video prompt 追加 _frameosPanelMetadata 的样例。
    同文件新增 customPrompt 不追加 metadata 的样例，防止人工覆盖提示被系统上下文污染。
    同步补齐 video-worker 测试里 model-config-contract mock 的 composeModelKey，以适配 HFSY 固定模型常量链路。

样例输入输出
  样例使用 Hero、Old Town、brass_key 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npx vitest run --exclude '.worktrees/**' tests/unit/worker/video-worker.test.ts tests/unit/worker/voice-line-parse-helpers.test.ts tests/unit/worker/panel-image-task-handler.test.ts 通过，24 tests passed。
  npx tsc --noEmit --pretty false 通过。
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:no-model-key-downgrade 通过。

剩余问题
  当前证据追加是文本 prompt 方式，不是视频模型原生结构化参数；不同视频 provider 对长上下文的遵循程度仍需真实任务采样。
  firstLastFramePrompt 的持久化提示本轮也会追加 metadata，但 firstLastFrame.customPrompt 不追加；如果后续希望首尾帧自定义也带证据，需要显式 UI/调用端选项。
  旧 panel 没有 _frameosPanelMetadata 时，视频阶段仍只能依赖原 videoPrompt、reference images 和 actingNotes 近似上下文。
```

2026-06-14 FrameOS shot variant metadata bridge 追加记录：

```text
本轮目的
  让镜头变体分析阶段读取 actingNotes._frameosPanelMetadata 中持久化的 FrameOS 分镜生产证据。
  目标是变体分析不只依赖 panel.srtSegment、characters、props 和 photographyRules 临时拼上下文，而是优先使用分镜生成阶段保存下来的 source_anchor、referenced_assets、visual_prompt、continuity_notes、voice_refs 和视觉风格字段。

影响链路
  shot-ai-variants:
    新增 buildPanelContextJson 内部构建逻辑，panel_context_json 优先读取 _frameosPanelMetadata。
    panel_id、panel_number、source_text、source_anchor、referenced_assets、visual_prompt、visual_style、visual_style_description、continuity_notes、voice_refs 均从 metadata 优先恢复。
    metadata 缺失时继续使用旧 panel 字段兜底：srtSegment 作为 source_text，characters/location/props 组成 referenced_assets，imagePrompt 作为 visual_prompt。
    continuity_notes 会合并 metadata.continuity_notes、photographyRules 和 actingNotes characters 里的表演文本，避免 metadata 保存后丢失摄影与演技连续性证据。
    不新增数据库 schema，不新增生产规则检查，不把 FrameOS TEST 原始输出写入仓库。

  regression:
    tests/unit/worker/shot-ai-variants.test.ts 新增 _frameosPanelMetadata 样例，验证 panel_context_json 包含 source_anchor、referenced_assets、voice_refs、continuity_notes、visual_style、visual_style_description 和 visual_prompt。

样例输入输出
  样例只使用 Hero、Old Town、brass_key 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npx vitest run --exclude '.worktrees/**' tests/unit/worker/shot-ai-variants.test.ts 通过，3 tests passed。
  npx tsc --noEmit --pretty false 通过。
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  git diff --check 通过。
  账号、密码和 API key 固定片段敏感扫描未命中。

剩余问题
  旧 panel 没有 _frameosPanelMetadata 时，变体分析仍只能从历史字段近似恢复 FrameOS 证据。
  shot variant 生成和后续持久化是否也需要保留 metadata 仍待后续真实任务采样决定。
  当前只保证分析 prompt 获取结构化上下文，不改变模型返回的变体 JSON schema。
```

2026-06-14 FrameOS redraw prompt metadata bridge 追加记录：

```text
本轮目的
  让镜头图片提示词重绘/改写阶段读取 panel 上持久化的 FrameOS 分镜生产证据。
  目标是 image_prompt_modify 不只依赖前端临时传入的 currentPrompt 和手选资产，而是在有 panelId 时自动补齐 source_text、source_anchor、referenced_assets、visual_prompt、video_prompt、visual_style、continuity_notes 和 voice_refs。

影响链路
  shot-ai-prompt-shot:
    通过 payload.panelId 或任务 targetId 读取 NovelPromotionPanel。
    panel_context_json 优先保留用户当前编辑 prompt，同时从 actingNotes._frameosPanelMetadata 恢复 source_anchor、referenced_assets、visual_style、visual_style_description、continuity_notes、voice_refs。
    当 payload 未传 currentVideoPrompt 时，使用 panel.videoPrompt 作为 video_prompt_input，避免重绘改写只看静帧提示词。
    continuity_notes 合并 metadata.continuity_notes、payload.continuityNotes、panel.photographyRules 和 actingNotes characters 表演文本。
    referencedAssets 仍以用户手选资产优先；没有手选资产时使用 metadata.referenced_assets 兜底。

  prompt-stage runtime:
    usePromptAiModifyFlow 在提交 AI 改写任务时传入 panelId=shotId。
    useAiModifyProjectShotPrompt 类型允许 panelId，route 原本已支持 panelId 并将 targetId 指向 NovelPromotionPanel，本轮只打通真实调用上下文。

  regression:
    tests/unit/worker/shot-ai-prompt-shot.test.ts 新增 _frameosPanelMetadata 样例，验证 panel_context_json 与 referenced_assets_json 包含 source_anchor、referenced_assets、visual_prompt、visual_style、visual_style_description、continuity_notes 和 voice_refs。

样例输入输出
  样例只使用 Hero、Old Town、brass_key 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npx vitest run --exclude '.worktrees/**' tests/unit/worker/shot-ai-prompt-shot.test.ts 通过，3 tests passed。
  npx tsc --noEmit --pretty false 通过。
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  git diff --check 通过。
  账号、密码和 API key 固定片段敏感扫描未命中。

剩余问题
  只有携带 panelId 或 targetId=NovelPromotionPanel 的改写任务能自动读取 metadata；纯项目级改写仍只能依赖 payload。
  当前只增强重绘改写 prompt 的输入上下文，不改变 image_prompt_modify 的输出 schema。
  若后续需要把改写后的 referenced_assets/continuity_notes 回写 panel metadata，需要单独设计持久化策略。
```

2026-06-14 FrameOS panel variant generation metadata bridge 追加记录：

```text
本轮目的
  让镜头变体图片生成阶段也使用并延续 FrameOS 分镜生产证据。
  目标是 panel_variant 不只依赖 sourcePanel 的 description、shotType、cameraMove、location 和 characters，而是在生成 prompt seed 中带入 source_text、source_anchor、referenced_assets、visual_prompt、video_prompt、visual_style、continuity_notes 和 voice_refs，并把这些证据写回新 panel。

影响链路
  panel-variant-task-handler:
    新增变体 evidence 构建逻辑，优先读取 newPanel.actingNotes._frameosPanelMetadata，再读取 sourcePanel.actingNotes._frameosPanelMetadata，最后从现有 panel 字段兜底。
    agent_shot_variant_generate 的 video_prompt 变量会追加 FrameOS production evidence JSON；模板已把该 seed 视为生产证据，因此无需新增模板变量。
    生成图片后，update NovelPromotionPanel.imageUrl 的同时写回 actingNotes._frameosPanelMetadata，保留 panel_id、panel_number、source_text、source_anchor、referenced_assets、visual_prompt、visual_style、visual_style_description、continuity_notes、voice_refs。
    continuity_notes 会合并 source/new metadata、photographyRules 和 actingNotes characters 表演文本，便于后续视频、配音和重绘继续读取。
    不新增数据库 schema，不新增生产规则检查，不把 FrameOS TEST 原始输出写入仓库。

  regression:
    tests/unit/worker/panel-variant-task-handler.test.ts 新增 _frameosPanelMetadata 样例，验证变体生成 prompt seed 包含 source_anchor、referenced_assets、visual_prompt、visual_style、visual_style_description 和 voice_refs，并验证新 panel update 写回 _frameosPanelMetadata。

样例输入输出
  样例只使用 Hero、Old Town、brass_key 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npx vitest run --exclude '.worktrees/**' tests/unit/worker/panel-variant-task-handler.test.ts 通过，4 tests passed。
  npx tsc --noEmit --pretty false 通过。
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。

剩余问题
  当前变体 metadata 继承 sourcePanel 证据为主；如果变体请求显式改变可见资产，后续仍需要在上游 variant JSON 中提供更新后的 referenced_assets。
  变体生成后只写回 _frameosPanelMetadata，不新增独立 panel metadata 字段；长期仍应迁移到结构化 schema。
  不改变图片模型调用接口，FrameOS 证据仍通过 prompt 文本传入，不是 provider 原生结构化参数。
```

2026-06-14 FrameOS storyboard phase2 context bridge 追加记录：

```text
本轮目的
  补齐旧 storyboard-phases 路径中摄影规则和演技指导的 FrameOS 分镜字段输入。
  目标是 Phase 2 摄影和 Phase 2-Acting 不再只依赖 Phase 1 原始 planPanels，而是在发送给 agent_cinematographer 与 agent_acting_direction 前，确保每个 panel 至少带有 panel_id、panel_number、source_text、source_anchor、referenced_assets、visual_prompt、continuity_notes 和 voice_refs。

影响链路
  storyboard-phases:
    新增 enrichPanelsForFrameOSPhaseContext，用于在 prompt 输入前补齐 FrameOS 式 panel 字段。
    source_text 优先使用 panel.source_text，其次 text_segment、description、clip.content。
    source_anchor 优先保留模型输出；缺失时用 clip.startText/endText 或 source_text 作为追溯对象。
    referenced_assets 优先保留模型输出；缺失时从 panel/clip characters、location、props 组装。
    visual_prompt 优先保留 panel.visual_prompt；缺失时使用 image_prompt。
    continuity_notes 和 voice_refs 保持已有值，缺失时给空字符串或空数组，保证模板能稳定读取。

  phase2 prompts:
    executePhase2 的 {panels_json} 改为 enriched panels，用于摄影规则、构图、光线、色彩和 technical_notes。
    executePhase2Acting 的 {panels_json} 改为 enriched panels，用于 dialogue_state、lip_sync、表演连续性和角色/道具关系。
    不新增数据库 schema，不新增生产规则检查，不改变模型输出 schema。

  regression:
    tests/unit/novel-promotion/storyboard-phases-frameos-context.test.ts 新增人工样例，验证缺失字段会被补齐，且模型已输出的 FrameOS 字段不会被覆盖。

样例输入输出
  样例只使用 Ari、Mina、workshop_day、brass_key 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npx vitest run --exclude '.worktrees/**' tests/unit/novel-promotion/storyboard-phases-frameos-context.test.ts 通过，2 tests passed。
  npx tsc --noEmit --pretty false 通过。
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。

剩余问题
  旧路径仍不如 script-to-storyboard-helpers 的持久化 metadata 完整；本轮只保证 Phase 2 prompt 输入不缺关键 FrameOS 字段。
  当 Phase 1 输出错误角色或道具时，本 helper 不做纠错或拦截，只提供结构化上下文兜底。
  Phase 3 detail 已有 FrameOS 字段模板约束；后续仍需真实任务采样确认三阶段输出是否稳定保持字段。
```

2026-06-14 FrameOS export preflight canary 追加记录：

```text
本轮目的
  为导出前检查建立小样本结构回归，覆盖缺图、缺视频、缺引用、缺提示词、时长异常、音色缺口、连续性缺口和清单缺口等质量判断输出枚举。
  目标是锁定 export_preflight_review 的 FrameOS 式可交付性报告结构，避免后续 prompt 调整破坏 readiness、issues、deliverables、next_actions 等字段。

影响链路
  standards/prompt-canary:
    新增 export_preflight.canary.json。
    样例包含 status、summary、readiness、issues、deliverables、next_actions。
    issues 覆盖 missing_video 与 voice_gap 两类人工通用问题，用于证明 code/severity/stage/target_type/target_id/message/suggested_fix 的结构。

  prompt-json-canary-guard:
    新增 exportPreflight canary 文件读取。
    新增 validateExportPreflightCanary，校验 readiness 状态枚举、deliverables 状态枚举、issue code/severity/stage/target_type 枚举和 next_actions 结构。
    该校验只用于 prompt/schema 回归，不接入生产运行时，不新增规则检查。

样例输入输出
  样例只使用 Episode 1、Ari、panel_1、voice_1、brass_key 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  当前导出前检查仍是 prompt 与 canary 契约，尚未新增独立 worker 或 API 入口。
  canary 只覆盖结构与核心枚举，不证明真实项目全量导出清单已经可交付。
  若后续接入实际导出前检查任务，应复用该 schema，并将输入来源限定为已有剧本、资产、分镜、媒体和配音数据。
```

2026-06-14 FrameOS voice mapping unmatched canary 追加记录：

```text
本轮目的
  修正 voice_mapping 模板与 canary guard 之间的契约不一致。
  voice_mapping prompt 明确允许在没有可用音色库时输出 voice_source=unmatched 且 candidates=[]；本轮让小样本回归也覆盖这种草稿状态，避免后续为了通过测试误要求每个角色都必须有假音色候选。

影响链路
  standards/prompt-canary/frameos_assets.canary.json:
    voice_mapping 新增 Mika 人工样例。
    Mika 使用 voice_source=unmatched、voice_raw_file=""、candidates=[]，覆盖未匹配音色但仍保留 voice_profile 的 FrameOS 草稿状态。

  prompt-json-canary-guard:
    validateFrameosAssetsCanary 继续要求 candidates 字段必须是数组。
    当 voice_source 不是 unmatched 时，candidates 仍必须非空。
    当 voice_source 是 unmatched 时，允许 candidates=[]，与 voice_mapping 模板严格要求一致。
    该调整只用于 prompt/schema 回归，不接入生产运行时，不新增规则检查。

样例输入输出
  样例只使用 Ari、Mika、voice_1 等人工通用音色映射数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx tsc --noEmit --pretty false 通过。

剩余问题
  当前 voice_mapping 仍是模板和 canary 契约，尚未新增独立 worker 或 UI 流程。
  canary 覆盖 library_match 与 unmatched 两种常见状态，但未覆盖 custom_upload；后续接入上传音频流程后再补。
  未使用真实音色库做 live 匹配验证。
```

2026-06-14 FrameOS voice audition canary 追加记录：

```text
本轮目的
  补齐 voice_mapping 输出里的 auditions 草稿结构回归。
  voice_mapping 模板要求 auditions 用于后续试听任务登记，且没有真实试听音频时必须输出空数组；本轮让 frameos_assets canary 显式包含 auditions=[]，避免后续 prompt/schema 调整丢失该字段。

影响链路
  standards/prompt-canary/frameos_assets.canary.json:
    顶层新增 auditions: []。
    不新增 custom_upload 假数据，不编造 reference_audio_id 或试听结果。

  prompt-json-canary-guard:
    validateFrameosAssetsCanary 新增 auditions 必填字段校验。
    auditions 必须是数组；当前允许空数组，以匹配“没有真实试听音频时输出空数组”的模板约束。
    该调整只用于 prompt/schema 回归，不接入生产运行时，不新增规则检查。

样例输入输出
  样例继续使用 Ari、Mika、voice_1 等人工通用音色映射数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或 /Users/headmasterx/Desktop/test.docx 内容。

验证
  npm run check:prompt-json-canary 通过。

剩余问题
  auditions 当前只覆盖空数组草稿状态；真实试听任务接入后需要补充带 audition_id、character_id、voice_id、reference_audio_id、status 的样例。
  custom_upload 仍未进入 canary，因为当前模板要求本阶段 voice_raw_file 固定为空字符串。
  未使用真实音色库或真实试听音频做 live 验证。
```

2026-06-14 FrameOS voice mapping 独立 canary 追加记录：

```text
本轮目的
  为 voice_mapping 模板建立独立结构回归，不再只依赖 frameos_assets 资产包 canary 间接覆盖。
  目标是锁定独立输出形态 {status, voice_mapping, auditions}，确保音色匹配阶段可以作为单独 workflow 节点稳定返回草稿结构。

影响链路
  standards/prompt-canary:
    新增 voice_mapping.canary.json。
    样例覆盖 Ari 的 library_match 与 Mika 的 unmatched，保留 auditions=[] 作为没有真实试听音频时的草稿状态。

  prompt-json-canary-guard:
    CANARY_FILES 新增 voiceMapping。
    新增 validateVoiceMappingCanary，校验 status、voice_mapping、auditions 顶层字段。
    新增 validateVoiceMappingEntries，让 frameos_assets.voice_mapping 与独立 voiceMapping.voice_mapping 共用同一套字段校验。
    candidates 仍必须是数组；voice_source 不是 unmatched 时必须非空，unmatched 时允许空数组。
    该校验只用于 prompt/schema 回归，不接入生产运行时，不新增规则检查。

样例输入输出
  样例只使用 Ari、Mika、voice_1 等人工通用音色映射数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  npm run check:prompt-json-canary 通过。

剩余问题
  当前独立 voice_mapping canary 只覆盖 library_match、unmatched 和空 auditions 草稿状态。
  custom_upload 仍需等上传音频流程存在后再补样例和校验。
  还未接入真实音色库 live 匹配，也未新增独立 voice worker 或 UI 流程。
```

2026-06-14 FrameOS project production context 追加记录：

```text
本轮目的
  将 FrameOS 项目详情 schema 中的项目级生产参数作为 prompt 输入上下文接入，而不是写成生成结果或生产规则。
  目标是让剧本转换和分镜规划能读取 genre、language、aspect_ratio、visual_category、budget_level、episode_duration_seconds 等高层制作约束，同时继续以原文和资产库为准。

影响链路
  frameos-production-context:
    新增 buildFrameosProductionContext。
    只从已有 project、novelProject、episode、payload.productionContext / projectProductionContext / projectContext 中读取字段。
    有字段时输出 key: value 短文本；无字段时输出保守 fallback，要求只从原文和资产库推断。
    不解析正文，不新增规则检查，不编造缺失字段。

  screenplay_conversion:
    catalog 新增 project_production_context 变量。
    中英文模板新增项目生产上下文输入。
    规则明确该上下文只作为类型、语言、画幅、预算、单集时长等高层制作约束，不能添加剧情事实；冲突时以原文和资产库为准。
    standalone screenplay-convert worker、story-to-script 主路径和 screenplay retry 路径都传入该上下文。
    clips.split artifact 记录 projectProductionContext，保证后续单片段 retry 使用同一轮上下文。

  agent_storyboard_plan:
    catalog 新增 project_production_context 变量。
    中英文模板新增项目生产上下文输入。
    分镜规划只用它校准 pacing、aspect_ratio、language、genre、budget_level 和 episode_duration_seconds，不新增剧情事实。
    script-to-storyboard 主路径、atomic retry 和旧 storyboard-phases Phase 1 都补齐该占位符。

  regression:
    prompt-json-canary guard 和 prompt semantic regression 将 project_production_context 纳入 screenplay_conversion 与 agent_storyboard_plan 的关键 token。
    新增 tests/unit/novel-promotion/frameos-production-context.test.ts，覆盖有字段输出和无字段 fallback。

样例输入输出
  单测只使用 TEST、short drama、zh、9:16、standard、120 等人工通用项目参数。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npm run check:prompt-ab-regression 通过。
  npm run check:no-model-key-downgrade 通过。
  npx vitest run --exclude '.worktrees/**' tests/unit/novel-promotion/frameos-production-context.test.ts 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。

剩余问题
  Nori 项目表当前不一定保存 FrameOS 的全部 project-detail 字段；本轮只桥接已有字段和 payload 显式传入字段。
  项目生产上下文不会替代真实资产库、剧本解析和分镜结构；后续如果增加项目设置表，应直接复用该 helper。
  尚未用真实 FrameOS live 项目设置跑端到端对标。
```

2026-06-14 FrameOS episode split wrapper 追加记录：

```text
本轮目的
  将长文本分集 prompt 从旧式 {analysis, episodes, validation} 推进到 FrameOS episodes-list 结构。
  目标是剧本解析分集阶段输出 status、steps、default_visual_style、script_kilo、adapted_kilo、items、analysis、validation，并让 items 成为后续剧本转换、资产抽取和分镜的生产入口。

影响链路
  episode_split prompt:
    中英文模板改为以 items 为主输出 FrameOS 式剧集列表。
    顶层新增 status、steps、default_visual_style、script_kilo、adapted_kilo。
    items[] 新增 content，并将 info_points 调整为 FrameOS 式字符串。
    scenes[] 补齐 scene_id、int_ext、location、time、content、content_kilo、characters、visual_style_description、visual_style_confirmed 等剧本复核字段。
    仍保留 analysis 和 validation，作为当前分集均衡与边界检查的可见统计。

  episode-split worker:
    parseSplitResponse 兼容 FrameOS items；当模型没有输出旧 episodes 别名时，自动使用 items 作为分集列表。
    该兼容只服务解析迁移，不新增生产规则检查，不改变边界匹配逻辑。

  prompt-json-canary:
    新增 standards/prompt-canary/episode_split.canary.json。
    新增 validateEpisodeSplitCanary，校验顶层 wrapper、items、source_anchor、reasoning、scenes 和 validation 结构。
    prompt-json-canary guard 与 prompt semantic regression 同步把 episode_split 的关键 token 从 episodes 迁移到 items。

  regression:
    tests/unit/prompt-i18n/episode-split-template.test.ts 更新为检查 FrameOS wrapper 字段。
    tests/unit/worker/episode-split.test.ts 新增 items-only payload 回归，证明旧 worker 能消费 FrameOS 输出。

样例输入输出
  样例只使用 Ari、Mika、workshop_day、brass key 等人工通用分集数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  npm run check:prompt-json-canary 通过。
  npm run check:prompt-i18n-regression 通过。
  npx vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/episode-split-template.test.ts tests/unit/worker/episode-split.test.ts 通过。

剩余问题
  episode_split 仍只返回匹配后的 number/title/summary/content/wordCount 给调用方；FrameOS items 的完整复核字段尚未落库。
  当前迁移保持旧 boundary matcher，不处理真实 FrameOS episodes-list 的审批、确认或世界观接口。
 尚未用 TEST 项目真实长文重新跑完整分集 live 对标。
```

2026-06-14 FrameOS video prompt grammar and Lumina fallback 追加记录：

```text
本轮目的
  继续收敛分镜生成、镜头提示词和视频提示词的稳定性。
  子 agent 只读审计指出当前 guard 多数只防字段缺失，不防语义失真；另一个审计指出部分 novel-promotion 文本链路仍未统一走 Lumina GPT-5.5 兜底。
  本轮不新增运行时规则检查、不写测试正文、不写 API key，只强化 prompt 生产语法、模板回归和模型选择兜底。

影响链路
  agent_storyboard_plan / agent_storyboard_detail:
    中英文模板新增 video_prompt 生产语法要求。
    video_prompt 必须包含可视主体、可见动作、被引用的场景/道具/角色资产、镜头运动、本节拍起止状态、与前后镜头的连续性约束。
    禁止只写“电影感镜头”“戏剧性运动”等泛化词；必须说明谁或什么在动、画面中发生了什么变化、发生在哪里、镜头如何运动。
    有对白或旁白时，video_prompt 必须写明可见说话者或反应主体，并包含正在说话/无声反应等口型或配音准备；不得生成字幕或可见文字。

  模型调用策略:
    resolveAnalysisModel 从 payload > project > user > throw 改为 payload > project > user > lumina::gpt-5.5。
    episode-split 从仅读取用户配置改为读取项目级配置，并在类型层显式兜底 lumina::gpt-5.5。
    SuperAgentLLMClient 在传入 projectId 时优先读取项目级 analysisModel；没有项目配置时再回落用户配置和 Lumina。
    shot-ai-persist 和 character-profile-helpers 同步使用 Lumina GPT-5.5 作为分析模型最终兜底，避免镜头提示词和角色档案链路在缺省配置下中断。

  regression:
    prompt-json-canary guard 和 prompt semantic regression 将 visual subject、start/end state、lip-sync 等 video_prompt 生产语法锚点纳入 storyboard plan/detail 模板检查。
    新增 tests/unit/prompt-i18n/storyboard-video-prompt-template.test.ts，验证中英文模板包含生产语法，并能渲染分镜上下文。
    更新 resolve-analysis-model、episode-split、super-agent 相关测试，锁定 Lumina fallback 和项目级模型优先级。

样例输入输出
  样例只使用 Ari、workshop_day、brass_key 等人工通用短句。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。
  未写入 Lumina API key；模型键只使用 lumina::gpt-5.5 常量。

验证
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npm run check:no-model-key-downgrade 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/storyboard-video-prompt-template.test.ts tests/unit/worker/resolve-analysis-model.test.ts tests/unit/worker/episode-split.test.ts tests/unit/super-agent/llm-client.test.ts tests/unit/test-mode-lumina-defaults.test.ts tests/unit/config-service-project-defaults.test.ts 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/storyboard-video-prompt-template.test.ts tests/unit/worker/resolve-analysis-model.test.ts tests/unit/worker/episode-split.test.ts tests/unit/super-agent/llm-client.test.ts tests/unit/worker/shot-ai-prompt-shot.test.ts tests/unit/worker/shot-ai-variants.test.ts tests/unit/worker/character-profile.test.ts 通过。

剩余问题
  本轮仍未做真实 test.docx 全链路 live 对标；只是让现有 prompt 与模型选择策略更接近 FrameOS 式稳定生产链路。
  video_prompt 语义稳定性仍由 prompt 和模板回归约束，不做运行时硬拦截。
  部分资产手动入口仍只输出 prompt 文本，identity_lock、coverage、variants 和 design_image 未完全结构化落库。
```

2026-06-14 FrameOS voice mapping custom upload/audition 追加记录：

```text
本轮目的
  补齐 FrameOS 资产设定里 voice_mapping 的上传音频与试听任务草稿结构。
  上一轮独立 voice_mapping canary 只覆盖 library_match、unmatched 和空 auditions；本轮加入 custom_upload 与非空 audition 记录，避免后续把上传音色资产误退回到未匹配或假库音色。
  继续保持 prompt/schema/canary 层收敛，不新增生产运行时规则检查，不写真实 TEST 剧情正文、test.docx 内容、API key 或登录凭据。

影响链路
  voice_mapping prompt:
    中英文模板明确 voice_source 只能是 library_match、unmatched、custom_upload。
    custom_upload 只能来自输入角色资产中明确存在的上传音频文件元数据；voice_raw_file 原样复制输入文件 id 或路径。
    custom_upload 不允许编造 voice_id；除非输入同时明确提供音色库候选，否则 candidates 保持空数组。
    candidates 的 rank 必须是唯一正整数并升序排列；每个角色最多一个 is_selected=true。
    auditions 默认仍为 []；只有输入提供真实试听任务元数据时，才复制 audition_id、character_id、voice_id、reference_audio_id、prompt、status。
    明确禁止编造 reference_audio_id、audition_id、音频 URL 或试听结果。

  canary:
    voice_mapping.canary.json 新增 Nia 人工样例，voice_source=custom_upload、voice_raw_file=uploaded_voice_nia_1、candidates=[]。
    voice_mapping.canary.json 新增 auditions[0]，覆盖 audition_id、character_id、voice_id、reference_audio_id、prompt、status。
    frameos_assets.canary.json 同步新增相同的 voice_mapping custom_upload 样例与 auditions 记录，保证完整资产包也锁定该结构。
    所有样例均为 Ari、Mika、Nia 等人工通用占位数据，没有写入 FrameOS TEST 原始剧情或真实上传资产内容。

  regression:
    prompt-json-canary guard 将 custom_upload、audition_id、prompt 纳入 voice_mapping 模板 token 检查。
    validateVoiceMappingEntries 允许 custom_upload 在 voice_raw_file 非空时 candidates=[]，同时继续要求 library_match 有候选。
    validateVoiceMappingEntries 校验 voice_source 取值、custom_upload 的 voice_raw_file、candidate rank 正整数升序唯一、每角色最多一个 selected candidate。
    新增 validateVoiceAuditions，校验 audition_id、character_id、voice_id、reference_audio_id、prompt、status 的 canary 结构。
    prompt semantic regression 和 voice-mapping-template 单测同步检查 custom_upload 与 audition_id。

验证
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/voice-mapping-template.test.ts 通过。
  npx tsc --noEmit --pretty false 通过。
  精确敏感信息扫描无命中；扫描目标为已知 API key 与账号字面量，文档中不记录原始敏感字符串。

剩余问题
  本轮仍未新增独立 voice worker、真实音色库匹配、试听生成、试听选择或 provider voice binding 落库流程。
  custom_upload 与 auditions 目前只作为 prompt/canary 契约，后续需要接入上传音频资产流程后做 live 对标。
  voice_analysis 输出 schema 暂未扩展，因为当前模板显式要求保持旧输出结构不变，避免破坏现有 worker 消费链路。
```

2026-06-14 FrameOS export preflight evidence/coverage 追加记录：

```text
本轮目的
  继续补齐导出前检查的 FrameOS 式可交付性报告结构。
  重点让 issue 从“自然语言问题列表”变成可排序、可追踪、可解释阻断原因的生产审核结果，并让 canary 覆盖所有已声明的导出问题枚举。
  仍保持 prompt/schema/canary/test 层调优，不新增生产运行时规则检查，不写真实 TEST 剧情正文、test.docx 内容、API key 或登录凭据。

影响链路
  export_preflight_review prompt:
    issues 新增 priority、evidence、blocking_reason。
    priority 用于按 blocker/warning/info 与 script/assets/storyboard/shots/voice/export 依赖顺序组织制作修复。
    evidence 必须来自输入 JSON 已存在字段，例如状态、缺失 URL、缺失 prompt、未绑定台词、缺少 referenced_assets、duration 或 manifest 行。
    blocker 必须写 blocking_reason，说明为什么本次 export_target 不能交付；warning/info 的 blocking_reason 固定为空字符串。
    next_actions 新增 priority 与 target_id，按同一生产优先级输出。

  export_preflight canary:
    原本只覆盖 missing_video 与 voice_gap。
    本轮补齐 missing_image、missing_reference、missing_prompt、duration_risk、asset_gap、continuity_gap、manifest_gap。
    每条 issue 都使用 Ari/panel_1/episode_1 等人工通用占位数据，包含 priority、evidence、blocking_reason 和 suggested_fix。
    未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

  regression:
    prompt-json-canary guard 将 priority、evidence、blocking_reason 纳入 export_preflight_review 双语模板 token 检查。
    validateExportPreflightCanary 校验 issue.priority 为正整数、evidence 为非空字符串数组、blocker 必须有 blocking_reason、非 blocker 的 blocking_reason 必须为空。
    validateExportPreflightCanary 校验 next_actions.priority 与 target_id。
    guard 现在要求 export_preflight.canary.json 覆盖 preflightIssueCodes 中的全部枚举，避免后续模板承诺和小样本覆盖脱节。
    prompt semantic regression 和 export-preflight-review-template 单测同步检查 priority/evidence/blocking_reason。

验证
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/export-preflight-review-template.test.ts 通过。
  精确敏感信息扫描无命中；扫描目标为已知 API key 与账号字面量，文档中不记录原始敏感字符串。

剩余问题
  导出前检查仍是 prompt/canary 契约，尚未接入独立 worker、真实 manifest 生成或导出队列。
  还未扩展 workflow_state、schema_version、target_path、route_hint、deliverable counts 等更完整的 FrameOS 工作台跳转与统计字段。
  storyboard_edit 仍只有 user_input，占位符不足以保证重绘改写时保留 panel_context_json、referenced_assets_json 和 source_image_context；这是下一轮高优先级 prompt-only 缺口。
```

2026-06-14 FrameOS storyboard edit context contract 追加记录：

```text
本轮目的
  补齐 storyboard_edit 作为重绘/改图入口时的显式上下文契约。
  之前模板只接收 user_input，但规则要求保持 referenced_assets、source_text、source_anchor、voice_refs、continuity_notes 等 FrameOS 分镜字段；模型只能从自然语言和原图猜上下文。
  本轮将 panel、资产和原图上下文作为结构化输入注入，提升重绘改写时的资产、原文、镜头和配音连续性。

影响链路
  prompt catalog:
    NP_STORYBOARD_EDIT 变量从 user_input 扩展为 panel_context_json、referenced_assets_json、source_image_context、user_input。
    当前未新增业务调用端；这是 prompt/template 契约迁移，后续接真实重绘入口时必须传入这三个上下文。

  storyboard_edit prompt:
    中英文模板新增 Panel context JSON / 当前分镜上下文 JSON。
    中英文模板新增 Referenced assets JSON / 引用资产 JSON。
    中英文模板新增 Source image context / 原图上下文。
    panel_context_json 被定义为当前 FrameOS 分镜契约，覆盖 panel_id、panel_number、source_text、source_anchor、image_prompt、visual_prompt、video_prompt、continuity_notes、voice_refs、visual_style、visual_style_description、shot_type、camera_move、duration、characters、location、props。
    referenced_assets_json 被定义为可复用资产契约，必须保持角色身份、服装、场景布局、道具身份和可见道具状态。
    source_image_context 与上传原图只作为当前生产帧参考，不能用来改写剧情事实。

  regression:
    prompt-json-canary guard 和 prompt semantic regression 将 panel_context_json、referenced_assets_json、source_image_context、panel_id、shot_type、camera_move、duration 纳入 storyboard_edit 关键 token。
    storyboard-edit-template 单测新增人工通用 panel_context_json、referenced_assets_json 和 source_image_context，验证模板能渲染结构化上下文且无未解析占位符。

样例输入输出
  单测只使用 Ari、workshop_day、brass_key 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/storyboard-edit-template.test.ts 通过。
  精确敏感信息扫描无命中；扫描目标为已知 API key 与账号字面量，文档中不记录原始敏感字符串。

剩余问题
  尚未接入真实重绘业务调用端，因此实际运行时仍需要后续把当前 panel metadata、referenced assets 和源图上下文传入 NP_STORYBOARD_EDIT。
  storyboard_edit 仍返回图片结果，不输出结构化 change_summary、updated_prompt 或 continuity_delta；如果后续要做审计式重绘记录，需要另开结构化 schema。
  尚未用真实 FrameOS TEST 重绘样例做 live 对标。
```

2026-06-14 FrameOS image prompt no-visible-text 追加记录：

```text
本轮目的
  修正 image_prompt_modify 中英文模板对画面文字的约束不一致。
  英文模板没有显式 no_visible_text；中文模板旧规则允许根据原文语言把医院名等文字画入画面，这会和 single_panel_image、storyboard_edit、video_prompt 的无字幕/无可见文字生产契约冲突。
  本轮只做 prompt/template/test 回归，不新增运行时规则检查。

影响链路
  image_prompt_modify prompt:
    英文模板新增 no_visible_text 规则。
    中文模板移除“如果画面内容里面出现文字就输出具体文字提示词”的旧规则。
    中英文统一要求 image_prompt 和 visual_prompt 不得新增画面文字、字幕、标题卡、标牌文字、UI 文字、标签、logo、水印或书写符号。
    如果 source_text 或 voice_refs 包含文字信息，只在 source_text、voice_refs、continuity_notes 或 video_prompt 的对白状态中保留语义，不把文字画入 image_prompt/visual_prompt。

  regression:
    prompt-json-canary guard 将 no_visible_text 纳入 image_prompt_modify 双语模板 token 检查。
    prompt semantic regression 同步检查 no_visible_text。
    image-prompt-modify-template 单测检查中英文模板都包含 no_visible_text。

样例输入输出
  单测继续使用 Ari、workshop_day、brass_key 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/image-prompt-modify-template.test.ts 通过。
  精确敏感信息扫描无命中；扫描目标为已知 API key 与账号字面量，文档中不记录原始敏感字符串。

剩余问题
  仍未新增 zh 专属语义 token map；当前 no_visible_text 通过双语模板 guard 和英文 semantic guard 覆盖。
  还未处理 agent_shot_variant_analysis.zh 中“动作前/后一刻”可能导致新剧情节点的问题。
  未用真实 FrameOS TEST 重绘改写样例做 live 对标。
```

2026-06-14 FrameOS shot variant still-frame/no-new-beat 追加记录：

```text
本轮目的
  收紧 agent_shot_variant_analysis 的镜头变体契约，避免中文模板中的“动作前/后”把变体推成新的剧情节点。
  同时补齐变体分析输出的 still-frame 侧字段，让变体建议不只给 video_prompt，也给 image_prompt、visual_prompt、referenced_assets 和 continuity_notes，便于后续图片生成、重绘改写和导出前检查消费。
  本轮只做 prompt/schema/test 回归，不改 UI，不新增运行时规则检查。

影响链路
  agent_shot_variant_analysis prompt:
    英文输出 schema 新增 image_prompt、visual_prompt、referenced_assets、continuity_notes。
    中文输出 schema 同步新增 image_prompt、visual_prompt、referenced_assets、continuity_notes，并更新字段说明和示例。
    中英文都要求 image_prompt/visual_prompt 描述同一 source_anchor 内的静帧构图，保留同一 referenced_assets、visual_style、道具状态和可见动作状态。
    中文模板将“时间/动作变化”改为“同一剧情锚点内的动作强调”，明确禁止生成动作发生前/后一刻的新剧情节点。
    光影变化只能在 visual_style / visual_style_description 已建立的风格内微调，不得改变时间、天气、地点或剧情事实。

  regression:
    prompt-json-canary guard 将 agent_shot_variant_analysis 的 image_prompt、visual_prompt、referenced_assets、continuity_notes 字段作为双语模板 token 检查。
    prompt semantic regression 同步检查这些输出字段和 same source_anchor 语义。
    shot-variant-analysis-template 单测检查中英文模板都包含 still-frame 输出字段，并继续验证 panel_context_json 渲染。

样例输入输出
  单测继续使用 Ari、workshop_day、brass_key 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/shot-variant-analysis-template.test.ts 通过。
  精确敏感信息扫描无命中；扫描目标为已知 API key 与账号字面量，文档中不记录原始敏感字符串。

剩余问题
  shot variant worker 目前仍原样透传 suggestions；UI 或后续生成链路是否消费 image_prompt/visual_prompt/referenced_assets/continuity_notes 还需要后续接入。
  creative_score 仍沿用旧的数字评分，没有扩展 production_risk 或 continuity_score。
  尚未用真实 FrameOS TEST 镜头变体输出做 live 对标。
```

2026-06-14 FrameOS storyboard insert video prompt grammar 追加记录：

```text
本轮目的
  补齐 agent_storyboard_insert 的插入镜头 video_prompt 生产语法。
  之前插入分镜虽然已经输出 FrameOS 式 panel 字段，但英文 schema 里的 video_prompt 只是占位字符串，中文模板也没有把插入镜头的动态提示词约束到“前后镜头之间的可见过渡”。
  本轮让插入镜头和普通生成/细化镜头使用同一套视频提示词语法，减少补镜头时新增剧情节点、丢失前后镜头连续性或生成字幕文字。

影响链路
  agent_storyboard_insert prompt:
    英文输出 schema 中 video_prompt 改为 visual subject + visible bridging action + referenced location/prop/character asset + camera movement + start/end state between previous and next panel + continuity constraint。
    英文规则新增：不要创建 new story beat，只桥接 prev_panel_json 和 next_panel_json 之间可见的 transition。
    英文规则新增：有 dialogue、narration 或 voice_refs 时，video_prompt 必须包含 lip-sync preparation，写明可见说话者或反应主体、正在说话/反应状态，并禁止字幕或可见文字。
    中文字段说明同步要求 video_prompt 采用“可视主体（visual subject）+ 可见过渡动作 + 被引用的场景/道具/角色资产 + 镜头运动 + 前后镜头之间的起止状态（start/end state）+ 连续性约束”。
    中文禁止规则新增：不得新增前后镜头都没有支持的新剧情节点；有 voice_refs 或台词时不得生成字幕/可见文字。

  regression:
    prompt-json-canary guard 将 agent_storyboard_insert 的 visual subject、start/end state、voice_refs、continuity_notes、duration 纳入双语模板 token 检查。
    prompt semantic regression 同步检查 visual subject、start/end state、lip-sync、new story beat 等英文语义锚点。
    新增 storyboard-insert-template 单测，验证中英文模板包含桥接 video_prompt 语法，并能渲染 prev_panel_json、next_panel_json、用户指令、角色/场景/道具上下文。

样例输入输出
  单测只使用 Ari、workshop_day、brass_key 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/prompt-i18n/storyboard-insert-template.test.ts tests/unit/prompt-i18n/storyboard-video-prompt-template.test.ts 通过。
  精确敏感信息扫描无命中；扫描目标为已知 API key 与账号字面量，文档中不记录原始敏感字符串。

剩余问题
  插入分镜仍依赖 prev/next panel JSON 的现有字段质量；如果上游 panel 缺少真实 source_anchor、referenced_assets、voice_refs 或 continuity_notes，插入镜头只能保守桥接。
  text.worker 当前仍原样解析模型返回的插入 panel，不额外落库独立 visual_prompt/continuity_notes 之外的审计字段。
  尚未用真实 FrameOS TEST 插入镜头样例做 live 对标。
```

2026-06-14 FrameOS insert panel metadata bridge 追加记录：

```text
本轮目的
  将插入分镜模型输出的 FrameOS panel metadata 写回现有 actingNotes 载体。
  上一轮已要求 agent_storyboard_insert 输出 visual_prompt、source_anchor、referenced_assets、continuity_notes、voice_refs 等字段，但 text.worker 插入面板时只保存了 videoPrompt、description、location、characters、props、srtSegment、duration。
  本轮复用现有 _frameosPanelMetadata 机制，避免插入分镜落库后丢失后续图片生成、视频生成、台词匹配和导出前检查需要的生产证据。

影响链路
  text.worker insert_panel:
    handleInsertPanelTask 导出，便于 focused worker 单测覆盖。
    插入 panel 持久化前调用 buildPanelFrameOSMetadata。
    从模型输出读取 panel_id、panel_number、source_text、source_anchor、referenced_assets、visual_prompt、visual_style、visual_style_description、continuity_notes、voice_refs。
    使用 writePanelFrameOSMetadataToActingNotes 写入 actingNotes._frameosPanelMetadata。
    不新增数据库列，不改 UI，不新增运行时规则检查。

  regression:
    新增 insert-panel-frameos-metadata worker 单测。
    单测 mock 插入分镜 LLM 输出中的 FrameOS 字段，验证 create panel 时 actingNotes 包含 _frameosPanelMetadata、inserted-transition、visual_prompt、continuity_notes 和 brass_key。

样例输入输出
  单测只使用 Ari、workshop_day、brass_key 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/worker/insert-panel-frameos-metadata.test.ts 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  精确敏感信息扫描无命中；扫描目标为已知 API key 与账号字面量，文档中不记录原始敏感字符串。

剩余问题
  prev_panel_json 和 next_panel_json 当前仍主要从旧字段构造，尚未优先恢复相邻 panel 的 _frameosPanelMetadata。
  插入 panel 的 image_prompt 仍没有独立数据库列，只能通过 visual_prompt metadata 和 videoPrompt/imagePrompt 兼容链路间接消费。
  尚未用真实 FrameOS TEST 插入镜头输出做 live 对标。
```

2026-06-14 FrameOS insert neighbor metadata context 追加记录：

```text
本轮目的
  继续补齐插入分镜链路，让模型输入端也优先看到相邻镜头已持久化的 _frameosPanelMetadata。
  上一轮已把新插入 panel 的 FrameOS metadata 写回 actingNotes，但 prev_panel_json / next_panel_json 仍从旧字段构造，容易丢失 source_anchor、referenced_assets、visual_prompt、visual_style、continuity_notes、voice_refs 等关键证据。
  本轮在构造插入分镜 prompt 输入时恢复相邻 panel metadata，提高补镜头对前后镜头资产、原文、视觉风格、连续性和配音上下文的理解。

影响链路
  text.worker insert_panel:
    新增 buildInsertPanelNeighborJson。
    构造 prev_panel_json / next_panel_json 时优先读取 readPanelFrameOSMetadataFromActingNotes。
    输出给 prompt 的相邻 panel JSON 现在包含 panel_id、panel_number、image_prompt、visual_prompt、source_anchor、referenced_assets、visual_style、visual_style_description、continuity_notes、voice_refs。
    metadata 缺失时继续回退到旧字段：shotType、cameraMove、description、videoPrompt、location、characters、props、srtSegment。
    不新增数据库列，不改 UI，不新增运行时规则检查。

  regression:
    扩展 insert-panel-frameos-metadata worker 单测。
    新增断言：buildPrompt 收到的 prev_panel_json / next_panel_json 包含相邻 panel metadata 中的 panel_id、visual_prompt、source_anchor、continuity_notes、voice_refs。
    保留上一轮断言：新插入 panel 创建时 actingNotes 写入 _frameosPanelMetadata。

样例输入输出
  单测只使用 Ari、workshop_day、brass_key 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/worker/insert-panel-frameos-metadata.test.ts 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  精确敏感信息扫描无命中；扫描目标为已知 API key 与账号字面量，文档中不记录原始敏感字符串。

剩余问题
  buildInsertPanelNeighborJson 当前是 text.worker 内部 helper；后续若其他插入/重排入口也需要相邻上下文，可抽到 novel-promotion helper。
 插入分镜仍没有真实 FrameOS source_anchor offset，只能消费上游已保存的 source_anchor 或 srtSegment fallback。
 尚未用真实 FrameOS TEST 插入镜头输出做 live 对标。
```

2026-06-14 FrameOS screenplay anchor/art-direction persistence 追加记录：

```text
本轮目的
  修复剧本转换持久化阶段仍把 source_anchor 压成旧字符串的问题。
  同时把 screenplay_conversion 顶层 worlds/default_visual_style 映射为 FrameOS 式 art_direction，避免 frameos_screenwriter canary 只覆盖目标形状而运行时 clip.screenplay 没有对应 wrapper。
  本轮只做运行时结构化输出 mapper 和聚焦测试，不新增数据库列，不改 UI，不新增生产规则检查。

影响链路
  screenplay-convert worker:
    新增 source_anchor 对象规范化；当模型已输出 {start,end} 时保留对象，当模型缺失对象时从 clip.startText / clip.endText 构造 {start,end}。
    不再写入 "START ... END" 字符串锚点，后续 storyboard、asset reference 和 export review 可以消费结构化起止锚点。
    新增 art_direction mapper；当模型输出 worlds 或 default_visual_style 且缺少 art_direction 时，写入 flow_status、flow_id、current_label、derived_phase、default_world_label、worlds。
    clip_id/original_text 先写入 parsed screenplay，再执行 FrameOS metadata mapper，保证 art_direction.flow_id 可追溯到 clip id。

  regression:
    更新 screenplay-convert worker 单测，验证持久化到 NovelPromotionClip.screenplay 的 JSON 包含 source_anchor 对象和 art_direction wrapper。
    样例 worlds 使用 world_label、world_background、representative_frame、candidates、selected_style_anchor、preview_materials，贴近 FrameOS script review/worlds 结构。

样例输入输出
  单测继续使用 Project One、Hero、Old Town、Magic Watch 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/worker/screenplay-convert.test.ts 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  精确敏感信息扫描无命中；扫描目标为本轮改动 diff 中的密钥形态、账号片段和密码字面量，文档中不记录原始敏感字符串。

剩余问题
  episode_split 的 FrameOS items/scenes/source_anchor/reasoning 仍只在任务结果中部分保留，批量保存到 NovelPromotionEpisode 时仍缺少独立 metadata 载体。
  story-to-script deterministic fast paths 仍可能生成最小 screenplay wrapper，需要后续让它们复用同一套 source_anchor/art_direction/production context mapper。
 资产设定侧环境、物品、角色子形象和音色映射仍存在落库压扁问题；需要后续选择无 UI 泄漏、无数据库大迁移的 metadata 载体或最小迁移方案。
```

2026-06-14 FrameOS episode split metadata bridge 追加记录：

```text
本轮目的
  修复 episode_split 已要求输出 FrameOS items/scenes/source_anchor/reasoning，但任务结果和导入保存链路只保留 number/title/summary/content/wordCount 的断点。
  在不新增数据库列、不污染用户可见 description/novelText 的前提下，让分集解析元数据跟随 NovelPromotionEpisode 存活，为后续剧本复核、资产抽取、分镜 source_anchor 和导出检查提供结构化证据。

影响链路
  episode-split worker:
    EpisodeSplit 类型补充 episode_id、episode_number、estimatedWords、content_kilo、source_anchor、info_points、reasoning、status、scenes。
    SplitResponse 类型补充 status、steps、default_visual_style、script_kilo、adapted_kilo、analysis、validation。
    返回 episodes[] 时新增 frameosMetadata，保留 episode_id、episode_number、status、content_kilo、estimatedWords、source_anchor、info_points、reasoning、scenes、analysis、validation。

  episode metadata helper:
    新增 src/lib/novel-promotion/episode-frameos-metadata.ts。
    使用 _frameosEpisodeMetadata 私有 key 写入现有 speakerVoices JSON 载体。
    helper 只负责结构化读写，不新增生产规则检查，不解析或改写正文内容。

  smart import / batch save:
    SplitEpisode 类型新增 frameosMetadata。
    AI 分集自动保存、标记分割保存和最终确认保存都会携带 frameosMetadata。
    loadSavedEpisodes 会从 speakerVoices._frameosEpisodeMetadata 恢复 frameosMetadata，避免 pending 状态刷新后确认保存时丢元数据。
    episodes/batch route 创建 NovelPromotionEpisode 时把 frameosMetadata 写入 speakerVoices._frameosEpisodeMetadata，不写入 description 或 novelText。

  speaker voice compatibility:
    parseSpeakerVoiceMap 跳过以下划线开头的私有 key，避免把 _frameosEpisodeMetadata 当成真实发言人。
    新增 stringifySpeakerVoiceMapPreservingPrivateEntries，speaker-voice PATCH 写入音色绑定时保留 _frameosEpisodeMetadata。
    这样分集元数据可以和后续音色绑定共存在 speakerVoices JSON 中。

  regression:
    episode-split worker 单测断言 FrameOS items payload 会输出 frameosMetadata。
    episode-frameos-metadata helper 单测断言 metadata 可与 Narrator 音色 JSON 共存。
    provider-voice-binding 单测断言 parse 会忽略私有 key 且 stringify 会保留私有 key。
    speaker-voice provider contract 测试断言 PATCH 音色时不删除 _frameosEpisodeMetadata。
    episode-batch-frameos-metadata route 测试断言 batch 保存会把 frameosMetadata 写入 speakerVoices 私有 key。

样例输入输出
  测试只使用 START_MARKER/END_MARKER、Ari、Narrator、workshop_day 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/worker/episode-split.test.ts tests/unit/novel-promotion/episode-frameos-metadata.test.ts tests/unit/voice/provider-voice-binding.test.ts tests/integration/api/specific/speaker-voice-provider-contract.test.ts tests/integration/api/specific/episode-batch-frameos-metadata.test.ts 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  精确敏感信息扫描无命中；扫描目标为本轮改动 diff 中的密钥形态、账号片段和密码字面量，文档中不记录原始敏感字符串。

剩余问题
  speakerVoices 作为载体是兼容性桥接，不是最终最干净的数据模型；如果后续允许最小 Prisma 迁移，episode metadata 应迁到独立 JSON 字段。
  story-to-script fast paths 仍需复用 episode/source_anchor/art_direction mapper，避免绕过 LLM prompt 时生成旧式最小 screenplay。
 资产设定侧环境、物品、角色子形象和 voice_mapping 仍需要字段存活桥接，尤其是 variants、coverage、voice_source 和 selected material。
```

2026-06-14 FrameOS environment/item metadata bridge 追加记录：

```text
本轮目的
  修复环境和物品资产抽取后只保存 name/summary/description，导致 FrameOS 式 environment_id、item_id、int_ext、background、entrance、mood、base_ambience、coverage、prompt、variants 等字段丢失的问题。
  本轮仍不新增数据库列，不改 UI，不写真实 TEST 剧情内容；使用现有 LocationImage.availableSlots JSON 做兼容桥接，让资产元数据随首个 image slot 存活。

影响链路
  asset metadata helper:
    新增 src/lib/novel-promotion/asset-frameos-metadata.ts。
    buildEnvironmentFrameOSMetadata 读取 environment_id、name、int_ext、summary、description、background、entrance、mood、base_ambience、coverage_scenes、coverage_episodes、prompt、variants、design_image。
    buildItemFrameOSMetadata 读取 item_id、name、item_type、summary、description、background、significance、coverage_scenes、coverage_episodes、prompt、variants、design_image。

  availableSlots compatibility:
    location-available-slots 支持两种 JSON 形态：
      旧形态：["left side"]
      新形态：{"slots":["left side"],"_frameosAssetMetadata":{...}}
    parseLocationAvailableSlots 只返回 slots，不会把 _frameosAssetMetadata 当成可站位。
    readFrameOSAssetMetadataFromAvailableSlots 可读取私有 metadata。
    stringifyLocationAvailableSlotsWithFrameOSMetadata 用于需要持久化 FrameOS asset metadata 的新资产。

  persistence:
    seedProjectLocationBackedImageSlots 新增 frameosMetadata 参数；有 metadata 时写入 availableSlots 对象形态，没有 metadata 时保持旧数组形态。
    analyze-global-persist 的 environments/items 创建路径传入 environment/item metadata。
    analyze-novel 的 environments/items 创建路径传入 environment/item metadata。
    story-to-script-helpers 的 persistAnalyzedLocations / persistAnalyzedProps 同步传入 metadata，避免 story-to-script 快路径继续压扁资产字段。

  regression:
    新增 asset-frameos-metadata 单测，验证 environment/item metadata 构造和 availableSlots 私有 key 读写。
    扩展 analyze-novel worker 单测，验证环境和道具 image slot 的 availableSlots 内含 _frameosAssetMetadata。
    新增 story-to-script-helpers-assets 单测，验证 story-to-script 资产持久化 helper 同样保留 environment/item metadata。
    location-backed-assets 既有测试继续通过，证明没有 metadata 时 availableSlots 仍保持旧数组 JSON 形态。

样例输入输出
  测试只使用 workshop_day、brass key、START_MARKER 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/novel-promotion/asset-frameos-metadata.test.ts tests/unit/worker/analyze-novel.test.ts tests/unit/worker/story-to-script-helpers-assets.test.ts tests/unit/assets/location-backed-assets.test.ts tests/unit/worker/panel-image-task-handler.test.ts 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  精确敏感信息扫描无命中；扫描目标为本轮改动 diff 中的密钥形态、账号片段和密码字面量，文档中不记录原始敏感字符串。

剩余问题
  availableSlots 私有 key 是兼容桥接，不是最终理想数据模型；如果后续允许最小 Prisma 迁移，应给 NovelPromotionLocation 或 LocationImage 增加独立 metadata JSON 字段。
  角色子形象虽然 profileData 保存 variants/expected_appearances，但 CharacterAppearance 行本身仍没有 variant_id/coverage/prompt 的直接映射。
 voice_mapping 仍主要停留在 prompt/canary 层，尚未形成自动写入角色 voice fields 或 episode speakerVoices 的任务。
```

2026-06-14 FrameOS character appearance metadata bridge 追加记录：

```text
本轮目的
  修复角色 profileData 已保存 expected_appearances / variants，但确认角色档案生成 CharacterAppearance 行时只保存 changeReason/descriptions，导致 variant_id、coverage、variant prompt 无法随子形象行追溯的问题。
  本轮不新增数据库列，不改 UI，不写真实 TEST 剧情；使用 CharacterAppearance.descriptions 的兼容 JSON 对象形态保存私有 metadata。

影响链路
  character appearance metadata helper:
    新增 src/lib/novel-promotion/character-appearance-frameos-metadata.ts。
    descriptions 兼容两种形态：
      旧形态：["primary look","variant look"]
      新形态：{"values":["primary look"],"_frameosAppearanceMetadata":{...}}
    parseCharacterDescriptionValues 会同时读取旧数组和新对象 values。
    readFrameOSAppearanceMetadataFromDescriptions 读取 _frameosAppearanceMetadata。
    stringifyCharacterDescriptionsWithFrameOSMetadata 写入 values + metadata，metadata 为空时仍输出旧数组。
    buildCharacterAppearanceFrameOSMetadata 根据视觉输出 appearance.id/change_reason、profile.expected_appearances 和 profile.variants 匹配 appearance_id、appearance_index、coverage_episodes、variant_id、variant_type、label、prompt、coverage_scenes。

  character-profile worker:
    handleConfirmProfile 在创建 CharacterAppearance 行时，为每个 appearance 写入 _frameosAppearanceMetadata。
    metadata 随 descriptions 存活，不污染 description 主字段，也不改变 imageUrls / selectedIndex。

  compatibility readers/writers:
    image-task-handler-shared.parseJsonStringArray 改为读取 parseCharacterDescriptionValues，角色生图仍能读取新对象形态。
    description-fields 在编辑单条描述时保留 _frameosAppearanceMetadata。
    asset-prompt-context、text.worker 插入分镜上下文、storage signed-url 序列化、super-agent chat-edit 和 asset-actions 主要读写点都改为兼容 values + metadata。
    asset-actions 在确认/修改角色 variant 描述时尽量保留已有 _frameosAppearanceMetadata。

  regression:
    新增 character-appearance-frameos-metadata 单测，验证 metadata 与 values 共存且旧数组仍可读取。
    新增 description-fields 单测，验证编辑单条描述时保留 metadata。
    扩展 character-profile worker 单测，验证确认角色档案时写入 variant_id、coverage、prompt。
    character-image-task-handler、asset prompt context、asset mappers 相关聚焦测试继续通过，证明新 descriptions 形态不破坏主要读取链路。

样例输入输出
  测试只使用 Hero、rain coat、workshop/scene 等人工通用占位数据。
  未读取或写入 FrameOS TEST 原始剧情、.runtime raw 响应正文或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/novel-promotion/character-appearance-frameos-metadata.test.ts tests/unit/assets/description-fields.test.ts tests/unit/worker/character-profile.test.ts tests/unit/worker/character-image-task-handler.test.ts tests/unit/assets/mappers.test.ts tests/unit/assets/prompt-context.test.ts 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx tsc --noEmit --pretty false 通过。
  git diff --check 通过。
  精确敏感信息扫描无命中；扫描目标为本轮改动 diff 中的密钥形态、账号片段和密码字面量，文档中不记录原始敏感字符串。

剩余问题
  descriptions 私有对象形态仍是兼容桥接；最终理想方案是给 CharacterAppearance 增加独立 metadata JSON 字段。
  仍有少数较老的 API route 直接 JSON.parse descriptions 并写回数组，后续如果进入这些路径可能丢 metadata；本轮优先覆盖了核心生成、编辑 helper 和资产上下文读取。
  voice_mapping 仍未接入自动写入角色 voice fields 或 episode speakerVoices。
```

2026-06-14 FrameOS voice_mapping character voice fields bridge 追加记录：

```text
本轮目的
  将 FrameOS 资产设定输出里的 voice_mapping 从 prompt/canary 层推进到可执行的角色音色字段绑定。
  本轮只做最小字段桥接，不新增数据库列、不改 UI、不接真实试听生成、不写入 episode speakerVoices。

影响链路
  voice mapping helper:
    新增 src/lib/novel-promotion/voice-mapping-binding.ts。
    buildCharacterVoiceMappingUpdates 接收独立 voice_mapping 数组或包含 voice_mapping 的对象。
    角色匹配顺序为本地角色行 id、角色名、aliases；FrameOS external character_id 不会被当成本地 id 强行写入。
    library_match 选择 is_selected=true 且有 voice_id 的候选；没有 selected 时选择 rank 最小且有 voice_id 的候选。
    library_match 写入 voiceType=qwen-designed、voiceId=候选 voice_id，并清空 customVoiceUrl/customVoiceMediaId。
    custom_upload 只在 voice_raw_file 非空时写入 voiceType=uploaded、customVoiceUrl=voice_raw_file，并清空 voiceId/customVoiceMediaId。
    unmatched、缺失 voice_id、缺失 voice_raw_file 或找不到角色时返回 skipped，不编造 voice id、音频路径或角色行。

  analyze-novel worker:
    保存新角色后，如果角色分析结构化响应包含 voice_mapping，则构造现有角色和新建角色的目标列表并调用 helper。
    没有 voice_mapping 字段时不增加额外数据库写入，保持旧行为。
    该接入点可消化 FrameOS 式完整资产包中随角色资产同返的 voice_mapping；独立 NP_VOICE_MAPPING 任务仍待后续接入。

样例输入输出
  单测只使用 Ari、Mika、Nia、workshop 等人工通用占位数据。
  未读取、写入或提交 FrameOS TEST 原始剧情、.runtime raw 响应正文、账号信息或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/novel-promotion/voice-mapping-binding.test.ts tests/unit/worker/analyze-novel.test.ts 通过。
  npx tsc --noEmit --pretty false 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  git diff --check 通过。
  严格敏感信息扫描无命中；扫描目标为本轮新增代码、测试和本轮文档尾部的密钥形态、账号片段、密码字面量和 bearer token。

剩余问题
  NP_VOICE_MAPPING 目前仍没有独立 worker/route 触发和持久化入口；本轮只让包含 voice_mapping 的资产分析响应可自动写入角色 voice fields。
  auditions 仍只作为结构契约保留，尚未接入试听任务创建、试听音频落库或 selected material 保存。
  episode.speakerVoices 的批量自动绑定仍未实现；当前桥接只处理角色资产库 voiceId/customVoiceUrl 字段。
```

2026-06-14 FrameOS export preflight LLM runtime helper 追加记录：

```text
本轮目的
  将已注册的 export_preflight_review prompt 从纯模板/canary 推进到可调用的 LLM 运行时 helper。
  本轮不新增确定性导出规则检查器，不新增任务类型，不改 UI；只整理现有工作流上下文、渲染 prompt、调用分析模型并解析结构化 JSON。

影响链路
  export preflight runtime helper:
    新增 src/lib/novel-promotion/export-preflight-review.ts。
    buildExportPreflightPromptPayload 接收 episodes、characters、locations、storyboards、panels、voiceLines 等现有数据，构造 export_target、episodes_json、assets_json、storyboard_json、voice_json。
    panel 输入会读取 actingNotes 内的 _frameosPanelMetadata，把 panel_id、source_text、source_anchor、referenced_assets、visual_prompt、visual_style、continuity_notes、voice_refs 放入 storyboard_json。
    assets_json 保留角色 profile、profile_confirmed、voice_id、voice_type、custom_voice_url，以及环境/物品图片、availableSlots 和 _frameosAssetMetadata。
    voice_json 保留 voice line 的 audio_url、matched_panel_id、matched_storyboard_id、matched_panel_index、speaker_voices，并用音频存在与否标记 generated/pending 作为模型审核证据。
    runExportPreflightReview 使用 NP_EXPORT_PREFLIGHT_REVIEW 模板，action=export_preflight_review，temperature=0.2，maxTokens=4096，模型由调用方传入，兼容 lumina::gpt-5.5。
    parseExportPreflightReview 只做 JSON object 解析，不生成或硬编码 missing_image/missing_video 等质检结论。

样例输入输出
  单测只使用 Ari、Workshop、brass key、panel-1 等人工通用占位数据。
  未读取、写入或提交 FrameOS TEST 原始剧情、.runtime raw 响应正文、账号信息、API key 或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/novel-promotion/export-preflight-review.test.ts tests/unit/prompt-i18n/export-preflight-review-template.test.ts 通过。
  npx tsc --noEmit --pretty false 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  git diff --check 通过。
  严格敏感信息扫描无命中；扫描目标为本轮新增 helper、测试和架构记录 diff 中的密钥形态、账号片段、密码字面量和 bearer token。

剩余问题
  该 helper 尚未挂到独立 API route、worker task 或导出队列按钮；后续只需薄入口传入项目快照和模型键。
  当前 helper 不拉取数据库，调用方需要提供已授权的项目数据；如后续新增 route，应复用 requireProjectAuthLight 并避免把审核结果写入原始剧情字段。
  仍未用真实 FrameOS TEST 导出前检查输出 live 对标 severity、issue code、next_actions 排序细节。
```

2026-06-14 FrameOS export preflight API route 追加记录：

```text
本轮目的
  在不新增确定性规则检查、不新增 task type、不改 UI 的前提下，为 export_preflight_review LLM helper 增加一个可调用的授权 API 入口。
  目标是让工作流可以用真实项目快照触发导出前质检 prompt，继续向 FrameOS 式“导出前工作流阶段审核”靠近。

影响链路
  API route:
    新增 src/app/api/novel-promotion/[projectId]/export-preflight-review/route.ts。
    POST 支持 body.episodeId、body.exportTarget、body.model，query locale=en 时使用英文模板，否则默认中文模板。
    route 使用 requireProjectAuthLight 做项目授权，不读取或写入任何登录凭据、API key 或测试文档正文。
    route 查询 NovelPromotionProject 的 characters、locations.images、episodes.voiceLines、episodes.storyboards.clip、episodes.storyboards.panels，作为 runExportPreflightReview 的输入。
    模型选择复用 resolveAnalysisModel，优先 body.model，其次项目 analysisModel、用户偏好，最后 fallback 到 lumina::gpt-5.5。
    返回 success、model、review、promptPayload、reasoning；本轮不持久化 review，避免污染剧本文本或资产字段。

  regression:
    新增 tests/integration/api/specific/export-preflight-review-route.test.ts。
    测试覆盖 route 会收集项目快照、传入模型键和 locale、调用 runExportPreflightReview，并返回 LLM review JSON。
    测试覆盖指定 episodeId 不存在时返回 NOT_FOUND 且不会调用 LLM helper。

样例输入输出
  测试只使用 Ari、Workshop、panel-1、voice-line-1 等人工通用占位数据。
  未读取、写入或提交 FrameOS TEST 原始剧情、.runtime raw 响应正文、账号信息、API key 或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/integration/api/specific/export-preflight-review-route.test.ts tests/unit/novel-promotion/export-preflight-review.test.ts 通过。
  npx tsc --noEmit --pretty false 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  git diff --check 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/guards/api-route-contract-guard.test.ts tests/unit/guards/changed-file-test-impact-guard.test.ts 通过。
  严格敏感信息扫描无命中；扫描目标为本轮新增 route、helper、测试和架构记录 diff 中的密钥形态、账号片段、密码字面量和 bearer token。

剩余问题
  route 当前是同步调用，尚未任务化；如果导出前检查在大项目上变慢，后续应接入任务队列和前端进度流。
  尚未接入导出按钮或导出队列 UI；需要前端在导出前调用该 route 并展示 review。
  仍未用真实 FrameOS TEST 输出 live 对标导出前检查的字段细节和 issue 排序。
```

2026-06-14 FrameOS voice_mapping LLM route 追加记录：

```text
本轮目的
  将 voice_mapping 从 prompt/canary 与 analyze-novel 顺带桥接，推进到可独立调用的 LLM 工作流阶段。
  本轮不新增确定性音色匹配规则，不新增 task type，不改 UI；只整理角色、台词样本和用户音色库上下文，调用 NP_VOICE_MAPPING，并可选择把 LLM 选中的绑定应用到角色 voice fields。

影响链路
  voice mapping runtime helper:
    新增 src/lib/novel-promotion/voice-mapping-runtime.ts。
    buildVoiceMappingPromptPayload 构造 characters_json、dialogue_samples_json、voice_library_json。
    characters_json 来自项目角色与 profileData，保留 role_type、role_level、gender、age_range、voice_trait、representative_line、voice_audition_prompt、speech_rate、voice_id、voice_raw_file、existing_voice_type。
    dialogue_samples_json 来自已分析 voiceLines，保留 episode_id、line_id、line_index、speaker/character、content、emotionPrompt、emotionStrength、matched_panel_id，也允许调用方追加外部结构化样本。
    voice_library_json 来自用户 GlobalVoice 音色库，保留 library_id、voice_id、voice_name、voice_type、description、voice_prompt、gender、language、reference_audio_id，也允许调用方追加外部结构化音色候选。
    runVoiceMappingReview 使用 NP_VOICE_MAPPING 模板，action=voice_mapping，temperature=0.2，maxTokens=4096，模型由调用方传入，兼容 lumina::gpt-5.5。
    parseVoiceMappingResponse 只解析 JSON object；实际音色选择交给 LLM 输出，不在运行时代码中按剧情词写规则。
    解析后复用 buildCharacterVoiceMappingUpdates 生成角色字段更新计划。

  API route:
    新增 src/app/api/novel-promotion/[projectId]/voice-mapping/route.ts。
    POST 支持 body.episodeId、body.model、body.apply、body.dialogueSamples、body.voiceLibrary，query locale=en 时使用英文模板，否则默认中文模板。
    route 使用 requireProjectAuthLight 做项目授权，查询项目 characters、episodes.voiceLines 和当前用户 globalVoice 音色库。
    模型选择复用 resolveAnalysisModel，优先 body.model，其次项目 analysisModel、用户偏好，最后 fallback 到 lumina::gpt-5.5。
    默认只返回 mapping、plan、promptPayload、reasoning；apply=true 时按 LLM 输出计划写入 NovelPromotionCharacter.voiceId/voiceType/customVoiceUrl/customVoiceMediaId。
    route 不写 speakerVoices，不创建 audition 任务，不生成或上传音频。

  regression:
    新增 tests/unit/novel-promotion/voice-mapping-runtime.test.ts。
    新增 tests/integration/api/specific/voice-mapping-route.test.ts。
    继续覆盖 voice-mapping-binding 与 voice-mapping-template，确保独立运行入口、prompt 渲染和字段更新计划保持一致。

样例输入输出
  测试只使用 Ari、Episode 1、voice-line-1、Clear Young Adult 等人工通用占位数据。
  未读取、写入或提交 FrameOS TEST 原始剧情、.runtime raw 响应正文、账号信息、API key 或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/novel-promotion/voice-mapping-runtime.test.ts tests/unit/novel-promotion/voice-mapping-binding.test.ts tests/integration/api/specific/voice-mapping-route.test.ts tests/unit/prompt-i18n/voice-mapping-template.test.ts 通过。
  npx tsc --noEmit --pretty false 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  git diff --check 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/guards/api-route-contract-guard.test.ts tests/unit/guards/changed-file-test-impact-guard.test.ts 通过。
  严格敏感信息扫描无命中；扫描目标为本轮新增 route、runtime helper、测试和架构记录 diff 中的密钥形态、账号片段、密码字面量和 bearer token。

剩余问题
  route 当前是同步调用，尚未任务化；大项目音色匹配后续应接入任务队列和进度流。
  auditions 仍只返回 LLM 结构，不创建试听任务、不生成试听音频、不保存 selected material。
  episode.speakerVoices 的批量自动绑定仍未实现；本轮只支持角色资产库 voice fields 的可选应用。
  仍未用真实 FrameOS TEST voice_mapping 输出 live 对标候选排序、audition 字段和 custom_upload 细节。
```

2026-06-14 FrameOS voice_mapping speakerVoices bridge 追加记录：

```text
本轮目的
  继续打通 voice_mapping 独立 LLM 阶段的下游落库，让同一份 LLM 输出可选写入分集 speakerVoices，供配音阶段按发言人直接取用。
  本轮不新增音色匹配规则，不生成试听音频，不创建 audition 任务；只把 LLM 已经输出的 library_match/custom_upload 结构转换为现有 provider voice JSON。

影响链路
  voice mapping binding helper:
    扩展 src/lib/novel-promotion/voice-mapping-binding.ts。
    新增 buildSpeakerVoiceMapFromVoiceMapping。
    library_match 使用 selectVoiceMappingCandidate 取得 LLM 选中的 voice_id，生成 {provider:"bailian", voiceType:"qwen-designed", voiceId}。
    custom_upload 使用 voice_raw_file，生成 {provider:"fal", voiceType:"uploaded", audioUrl}。
    unmatched、缺失 voice_id、缺失 voice_raw_file、非当前分集发言人只进入 skipped，不编造音色或音频。

  voice mapping API route:
    src/app/api/novel-promotion/[projectId]/voice-mapping/route.ts 新增 body.applySpeakerVoices。
    apply=true 仍只写 NovelPromotionCharacter voice fields。
    applySpeakerVoices=true 时，按每集 voiceLines 的 speaker 列表限定写入范围，避免把本集未出现角色写入 episode.speakerVoices。
    写入 episode.speakerVoices 时复用 parseSpeakerVoiceMap 与 stringifySpeakerVoiceMapPreservingPrivateEntries，保留 _frameosEpisodeMetadata 等私有 key，并保留已有手动 speaker voice entry。
    route 响应新增 speakerVoicesApplied 与 speakerVoicePlans，便于调用端展示哪些分集 speaker 绑定已应用、哪些被 skipped。

  regression:
    扩展 tests/unit/novel-promotion/voice-mapping-binding.test.ts，覆盖 library_match 与 custom_upload 转换到 speaker voice provider JSON。
    扩展 tests/integration/api/specific/voice-mapping-route.test.ts，覆盖 applySpeakerVoices=true 时写入 episode.speakerVoices 且保留 _frameosEpisodeMetadata 和既有 speaker entry。

样例输入输出
  测试只使用 Ari、Nia、Mika、Episode 1、voice-line-1、Clear Young Adult 等人工通用占位数据。
  未读取、写入或提交 FrameOS TEST 原始剧情、.runtime raw 响应正文、账号信息、API key 或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/novel-promotion/voice-mapping-binding.test.ts tests/unit/novel-promotion/voice-mapping-runtime.test.ts tests/integration/api/specific/voice-mapping-route.test.ts tests/unit/prompt-i18n/voice-mapping-template.test.ts 通过。
  npx tsc --noEmit --pretty false 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  git diff --check 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/guards/api-route-contract-guard.test.ts tests/unit/guards/changed-file-test-impact-guard.test.ts 通过。
  严格敏感信息扫描无命中；扫描目标为本轮 voice_mapping route、binding helper、测试和架构记录 diff 中的密钥形态、账号片段、密码字面量和 bearer token。

剩余问题
  auditions 仍只返回 LLM 结构，不创建试听任务、不生成试听音频、不保存 selected material。
  route 当前仍是同步调用，尚未任务化；大项目音色匹配后续应接入任务队列和进度流。
  仍未用真实 FrameOS TEST voice_mapping 输出 live 对标候选排序、audition 字段、custom_upload 和 speakerVoices 写入细节。
```

2026-06-14 FrameOS voice_mapping metadata bridge 追加记录：

```text
本轮目的
  补齐 voice_mapping 独立 LLM 阶段的轻量元数据落点，让 LLM 输出的 mapping/auditions/plan/reasoning 可随分集保存，供后续试听、导出前检查或前端复盘读取。
  本轮不新增音色匹配规则，不创建 audition 任务，不生成试听音频，不保存 promptPayload 或原始 LLM text；只保存结构化 voice_mapping 草稿。

影响链路
  voice mapping metadata helper:
    新增 src/lib/novel-promotion/voice-mapping-metadata.ts。
    使用 _frameosVoiceMappingMetadata 作为 episode.speakerVoices 内的私有 key。
    buildVoiceMappingFrameOSMetadata 只抽取 status、voice_mapping、auditions、plan、reasoning。
    readVoiceMappingFrameOSMetadataFromSpeakerVoices 支持从 speakerVoices JSON 中读取结构化草稿。
    writeVoiceMappingFrameOSMetadataToSpeakerVoices 会保留既有 speaker entry 和 _frameosEpisodeMetadata 等私有 key；metadata=null 时只移除 _frameosVoiceMappingMetadata。

  voice mapping API route:
    src/app/api/novel-promotion/[projectId]/voice-mapping/route.ts 新增 body.storeMappingMetadata。
    apply=true 或 applySpeakerVoices=true 时默认同时保存 voice mapping metadata，保证角色字段/说话人绑定和 LLM 草稿可追溯。
    storeMappingMetadata=true 可只保存 metadata，不写新的 speaker voice provider 绑定。
    applySpeakerVoices=true 时仍按分集 voiceLines speaker 范围生成 provider binding；metadata 写入不改变该 speaker 限定逻辑。
    route 响应新增 mappingMetadataStored，并在 speakerVoicePlans 中标记 metadataStored，便于调用端区分“已应用 voice binding”和“仅保存 LLM 草稿”。

  regression:
    新增 tests/unit/novel-promotion/voice-mapping-metadata.test.ts。
    扩展 tests/integration/api/specific/voice-mapping-route.test.ts，覆盖 applySpeakerVoices=true 时同步保存 _frameosVoiceMappingMetadata，以及 storeMappingMetadata=true 时只保存 metadata、不写 Ari speaker binding。

样例输入输出
  测试只使用 Ari、Narrator、Episode 1、voice-line-1、Clear Young Adult 等人工通用占位数据。
  未读取、写入或提交 FrameOS TEST 原始剧情、.runtime raw 响应正文、账号信息、API key 或桌面测试文档正文。

验证
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/novel-promotion/voice-mapping-metadata.test.ts tests/unit/novel-promotion/voice-mapping-binding.test.ts tests/unit/novel-promotion/voice-mapping-runtime.test.ts tests/integration/api/specific/voice-mapping-route.test.ts tests/unit/prompt-i18n/voice-mapping-template.test.ts 通过。
  npx tsc --noEmit --pretty false 通过。
  node scripts/guards/prompt-json-canary-guard.mjs 通过。
  node scripts/guards/prompt-semantic-regression.mjs 通过。
  npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run --exclude '.worktrees/**' tests/unit/guards/api-route-contract-guard.test.ts tests/unit/guards/changed-file-test-impact-guard.test.ts 通过。
  git diff --check 通过。
  严格敏感信息扫描无命中；扫描目标为本轮新增 metadata helper、voice_mapping route/test、架构记录 diff 中的密钥形态、账号片段、密码字面量和 bearer token。

剩余问题
  auditions 仍只作为 LLM 结构化草稿保存，不创建试听任务、不生成试听音频、不保存 selected material。
  route 当前仍是同步调用，尚未任务化；大项目音色匹配后续应接入任务队列和进度流。
  仍未用真实 FrameOS TEST voice_mapping 输出 live 对标候选排序、audition 字段、custom_upload、metadata 展示和 speakerVoices 写入细节。
```
