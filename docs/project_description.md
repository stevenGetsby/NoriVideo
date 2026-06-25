# Project Description

## Overall Description

NoriVideo 是一个基于 Next.js、React、TypeScript 的 AI 视频创作与运营工作台。项目围绕「项目 / 剧集 / 角色 / 场景 / 分镜 / 任务」组织内容，支持从文本或剧本导入、AI 剧本拆解、资产抽取、分镜生成、图片/视频/配音/唇形同步生成，到任务队列管理、资产归档、计费统计和运行状态恢复的一整套工作流。

运行形态上，前端页面和 API 由 Next.js App Router 承载；长耗时 AI 与媒体生成任务通过 Redis + BullMQ 进入 Worker；MySQL + Prisma 保存项目、任务、GraphRun、媒体对象、计费和用户配置；对象存储抽象支持 TOS、MinIO/S3 兼容存储和本地开发存储。Docker 部署时，`app` 容器同时启动 Next.js、Worker、Watchdog 和 Bull Board，并依赖 `mysql`、`redis` 服务。

## Module Structure

### Web App and API Layer (`src/app`)

1. 模块的核心职责：
   - 承载 Next.js App Router 页面、国际化路由和后端 API，是用户操作、项目工作区、资产中心、任务查询、运行流和配置管理的入口。
2. 由谁在什么时候使用？
   - 终端用户通过 `/zh/home`、`/zh/workspace`、`/zh/profile`、`/zh/super-agent`、`/zh/video-enhance` 等页面使用。
   - 前端页面在创建项目、提交生成任务、查询任务状态、读取运行事件、配置模型或存储时调用 `/api/*`。
3. 如何使用
   - 本地开发：`npm run dev`，访问 `http://localhost:3000/zh/workspace`。
   - 查询任务示例：`GET /api/tasks?projectId=<projectId>&status=running&limit=20`。
   - 创建 GraphRun 示例：`POST /api/runs`，传入 `projectId`、`workflowType`、`targetType`、`targetId` 和可选 `input`。
4. 实现细节
   - 页面位于 `src/app/[locale]/*`，API 位于 `src/app/api/*`。
   - 主要 API 包括 `projects`、`novel-promotion`、`asset-hub`、`tasks`、`runs`、`storage/sign`、`super-agent`、`user`、`video-enhance`。
   - API 层通过 `requireUserAuth`、`requireProjectAuthLight`、`apiHandler`、`ApiError` 做认证和错误归一化，并委托 `src/lib/*` 的服务模块执行业务逻辑。

### Project and Workflow Workspace (`src/lib/projects`, `src/lib/workflow`, `src/app/[locale]/workspace`, `src/app/[locale]/workflow`)

1. 模块的核心职责：
   - 管理视频项目、项目创建配置、工作流阶段状态、项目导航状态和工作区页面。
2. 由谁在什么时候使用？
   - 用户创建、进入、编辑项目时使用。
   - API 在处理 `/api/projects`、`/api/workflow/projects`、`/api/projects/[projectId]/workflow-state` 等请求时使用。
3. 如何使用
   - 创建项目示例：在工作区页面提交项目名称、描述和可选剧本文本/文件，后端 `/api/projects` 会解析请求并创建项目。
   - 工作流页面示例：访问 `/zh/workflow/<projectId>` 或 `/zh/workspace` 进入阶段化制作流程。
4. 实现细节
   - `src/app/api/projects/route.ts` 支持 JSON 与 multipart 表单，并可从 txt、docx、文本型 pdf 中提取初始剧本文本。
   - Prisma 中的 `Project`、`WorkflowStageState`、`Canvas`、`CanvasNode`、`CanvasEdge` 保存项目和工作台状态。
   - `docs/frameos-workflow-architecture.md` 描述了阶段化工作流：剧本解析、资产设定、分镜设计、镜头制作、导出交付。

### Novel Promotion and Video Production (`src/lib/novel-promotion`, `src/app/api/novel-promotion`)

