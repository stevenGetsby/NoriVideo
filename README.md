# NoriVideo

NoriVideo 是一个基于 Next.js 的 AI 视频创作与运营工作台。项目围绕「项目 / 剧集 / 角色 / 场景 / 分镜 / 任务」组织内容，支持从文本创作、分镜生成、图片与视频生成、配音、视频增强到任务队列管理的一整套工作流。

## 核心能力

- 视频项目工作区：创建项目、管理剧集、角色、场景、道具、分镜和画布内容。
- AI 内容生成：故事分析、剧本拆分、分镜生成、角色与场景设计、图片生成、视频生成、配音与唇形同步。
- 资产中心：统一管理角色、场景、图片、声音和项目资产，支持上传、选择、修改和复用。
- 模型配置中心：按用户和项目配置分析、图片、视频、音频等模型，并通过统一网关调用官方或 OpenAI-compatible Provider。
- 异步任务系统：使用 Redis + BullMQ 承载图片、视频、语音、文本等任务，并提供 Worker、Watchdog 和 Bull Board。
- 存储抽象：支持火山引擎 TOS、MinIO / S3 兼容存储、本地开发存储；COS 作为预留 Provider。
- 计费与成本：内置成本统计、余额、交易流水、任务计费策略和账本对账工具。
- 国际化：通过 `next-intl` 管理中文和英文消息。

## 技术栈

- Web：Next.js 15、React 19、TypeScript、Tailwind CSS 4
- 数据库：MySQL 8、Prisma
- 队列：Redis、BullMQ、Bull Board
- AI / Provider：OpenAI SDK、AI SDK、Google GenAI、OpenRouter、FAL、火山引擎相关能力
- 媒体：Remotion、Sharp、对象存储签名 URL
- 测试：Vitest、ESLint、自定义架构守卫脚本

## 目录结构

```text
src/app/                  Next.js App Router 页面与 API
src/components/           UI 组件、工作区组件、任务组件、配置弹窗
src/lib/                  业务服务、运行时、Provider、任务、存储、计费、日志
src/lib/workers/          BullMQ Worker 与任务处理器
src/lib/run-runtime/      GraphRun / workflow 运行时
src/lib/model-gateway/    统一模型调用网关
src/lib/storage/          TOS、MinIO、本地存储适配器
src/lib/billing/          计费、账本、成本统计
src/lib/super-agent/      自然语言视频制作助手
messages/                 国际化文案
prisma/                   Prisma schema
scripts/                  构建、迁移、守卫、诊断和运维脚本
skills/                   Super Agent 使用的视频制作技能说明
public/                   静态资源
```

## 环境要求

- Node.js 20，项目包含 `.nvmrc`
- npm
- Docker / Docker Compose，用于本地 MySQL、Redis、MinIO 或完整容器部署
- 可用的 MySQL 与 Redis
- 至少一种对象存储配置：TOS、MinIO 或 local
- 按需准备 AI Provider Key

## 本地开发

1. 安装依赖：

```bash
npm install
```

2. 准备环境变量：

```bash
cp .env.example .env
```

默认 `.env.example` 面向本地开发，数据库连接到 `localhost:13306`，Redis 连接到 `localhost:16379`。如果使用火山引擎 TOS，可参考 `.env.local.tos.example` 补充 `.env.local`。

3. 启动基础服务：

```bash
docker compose up -d mysql redis
```

4. 同步数据库结构：

```bash
npx prisma db push
```

5. 启动开发服务：

```bash
npm run dev
```

开发模式会同时启动：

- Next.js：`http://localhost:3000`
- Worker：处理异步任务
- Watchdog：恢复和巡检任务状态
- Bull Board：默认 `http://localhost:3010/admin/queues`

## Docker 部署

完整容器化启动：

```bash
docker compose up --build
```

默认端口：

- 应用：`http://localhost:13000`
- Bull Board：`http://localhost:13010/admin/queues`
- MySQL：宿主机 `13306`
- Redis：宿主机 `16379`

`docker-compose.yml` 会在容器内把 `DATABASE_URL` 指向 `mysql:3306`，把 Redis 指向 `redis:6379`，并在启动时执行 `prisma db push --skip-generate`。

如需 HTTPS，本项目提供 `caddyfile`，可在宿主机运行：

```bash
caddy run --config caddyfile
```

## 环境变量

主要变量按职责分组：