1. 模块的核心职责：
   - 提供短剧/小说推文视频生产能力，包括剧本分析、分集、角色/场景/道具/音色抽取、分镜、图片、视频、配音、唇形同步和导出。
2. 由谁在什么时候使用？
   - 用户在项目工作区执行剧本拆解、资产设定、分镜制作、镜头生成和导出时使用。
   - Super Agent 或工作流编排层在后台调用这些能力完成阶段任务。
3. 如何使用
   - 剧本分析示例：`POST /api/novel-promotion/<projectId>/analyze`。
   - 生成分镜示例：调用 `/api/novel-promotion/<projectId>/script-to-storyboard-stream` 或相关 storyboard API。
   - 生成媒体示例：`POST /api/novel-promotion/<projectId>/generate-image`、`generate-video`、`voice-generate`。
4. 实现细节
   - 主要数据模型包括 `NovelPromotionProject`、`NovelPromotionEpisode`、`NovelPromotionClip`、`NovelPromotionStoryboard`、`NovelPromotionPanel`、`NovelPromotionCharacter`、`NovelPromotionLocation`、`NovelPromotionVoiceLine`。
   - 业务代码分布在 `src/lib/novel-promotion/*`，包括 `asset-extraction`、`script-format`、`story-to-script`、`script-to-storyboard`、`run-stream`。
   - API 目录下按项目 ID 拆分大量子路由，覆盖资产、分镜、视频、配音、导出和回滚/重试。

### Async Task System and Workers (`src/lib/task`, `src/lib/workers`, `scripts/watchdog.ts`, `scripts/bull-board.ts`)

1. 模块的核心职责：
   - 将图片、视频、语音、文本等长耗时操作封装为任务，写入数据库和 BullMQ 队列，由 Worker 消费并发布状态事件。
2. 由谁在什么时候使用？
   - API 层提交 AI/媒体生成任务时使用。
   - Worker 进程持续消费 Redis 队列；Watchdog 恢复或巡检异常任务；运维人员通过 Bull Board 查看队列。
3. 如何使用
   - 开发模式：`npm run dev:full` 同时启动 Next、Worker、Watchdog、Bull Board。
   - 生产模式：`npm run start` 或 Docker 中 `./docker-start.sh` 启动后台进程。
   - 查询任务示例：`GET /api/tasks?targetType=panel&targetId=<id>`。
4. 实现细节
   - `src/lib/workers/index.ts` 创建 image、video、voice、text 四类 Worker。
   - `src/lib/task/service.ts`、`submitter.ts`、`queues.ts`、`publisher.ts`、`state-service.ts` 管理任务提交、队列、状态和事件。
   - Prisma 中的 `Task`、`TaskEvent` 保存任务和事件；Redis 由 `REDIS_HOST`、`REDIS_PORT` 等环境变量配置。

### GraphRun Runtime (`src/lib/run-runtime`, `src/app/api/runs`)

1. 模块的核心职责：
   - 管理更高层的 workflow / GraphRun 执行状态，支持阶段推进、事件发布、租约、恢复、任务桥接和取消。
2. 由谁在什么时候使用？
   - 工作流页面、阶段化制作流程和部分后台编排在启动或恢复一个多步骤流程时使用。
   - 前端通过 `/api/runs`、`/api/runs/[runId]/events`、`/api/runs/[runId]/steps` 查询运行状态。
3. 如何使用
   - 创建运行示例：`POST /api/runs`，请求体包含 `projectId`、`workflowType`、`targetType`、`targetId`、`input`。
   - 查询运行示例：`GET /api/runs?projectId=<projectId>&workflowType=<type>&status=running`。
4. 实现细节
   - `src/lib/run-runtime/service.ts` 提供 `createRun`、`listRuns` 等服务。
   - `publisher.ts`、`workflow.ts`、`workflow-lease.ts`、`recovery.ts`、`reconcile.ts` 负责事件、租约、恢复与一致性。
   - Prisma 中的 `GraphRun`、`GraphStep`、`GraphStepAttempt`、`GraphEvent`、`GraphCheckpoint`、`GraphArtifact` 保存运行图和产物。

### Model Gateway, Providers, and Capabilities (`src/lib/model-gateway`, `src/lib/llm`, `src/lib/providers`, `standards`)

1. 模块的核心职责：
   - 统一模型调用入口，按用户/项目配置选择 provider 与模型，管理 OpenAI-compatible 和官方 provider 的调用差异，并通过能力、价格标准约束模型选择。
2. 由谁在什么时候使用？
   - AI 文本、图片、视频、音频、资产设计、分镜生成等能力调用模型时使用。
   - 用户在 profile/API 配置中心配置模型或测试 provider 时使用。
3. 如何使用
   - 配置模型后，业务代码通过模型网关调用，而不是在 API route 中直接调用 LLM。
   - 新增模型、能力或价格后运行：`npm run check:config-center-guards`。
4. 实现细节
   - `src/lib/model-gateway/router.ts`、`llm.ts`、`openai-compat/*` 处理模型路由和兼容协议。
   - `src/lib/providers/*` 包含 FAL、百炼、SiliconFlow、官方 provider 等适配。
   - `standards/capabilities`、`standards/pricing` 与 `scripts/check-*catalog*.mjs` 维护能力目录和价格目录。

### Media and Storage (`src/lib/media`, `src/lib/storage`, `src/app/api/storage/sign`)

1. 模块的核心职责：
   - 统一处理媒体对象、图片/视频/音频 URL 归一化、对象存储上传、签名 URL 和本地开发文件读取。
2. 由谁在什么时候使用？
   - AI 生成媒体、上传资产、选择/回滚图片、视频增强、导出和前端预览时使用。
   - 浏览器需要访问私有对象时通过签名接口使用。
3. 如何使用
   - 签名访问示例：`GET /api/storage/sign?key=<storageKey>&expires=3600`。
   - 本地开发可配置 `STORAGE_TYPE=local`；Docker/生产通常使用 TOS 或 MinIO/S3 兼容存储。
4. 实现细节
   - `src/lib/storage` 暴露存储抽象，`src/lib/storage/providers` 放具体 provider。
   - `src/app/api/storage/sign/route.ts` 调用 `getSignedObjectUrl`，失败时可回退读取本地 `UPLOAD_DIR`。
   - Prisma 中的 `MediaObject` 保存媒体对象；相关守卫包括 `check:media-normalization`、`check:no-media-provider-bypass`、`check:image-urls-contract`。

### Asset Hub and Project Assets (`src/app/api/asset-hub`, `src/app/api/assets`, `src/lib/assets`)

1. 模块的核心职责：
   - 管理全局资产和项目资产，包括角色、场景、声音、图片、文件夹、资产标签、变体、上传和 AI 修改/设计。
2. 由谁在什么时候使用？
   - 用户在资产中心或项目工作区复用角色、场景、声音和图片时使用。
   - 视频生成链路在绑定角色/场景图片、引用资产、归档生成结果时使用。
3. 如何使用
   - 全局角色示例：调用 `/api/asset-hub/characters`。
   - 项目资产示例：调用 `/api/projects/<projectId>/assets` 或 `/api/assets/<assetId>/variants`。
4. 实现细节
   - API 包含 `asset-hub`、`assets`、`projects/[projectId]/assets` 等路由。
   - Prisma 中的 `GlobalAssetFolder`、`GlobalCharacter`、`GlobalLocation`、`GlobalVoice`、`MediaObject` 支撑资产库。
   - `src/lib/assets` 和 `src/lib/asset-utils` 提供资产类型、服务和工具逻辑。

### Super Agent (`src/lib/super-agent`, `src/app/api/super-agent`, `skills`, `agent-skills`)

1. 模块的核心职责：
   - 将自然语言视频制作需求转为可执行计划，并调用项目、资产、任务和视频生产能力执行。
2. 由谁在什么时候使用？
   - 用户在 `/zh/super-agent` 或相关助手入口输入自然语言需求时使用。
   - 内部 API 在启用 agent 能力后生成 plan、执行 plan、读取技能列表。