| 分组 | 变量 |
| --- | --- |
| 数据库 | `DATABASE_URL` |
| Redis | `REDIS_HOST`、`REDIS_PORT`、`REDIS_USERNAME`、`REDIS_PASSWORD`、`REDIS_TLS` |
| 认证 | `NEXTAUTH_URL`、`NEXTAUTH_SECRET` |
| 内部调用 | `INTERNAL_APP_URL`、`CRON_SECRET`、`INTERNAL_TASK_TOKEN`、`API_ENCRYPTION_KEY` |
| 存储 | `STORAGE_TYPE`、`TOS_*`、`MINIO_*`、`COS_*` |
| Worker | `WATCHDOG_INTERVAL_MS`、`TASK_HEARTBEAT_TIMEOUT_MS`、`QUEUE_CONCURRENCY_*` |
| Bull Board | `BULL_BOARD_HOST`、`BULL_BOARD_PORT`、`BULL_BOARD_BASE_PATH`、`BULL_BOARD_USER`、`BULL_BOARD_PASSWORD` |
| 日志 | `LOG_UNIFIED_ENABLED`、`LOG_LEVEL`、`LOG_FORMAT`、`LOG_REDACT_KEYS` |
| 计费 | `BILLING_MODE` |
| 流式输出 | `LLM_STREAM_EPHEMERAL_ENABLED` |

生产环境不要复用示例文件中的默认密钥。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 本地开发，同时启动 Next、Worker、Watchdog、Bull Board |
| `npm run build` | 生成 Prisma Client、构建 Next、打包 Worker |
| `npm run start` | 生产模式启动应用和后台进程 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint:all` | ESLint 检查 |
| `npm run test:unit:all` | 单元测试 |
| `npm run test:integration:api` | API 集成测试 |
| `npm run test:all` | 完整测试集合 |
| `npm run verify:commit` | 提交前校验 |
| `npm run verify:push` | 推送前校验，包含构建 |

## 主要页面

- `/zh/home`：首页 / 项目入口
- `/zh/workspace`：视频工作区
- `/zh/profile`：用户与配置
- `/zh/super-agent`：自然语言视频制作助手
- `/zh/video-enhance`：视频增强

英文路径使用 `/en/...`。

## API 模块

- `/api/projects`：项目与项目资产
- `/api/novel-promotion/*`：剧集、角色、场景、分镜、配音、图片和视频生成
- `/api/asset-hub/*`：全局资产中心
- `/api/tasks`：异步任务查询与管理
- `/api/runs`：工作流运行与事件流
- `/api/user/*`：用户模型配置、余额、成本、存储配置、助手聊天
- `/api/storage/sign`：对象存储签名
- `/api/video-enhance/*`：视频增强任务
- `/api/super-agent/*`：自然语言规划与执行

## 运行时架构

1. 前端页面调用 API 创建项目、配置模型或提交任务。
2. API 层校验权限、读取项目配置，并通过统一服务写入数据库。
3. 长耗时能力进入 BullMQ 队列，由 `src/lib/workers/` 中的 Worker 消费。
4. `run-runtime` 负责 GraphRun / workflow 的阶段推进、事件发布、租约和恢复。
5. 模型调用统一经过 `model-gateway`、`llm`、`providers` 和能力目录，避免 API 层直接绕过配置中心。
6. 生成结果通过 `media` 与 `storage` 模块落库、归一化 URL，并绑定到项目资产。
7. 前端通过任务状态、SSE 或 run events 更新工作区。

## 模型和 Provider 约定

- 模型配置使用 `provider::modelId` 复合 Key。
- 项目级配置优先，其次使用用户偏好。
- OpenAI-compatible Provider 走兼容网关；官方 Provider 走对应官方实现。
- 新增模型、能力或价格后，应运行配置中心相关守卫：

```bash
npm run check:config-center-guards
```

## 存储约定

- `STORAGE_TYPE=tos`：默认生产路径，适合需要公网对象 URL 的视频工作流。
- `STORAGE_TYPE=minio`：本地或私有 S3 兼容存储。
- `STORAGE_TYPE=local`：仅用于开发调试。

媒体 URL 和引用应通过 `src/lib/media/` 与 `src/lib/storage/` 统一处理，不要在业务代码中手写存储 URL。

## 测试和质量守卫

项目除了常规 lint、typecheck、Vitest，还包含多组架构守卫，例如：

- API route 合同检查
- 禁止 API 直接调用 LLM
- 禁止绕过媒体 Provider
- 模型配置与能力目录检查
- 图片引用归一化检查
- 任务状态和测试覆盖守卫

开发时按改动范围选择命令；影响任务、Provider、计费、媒体或 API 合同时，优先运行对应 `check:*` 和集成测试。

## 文档

- `README.md`：项目总文档和日常开发入口。
- `SUPER_AGENT_MVP.md`：Super Agent 专题说明。
- `skills/*.md`：视频制作技能说明，供 Super Agent 选择和解析。

新增文档应优先放在根 README 能索引到的位置，并避免复制环境变量、脚本列表等容易过期的信息。