3. 如何使用
   - 生成计划示例：`POST /api/super-agent/plan`，传入 `userInput`、`locale`、`executionMode`、`parameters`。
   - 技能资料位于 `skills/*.md` 和 `agent-skills/*.json`，用于约束不同视频类型的制作方法。
4. 实现细节
   - `src/app/api/super-agent/plan/route.ts` 调用 `SuperAgentOrchestrator.createExecutionPlan`。
   - `internal-api-guard` 和 `internal-run-visibility` 控制内部 agent API 和任务/运行可见性。
   - 该模块复用模型网关、任务系统、项目数据和 novel-promotion 能力，不单独重建视频生产系统。

### Billing, Cost, and User Configuration (`src/lib/billing`, `src/app/api/user`, `src/app/api/system/pricing`)

1. 模块的核心职责：
   - 管理用户余额、冻结、交易流水、使用成本、任务计费策略、模型配置和系统价格展示。
2. 由谁在什么时候使用？
   - 用户查看余额、成本和模型配置时使用。
   - 任务执行、模型调用和运维对账时使用。
3. 如何使用
   - 用户成本示例：`GET /api/user/costs` 或 `/api/user/costs/details`。
   - 运维脚本：`npm run billing:cleanup-pending-freezes`、`npm run billing:reconcile-ledger`。
   - 当前 Docker compose 默认 `BILLING_MODE=OFF`。
4. 实现细节
   - Prisma 中的 `UsageCost`、`UserBalance`、`BalanceFreeze`、`BalanceTransaction` 保存成本和账本。
   - `src/lib/billing` 提供金额、计费、冻结和对账逻辑。
   - 价格目录由 `standards/pricing` 和 `scripts/check-pricing-catalog.mjs` 守卫。

### Internationalization and UI Assets (`messages`, `src/i18n`, `public`)

1. 模块的核心职责：
   - 提供中文/英文文案、locale 路由和静态品牌/图片资源。
2. 由谁在什么时候使用？
   - 用户访问 `/zh/*` 或 `/en/*` 页面时使用。
   - UI 组件渲染文案、导航和提示时使用。
3. 如何使用
   - 中文页面路径示例：`/zh/workspace`。
   - 英文页面路径示例：`/en/workspace`。
4. 实现细节
   - `messages/zh`、`messages/en` 保存国际化文案。
   - `src/i18n.ts`、`src/i18n/*`、`middleware.ts` 处理 locale。
   - `public/` 保存 logo、banner、静态 SVG 和 nori-view 资源。

### Database and Persistence (`prisma`)

1. 模块的核心职责：
   - 定义项目、用户、任务、工作流、媒体、资产、计费和 FrameOS 兼容数据的数据库模型。
2. 由谁在什么时候使用？
   - API、Worker、GraphRun、计费和资产模块在读写业务数据时使用。
   - 开发/部署流程在同步数据库结构时使用。
3. 如何使用
   - 本地同步：`npx prisma db push`。
   - 构建时：`npm run build` 会执行 `prisma generate`。
   - Docker 启动时：`docker-compose.yml` 在 app 容器启动前执行 `npx prisma db push --skip-generate`。
4. 实现细节
   - 主 schema 位于 `prisma/schema.prisma`，另有 `schema.sqlit.prisma`。
   - 主要模型包括 `User`、`Project`、`NovelPromotion*`、`Task`、`GraphRun`、`MediaObject`、`UsageCost`、`Global*Asset`、`Frameos*`。
   - MySQL 连接由 `DATABASE_URL` 配置；Docker 默认使用 `mysql://root:nori123@mysql:3306/nori`。

### Deployment, Scripts, and Quality Guards (`Dockerfile`, `docker-compose.yml`, `scripts`, `tests`)

1. 模块的核心职责：
   - 提供本地开发、容器部署、Worker 构建、数据迁移、媒体迁移、计费对账、架构守卫和测试命令。
2. 由谁在什么时候使用？
   - 开发者本地启动和提交前验证时使用。
   - 运维或部署流程构建 Docker 镜像、启动依赖服务和执行迁移脚本时使用。
3. 如何使用
   - 本地基础服务：`docker compose up -d mysql redis`。
   - 完整容器启动：`docker compose up --build`。
   - 提交前验证：`npm run verify:commit`。
   - 推送前验证：`npm run verify:push`。
4. 实现细节
   - `Dockerfile` 分为 deps、builder、runner 三阶段，构建 Next.js 和 Worker bundle，生产镜像只复制运行产物。
   - `docker-compose.yml` 启动 MySQL、Redis 和 app，并暴露 `13000`、`13010`、`13306`、`16379`。
   - `scripts/docker-start.sh` 通过 `SERVICE_MODE=web|worker|watchdog|board|all` 控制启动进程。
   - `tests/` 包含 unit、integration、system、regression、contracts、concurrency 等测试；`scripts/guards` 包含 API、模型、媒体、任务和测试覆盖守卫。

## Main DAG Links

```text
用户浏览器 -> src/app/[locale] 页面 -> src/app/api/* API -> src/lib/* 服务 -> Prisma/MySQL
传递内容：页面交互、JSON/FormData 请求、认证会话、业务实体读写结果。

创建项目 -> /api/projects -> 项目校验与剧本文件解析 -> Project/NovelPromotionProject/初始导入字段 -> 工作区页面
传递内容：项目名称、描述、创建配置、txt/docx/pdf 剧本文本、项目 ID。

剧本导入 -> 剧本解析 -> 资产抽取 -> 分镜设计 -> 镜头制作 -> 导出交付
传递内容：原始剧本文本、分集/片段结构、角色/场景/道具/音色、分镜 panel、图片/视频/音频媒体、导出清单。

API 提交长任务 -> src/lib/task submitter/service -> BullMQ Redis 队列 -> src/lib/workers/* Worker -> Provider/Storage/Prisma -> /api/tasks 查询
传递内容：任务类型、目标对象、输入参数、队列 job、生成结果、任务状态、TaskEvent。

工作流启动 -> /api/runs -> GraphRun/GraphStep -> run-runtime lease/recovery/publisher -> run events/SSE -> 前端状态恢复
传递内容：workflowType、targetType、targetId、input、步骤状态、事件、checkpoint、artifact。

AI 能力调用 -> model-gateway router -> OpenAI-compatible 或官方 provider -> 生成文本/图片/视频/音频 -> media/storage 归一化 -> 项目资产绑定
传递内容：provider::modelId、提示词、能力参数、provider 响应、storageKey、MediaObject、业务引用。

媒体上传或生成 -> src/lib/media -> src/lib/storage provider -> TOS/MinIO/S3/local -> /api/storage/sign -> 浏览器预览/下载
传递内容：文件 buffer/URL、storageKey、签名 URL、媒体元数据。

自然语言需求 -> /api/super-agent/plan -> SuperAgentOrchestrator -> skills/agent-skills -> 执行计划 -> super-agent execute/项目任务
传递内容：userInput、locale、executionMode、技能约束、步骤计划、项目/任务调用参数。

Docker compose -> mysql/redis healthcheck -> app 容器 -> prisma db push -> docker-start.sh -> Next.js + Worker + Watchdog + Bull Board
传递内容：环境变量、数据库连接、Redis 连接、运行产物、服务端口和后台进程。
```

## Evidence

- `README.md`
- `docs/frameos-workflow-architecture.md`
- `docker-compose.yml`
- `Dockerfile`
- `scripts/docker-start.sh`
- `package.json`
- `prisma/schema.prisma`
- `src/app/api/projects/route.ts`
- `src/app/api/tasks/route.ts`
- `src/app/api/runs/route.ts`
- `src/app/api/super-agent/plan/route.ts`
- `src/app/api/storage/sign/route.ts`
- `src/lib/workers/index.ts`
- `src/lib/task/*`
- `src/lib/run-runtime/*`
- `src/lib/model-gateway/*`
