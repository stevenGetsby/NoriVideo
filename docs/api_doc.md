# NoriVideo API 接口文档

> 本文档由当前代码库 `src/app/api/**/route.ts` 梳理生成，覆盖所有已导出的 Next.js API Route 方法。统计口径：201 个 route 文件，266 个方法级接口。

## 通用约定

- Base URL：本地开发通常为 `http://localhost:3000`，Docker 部署默认为 `http://localhost:13000`。
- 认证：多数业务接口依赖 NextAuth 登录态；项目相关接口还会校验当前用户是否可访问 `{projectId}`。
- 错误响应：大多数 route 由 `apiHandler` 包装，错误通常为 JSON：`{ "error": { "code": "...", "message": "..." } }`，HTTP 状态码由错误类型决定。
- 异步任务响应：生成图片、视频、语音、文本工作流等接口通常立即返回 `{ "async": true, "taskId": "..." }`；后续通过 `/api/tasks/{taskId}`、`/api/tasks`、`/api/sse` 或 `/api/runs/{runId}/events` 查询进度。
- 路径参数：文档中 `{projectId}`、`{assetId}` 等对应 App Router 目录中的 `[projectId]`、`[assetId]`；`{path...}` 表示 catch-all 路径。
- 响应字段：复杂对象只列核心字段和语义；完整字段以当前 route/service 返回的业务对象为准。

## 接口总览

| 模块 | 接口数 | 说明 |
| --- | ---: | --- |
| 小说/短剧工作流接口 | 107 | novel-promotion |
| 全局资产中心接口 | 42 | asset-hub |
| 项目资产接口 | 12 | assets |
| 项目与画布接口 | 22 | projects |
| 工作流阶段接口 | 8 | workflow |
| 任务与运行时接口 | 12 | tasks-runs |
| 编剧工作台接口 | 11 | screenwriter |
| 用户配置、费用与偏好接口 | 22 | user |
| Super Agent 接口 | 4 | super-agent |
| 视频增强接口 | 6 | video-enhance |
| 认证接口 | 3 | auth |
| 系统、存储、文件与基础设施接口 | 17 | system-infra |

## 编剧工作台接口

编剧工作台前端只调用 `/api/screenwriter/*` 专用接口，不直接拼装 `/api/projects`、`/api/novel-promotion/*`、`/api/workflow/*`、`/api/runs/*` 或 `/api/tasks/*` 的原始结构。接口内部可复用认证、Prisma、Task、GraphRun、MediaObject 和 storage 等底层基础设施。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/screenwriter/tasks` | 查询当前用户的编剧工作台任务队列，支持 `status`、`taskKind`、`search`、`page`、`pageSize`。 |
| POST | `/api/screenwriter/video-repaint` | 创建视频转绘 2.0 任务，初始化源视频和 6 个阶段，返回 `{ id, title, nextRoute }`。 |
| GET | `/api/screenwriter/video-repaint/{taskId}` | 查询视频转绘任务详情，包括阶段状态、检查点产物、逐集进度和目标剧本摘要。 |
| PATCH | `/api/screenwriter/video-repaint/{taskId}` | 更新任务标题、转绘需求和检查点配置，并按需标记下游阶段为 stale。 |
| POST | `/api/screenwriter/video-repaint/{taskId}/stages/{stage}/run` | 运行指定阶段，将阶段置为 queued。 |
| POST | `/api/screenwriter/video-repaint/{taskId}/stages/{stage}/retry` | 重试 failed 或 stale 阶段，可带 `episodeNumber`。 |
| POST | `/api/screenwriter/video-repaint/{taskId}/stages/{stage}/approve` | 确认源设定或目标设定检查点，保存反馈并解锁下一阶段。 |
| POST | `/api/screenwriter/video-repaint/{taskId}/source-settings/regenerate` | 保存反馈并生成新版本源设定检查点。 |
| POST | `/api/screenwriter/video-repaint/{taskId}/target-settings/regenerate` | 保存反馈并生成新版本目标设定检查点。 |
| GET | `/api/screenwriter/video-repaint/{taskId}/target-script` | 查询目标剧本分集列表，可用 `episodeNumber` 过滤。 |
| PATCH | `/api/screenwriter/video-repaint/{taskId}/target-script/{episodeId}` | 保存人工编辑后的目标剧本内容，更新字数和更新时间。 |

## 小说/短剧工作流接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/novel-promotion/{projectId}/ai-create-character` | 创建/提交 novel-promotion / 指定资源 / ai-create-character |
| POST | `/api/novel-promotion/{projectId}/ai-create-location` | 创建/提交 novel-promotion / 指定资源 / ai-create-location |
| POST | `/api/novel-promotion/{projectId}/ai-modify-appearance` | 创建/提交 novel-promotion / 指定资源 / ai-modify-appearance |
| POST | `/api/novel-promotion/{projectId}/ai-modify-location` | 创建/提交 novel-promotion / 指定资源 / ai-modify-location |
| POST | `/api/novel-promotion/{projectId}/ai-modify-prop` | 创建/提交 novel-promotion / 指定资源 / ai-modify-prop |
| POST | `/api/novel-promotion/{projectId}/ai-modify-shot-prompt` | 创建/提交 novel-promotion / 指定资源 / ai-modify-shot-prompt |
| POST | `/api/novel-promotion/{projectId}/analyze-global` | 创建/提交 novel-promotion / 指定资源 / analyze-global |
| POST | `/api/novel-promotion/{projectId}/analyze-shot-variants` | 创建/提交 novel-promotion / 指定资源 / analyze-shot-variants |
| POST | `/api/novel-promotion/{projectId}/analyze` | 创建/提交 novel-promotion / 指定资源 / analyze |
| POST | `/api/novel-promotion/{projectId}/asset-extraction` | 创建/提交 novel-promotion / 指定资源 / asset-extraction |
| GET | `/api/novel-promotion/{projectId}/assets` | 查询 novel-promotion / 指定资源 / assets |
| POST | `/api/novel-promotion/{projectId}/character-profile/batch-confirm` | 创建/提交 指定资源 / character-profile / batch-confirm |
| POST | `/api/novel-promotion/{projectId}/character-profile/confirm` | 创建/提交 指定资源 / character-profile / confirm |
| PATCH | `/api/novel-promotion/{projectId}/character-voice` | 更新 novel-promotion / 指定资源 / character-voice |
| POST | `/api/novel-promotion/{projectId}/character-voice` | 创建/提交 novel-promotion / 指定资源 / character-voice |
| DELETE | `/api/novel-promotion/{projectId}/character/appearance` | 删除 指定资源 / character / appearance |
| PATCH | `/api/novel-promotion/{projectId}/character/appearance` | 更新 指定资源 / character / appearance |
| POST | `/api/novel-promotion/{projectId}/character/appearance` | 创建/提交 指定资源 / character / appearance |
| POST | `/api/novel-promotion/{projectId}/character/confirm-selection` | 创建/提交 指定资源 / character / confirm-selection |
| DELETE | `/api/novel-promotion/{projectId}/character` | 删除 novel-promotion / 指定资源 / character |
| PATCH | `/api/novel-promotion/{projectId}/character` | 更新 novel-promotion / 指定资源 / character |
| POST | `/api/novel-promotion/{projectId}/character` | 创建/提交 novel-promotion / 指定资源 / character |
| POST | `/api/novel-promotion/{projectId}/cleanup-unselected-images` | 创建/提交 novel-promotion / 指定资源 / cleanup-unselected-images |
| PATCH | `/api/novel-promotion/{projectId}/clips/{clipId}` | 更新 指定资源 / clips / 指定资源 |
| POST | `/api/novel-promotion/{projectId}/clips` | 创建/提交 novel-promotion / 指定资源 / clips |
| POST | `/api/novel-promotion/{projectId}/copy-from-global` | 创建/提交 novel-promotion / 指定资源 / copy-from-global |
| GET | `/api/novel-promotion/{projectId}/download-images` | 查询 novel-promotion / 指定资源 / download-images |
| POST | `/api/novel-promotion/{projectId}/download-videos` | 创建/提交 novel-promotion / 指定资源 / download-videos |
| GET | `/api/novel-promotion/{projectId}/download-voices` | 查询 novel-promotion / 指定资源 / download-voices |
| DELETE | `/api/novel-promotion/{projectId}/editor` | 删除 novel-promotion / 指定资源 / editor |
| GET | `/api/novel-promotion/{projectId}/editor` | 查询 novel-promotion / 指定资源 / editor |
| PUT | `/api/novel-promotion/{projectId}/editor` | 替换/保存 novel-promotion / 指定资源 / editor |
| DELETE | `/api/novel-promotion/{projectId}/episodes/{episodeId}` | 删除 指定资源 / episodes / 指定资源 |
| GET | `/api/novel-promotion/{projectId}/episodes/{episodeId}` | 查询 指定资源 / episodes / 指定资源 |
| PATCH | `/api/novel-promotion/{projectId}/episodes/{episodeId}` | 更新 指定资源 / episodes / 指定资源 |
| POST | `/api/novel-promotion/{projectId}/episodes/batch` | 创建/提交 指定资源 / episodes / batch |
| POST | `/api/novel-promotion/{projectId}/episodes/split-by-markers` | 创建/提交 指定资源 / episodes / split-by-markers |
| POST | `/api/novel-promotion/{projectId}/episodes/split` | 创建/提交 指定资源 / episodes / split |
| GET | `/api/novel-promotion/{projectId}/episodes` | 查询 novel-promotion / 指定资源 / episodes |
| POST | `/api/novel-promotion/{projectId}/episodes` | 创建/提交 novel-promotion / 指定资源 / episodes |
| GET | `/api/novel-promotion/{projectId}/export-artifact` | 查询 novel-promotion / 指定资源 / export-artifact |
| GET | `/api/novel-promotion/{projectId}/export-history` | 查询 novel-promotion / 指定资源 / export-history |
| POST | `/api/novel-promotion/{projectId}/export-history` | 创建/提交 novel-promotion / 指定资源 / export-history |
| GET | `/api/novel-promotion/{projectId}/export-manifest` | 查询 novel-promotion / 指定资源 / export-manifest |
| POST | `/api/novel-promotion/{projectId}/export-preflight-review` | 创建/提交 novel-promotion / 指定资源 / export-preflight-review |
| GET | `/api/novel-promotion/{projectId}/export-queue` | 查询 novel-promotion / 指定资源 / export-queue |
| POST | `/api/novel-promotion/{projectId}/export-queue` | 创建/提交 novel-promotion / 指定资源 / export-queue |
| POST | `/api/novel-promotion/{projectId}/generate-character-image` | 创建/提交 novel-promotion / 指定资源 / generate-character-image |
| POST | `/api/novel-promotion/{projectId}/generate-image` | 创建/提交 novel-promotion / 指定资源 / generate-image |
| POST | `/api/novel-promotion/{projectId}/generate-video` | 创建/提交 novel-promotion / 指定资源 / generate-video |
| POST | `/api/novel-promotion/{projectId}/insert-panel` | 创建/提交 novel-promotion / 指定资源 / insert-panel |
| POST | `/api/novel-promotion/{projectId}/lip-sync` | 创建/提交 novel-promotion / 指定资源 / lip-sync |
| POST | `/api/novel-promotion/{projectId}/location/confirm-selection` | 创建/提交 指定资源 / location / confirm-selection |
| DELETE | `/api/novel-promotion/{projectId}/location` | 删除 novel-promotion / 指定资源 / location |
| PATCH | `/api/novel-promotion/{projectId}/location` | 更新 novel-promotion / 指定资源 / location |
| POST | `/api/novel-promotion/{projectId}/location` | 创建/提交 novel-promotion / 指定资源 / location |
| POST | `/api/novel-promotion/{projectId}/modify-asset-image` | 创建/提交 novel-promotion / 指定资源 / modify-asset-image |
| POST | `/api/novel-promotion/{projectId}/modify-storyboard-image` | 创建/提交 novel-promotion / 指定资源 / modify-storyboard-image |
| POST | `/api/novel-promotion/{projectId}/panel-link` | 创建/提交 novel-promotion / 指定资源 / panel-link |
| POST | `/api/novel-promotion/{projectId}/panel-variant` | 创建/提交 novel-promotion / 指定资源 / panel-variant |
| POST | `/api/novel-promotion/{projectId}/panel/select-candidate` | 创建/提交 指定资源 / panel / select-candidate |
| DELETE | `/api/novel-promotion/{projectId}/panel` | 删除 novel-promotion / 指定资源 / panel |
| PATCH | `/api/novel-promotion/{projectId}/panel` | 更新 novel-promotion / 指定资源 / panel |
| POST | `/api/novel-promotion/{projectId}/panel` | 创建/提交 novel-promotion / 指定资源 / panel |
| PUT | `/api/novel-promotion/{projectId}/panel` | 替换/保存 novel-promotion / 指定资源 / panel |
| PUT | `/api/novel-promotion/{projectId}/photography-plan` | 替换/保存 novel-promotion / 指定资源 / photography-plan |
| GET | `/api/novel-promotion/{projectId}/rebuild-impact` | 查询 novel-promotion / 指定资源 / rebuild-impact |
| POST | `/api/novel-promotion/{projectId}/reference-to-character` | 创建/提交 novel-promotion / 指定资源 / reference-to-character |
| POST | `/api/novel-promotion/{projectId}/regenerate-group` | 创建/提交 novel-promotion / 指定资源 / regenerate-group |
| POST | `/api/novel-promotion/{projectId}/regenerate-panel-image` | 创建/提交 novel-promotion / 指定资源 / regenerate-panel-image |
| POST | `/api/novel-promotion/{projectId}/regenerate-single-image` | 创建/提交 novel-promotion / 指定资源 / regenerate-single-image |
| POST | `/api/novel-promotion/{projectId}/regenerate-storyboard-text` | 创建/提交 novel-promotion / 指定资源 / regenerate-storyboard-text |
| POST | `/api/novel-promotion/{projectId}/screenplay-conversion` | 创建/提交 novel-promotion / 指定资源 / screenplay-conversion |
| POST | `/api/novel-promotion/{projectId}/script-to-storyboard-stream` | 创建/提交 novel-promotion / 指定资源 / script-to-storyboard-stream |
| PATCH | `/api/novel-promotion/{projectId}/seedance-assets/character` | 更新 指定资源 / seedance-assets / character |
| POST | `/api/novel-promotion/{projectId}/seedance-assets/character` | 创建/提交 指定资源 / seedance-assets / character |
| POST | `/api/novel-promotion/{projectId}/select-character-image` | 创建/提交 novel-promotion / 指定资源 / select-character-image |
| POST | `/api/novel-promotion/{projectId}/select-location-image` | 创建/提交 novel-promotion / 指定资源 / select-location-image |
| GET | `/api/novel-promotion/{projectId}/speaker-voice` | 查询 novel-promotion / 指定资源 / speaker-voice |
| PATCH | `/api/novel-promotion/{projectId}/speaker-voice` | 更新 novel-promotion / 指定资源 / speaker-voice |
| POST | `/api/novel-promotion/{projectId}/story-to-script-stream` | 创建/提交 novel-promotion / 指定资源 / story-to-script-stream |
| DELETE | `/api/novel-promotion/{projectId}/storyboard-group` | 删除 novel-promotion / 指定资源 / storyboard-group |
| POST | `/api/novel-promotion/{projectId}/storyboard-group` | 创建/提交 novel-promotion / 指定资源 / storyboard-group |
| PUT | `/api/novel-promotion/{projectId}/storyboard-group` | 替换/保存 novel-promotion / 指定资源 / storyboard-group |
| GET | `/api/novel-promotion/{projectId}/storyboards` | 查询 novel-promotion / 指定资源 / storyboards |
| PATCH | `/api/novel-promotion/{projectId}/storyboards` | 更新 novel-promotion / 指定资源 / storyboards |
| GET | `/api/novel-promotion/{projectId}/timeline` | 查询 novel-promotion / 指定资源 / timeline |
| PATCH | `/api/novel-promotion/{projectId}/timeline` | 更新 novel-promotion / 指定资源 / timeline |
| POST | `/api/novel-promotion/{projectId}/undo-regenerate` | 创建/提交 novel-promotion / 指定资源 / undo-regenerate |
| POST | `/api/novel-promotion/{projectId}/update-appearance` | 创建/提交 novel-promotion / 指定资源 / update-appearance |
| POST | `/api/novel-promotion/{projectId}/update-asset-label` | 创建/提交 novel-promotion / 指定资源 / update-asset-label |
| POST | `/api/novel-promotion/{projectId}/update-location` | 创建/提交 novel-promotion / 指定资源 / update-location |
| POST | `/api/novel-promotion/{projectId}/update-prompt` | 创建/提交 novel-promotion / 指定资源 / update-prompt |
| POST | `/api/novel-promotion/{projectId}/upload-asset-image` | 创建/提交 novel-promotion / 指定资源 / upload-asset-image |
| GET | `/api/novel-promotion/{projectId}/video-proxy` | 查询 novel-promotion / 指定资源 / video-proxy |
| POST | `/api/novel-promotion/{projectId}/video-urls` | 创建/提交 novel-promotion / 指定资源 / video-urls |
| POST | `/api/novel-promotion/{projectId}/voice-analyze` | 创建/提交 novel-promotion / 指定资源 / voice-analyze |
| POST | `/api/novel-promotion/{projectId}/voice-design` | 创建/提交 novel-promotion / 指定资源 / voice-design |
| POST | `/api/novel-promotion/{projectId}/voice-generate` | 创建/提交 novel-promotion / 指定资源 / voice-generate |
| DELETE | `/api/novel-promotion/{projectId}/voice-lines` | 删除 novel-promotion / 指定资源 / voice-lines |
| GET | `/api/novel-promotion/{projectId}/voice-lines` | 查询 novel-promotion / 指定资源 / voice-lines |
| PATCH | `/api/novel-promotion/{projectId}/voice-lines` | 更新 novel-promotion / 指定资源 / voice-lines |
| POST | `/api/novel-promotion/{projectId}/voice-lines` | 创建/提交 novel-promotion / 指定资源 / voice-lines |
| POST | `/api/novel-promotion/{projectId}/voice-mapping` | 创建/提交 novel-promotion / 指定资源 / voice-mapping |
| GET | `/api/novel-promotion/{projectId}` | 查询 api / novel-promotion / 指定资源 |
| PATCH | `/api/novel-promotion/{projectId}` | 更新 api / novel-promotion / 指定资源 |
| GET | `/api/novel-promotion/episodes/{episodeId}/storyboards` | 查询 episodes / 指定资源 / storyboards |

### POST /api/novel-promotion/{projectId}/ai-create-character

- 用途：创建/提交 novel-promotion / 指定资源 / ai-create-character。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`userInstruction`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/ai-create-character/route.ts`。

### POST /api/novel-promotion/{projectId}/ai-create-location

- 用途：创建/提交 novel-promotion / 指定资源 / ai-create-location。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`userInstruction`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/ai-create-location/route.ts`。

### POST /api/novel-promotion/{projectId}/ai-modify-appearance

- 用途：创建/提交 novel-promotion / 指定资源 / ai-modify-appearance。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`appearanceId`, `characterId`, `currentDescription`, `modifyInstruction`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/ai-modify-appearance/route.ts`。

### POST /api/novel-promotion/{projectId}/ai-modify-location

- 用途：创建/提交 novel-promotion / 指定资源 / ai-modify-location。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`currentDescription`, `locationId`, `modifyInstruction`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/ai-modify-location/route.ts`。

### POST /api/novel-promotion/{projectId}/ai-modify-prop

- 用途：创建/提交 novel-promotion / 指定资源 / ai-modify-prop。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`currentDescription`, `modifyInstruction`, `propId`, `variantId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/ai-modify-prop/route.ts`。

### POST /api/novel-promotion/{projectId}/ai-modify-shot-prompt

- 用途：创建/提交 novel-promotion / 指定资源 / ai-modify-shot-prompt。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`currentPrompt`, `episodeId`, `modifyInstruction`, `panelId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/ai-modify-shot-prompt/route.ts`。

### POST /api/novel-promotion/{projectId}/analyze-global

- 用途：创建/提交 novel-promotion / 指定资源 / analyze-global。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/analyze-global/route.ts`。

### POST /api/novel-promotion/{projectId}/analyze-shot-variants

- 用途：创建/提交 novel-promotion / 指定资源 / analyze-shot-variants。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`panelId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/analyze-shot-variants/route.ts`。

### POST /api/novel-promotion/{projectId}/analyze

- 用途：创建/提交 novel-promotion / 指定资源 / analyze。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/analyze/route.ts`。

### POST /api/novel-promotion/{projectId}/asset-extraction

- 用途：创建/提交 novel-promotion / 指定资源 / asset-extraction。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodes`, `model`, `runId`。
- 响应：JSON；核心字段：`artifact`, `package`, `usage`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/asset-extraction/route.ts`。

### GET /api/novel-promotion/{projectId}/assets

- 用途：查询 novel-promotion / 指定资源 / assets。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`characters`, `locations`, `props`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/assets/route.ts`。

### POST /api/novel-promotion/{projectId}/character-profile/batch-confirm

- 用途：创建/提交 指定资源 / character-profile / batch-confirm。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character-profile/batch-confirm/route.ts`。

### POST /api/novel-promotion/{projectId}/character-profile/confirm

- 用途：创建/提交 指定资源 / character-profile / confirm。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`characterId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character-profile/confirm/route.ts`。

### PATCH /api/novel-promotion/{projectId}/character-voice

- 用途：更新 novel-promotion / 指定资源 / character-voice。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`character`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 上传类字段使用 `multipart/form-data`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character-voice/route.ts`。

### POST /api/novel-promotion/{projectId}/character-voice

- 用途：创建/提交 novel-promotion / 指定资源 / character-voice。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`multipart/form-data`；字段：`characterId`, `file`。
- 响应：JSON；核心字段：`audioUrl`, `character`, `customVoiceUrl`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 上传类字段使用 `multipart/form-data`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character-voice/route.ts`。

### DELETE /api/novel-promotion/{projectId}/character/appearance

- 用途：删除 指定资源 / character / appearance。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`appearanceId`, `characterId`。
- 请求体：无。
- 响应：JSON；核心字段：`deletedImages`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character/appearance/route.ts`。

### PATCH /api/novel-promotion/{projectId}/character/appearance

- 用途：更新 指定资源 / character / appearance。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character/appearance/route.ts`。

### POST /api/novel-promotion/{projectId}/character/appearance

- 用途：创建/提交 指定资源 / character / appearance。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`appearance`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character/appearance/route.ts`。

### POST /api/novel-promotion/{projectId}/character/confirm-selection

- 用途：创建/提交 指定资源 / character / confirm-selection。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`deletedCount`, `message`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character/confirm-selection/route.ts`。

### DELETE /api/novel-promotion/{projectId}/character

- 用途：删除 novel-promotion / 指定资源 / character。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`id`。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character/route.ts`。

### PATCH /api/novel-promotion/{projectId}/character

- 用途：更新 novel-promotion / 指定资源 / character。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`character`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character/route.ts`。

### POST /api/novel-promotion/{projectId}/character

- 用途：创建/提交 novel-promotion / 指定资源 / character。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`artStyle`, `count`, `customDescription`, `description`, `generateFromReference`, `meta`, `name`, `referenceImageUrl`, `referenceImageUrls`, `uploadDirect`。
- 响应：JSON；核心字段：`character`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/character/route.ts`。

### POST /api/novel-promotion/{projectId}/cleanup-unselected-images

- 用途：创建/提交 novel-promotion / 指定资源 / cleanup-unselected-images。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`deletedCount`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/cleanup-unselected-images/route.ts`。

### PATCH /api/novel-promotion/{projectId}/clips/{clipId}

- 用途：更新 指定资源 / clips / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`clipId`, `projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`clip`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/clips/[clipId]/route.ts`。

### POST /api/novel-promotion/{projectId}/clips

- 用途：创建/提交 novel-promotion / 指定资源 / clips。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/clips/route.ts`。

### POST /api/novel-promotion/{projectId}/copy-from-global

- 用途：创建/提交 novel-promotion / 指定资源 / copy-from-global。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`globalAssetId`, `targetId`, `type`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/copy-from-global/route.ts`。

### GET /api/novel-promotion/{projectId}/download-images

- 用途：查询 novel-promotion / 指定资源 / download-images。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：文件或媒体流响应；包含合适的 `content-type` / 下载头。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/download-images/route.ts`。

### POST /api/novel-promotion/{projectId}/download-videos

- 用途：创建/提交 novel-promotion / 指定资源 / download-videos。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：文件或媒体流响应；包含合适的 `content-type` / 下载头。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/download-videos/route.ts`。

### GET /api/novel-promotion/{projectId}/download-voices

- 用途：查询 novel-promotion / 指定资源 / download-voices。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：文件或媒体流响应；包含合适的 `content-type` / 下载头。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/download-voices/route.ts`。

### DELETE /api/novel-promotion/{projectId}/editor

- 用途：删除 novel-promotion / 指定资源 / editor。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/editor/route.ts`。

### GET /api/novel-promotion/{projectId}/editor

- 用途：查询 novel-promotion / 指定资源 / editor。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；核心字段：`episodeId`, `id`, `outputUrl`, `projectData`, `renderStatus`, `updatedAt`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/editor/route.ts`。

### PUT /api/novel-promotion/{projectId}/editor

- 用途：替换/保存 novel-promotion / 指定资源 / editor。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`id`, `success`, `updatedAt`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/editor/route.ts`。

### DELETE /api/novel-promotion/{projectId}/episodes/{episodeId}

- 用途：删除 指定资源 / episodes / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`episodeId`, `projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts`。

### GET /api/novel-promotion/{projectId}/episodes/{episodeId}

- 用途：查询 指定资源 / episodes / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`episodeId`, `projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`episode`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts`。

### PATCH /api/novel-promotion/{projectId}/episodes/{episodeId}

- 用途：更新 指定资源 / episodes / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`episodeId`, `projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`episode`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts`。

### POST /api/novel-promotion/{projectId}/episodes/batch

- 用途：创建/提交 指定资源 / episodes / batch。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`clearExisting`, `episodes`。
- 响应：JSON；核心字段：`episodeNumber`, `episodes`, `id`, `message`, `name`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts`。

### POST /api/novel-promotion/{projectId}/episodes/split-by-markers

- 用途：创建/提交 指定资源 / episodes / split-by-markers。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`content`。
- 响应：JSON；核心字段：`episodes`, `markerType`, `method`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/episodes/split-by-markers/route.ts`。

### POST /api/novel-promotion/{projectId}/episodes/split

- 用途：创建/提交 指定资源 / episodes / split。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`content`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/episodes/split/route.ts`。

### GET /api/novel-promotion/{projectId}/episodes

- 用途：查询 novel-promotion / 指定资源 / episodes。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`episodes`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/episodes/route.ts`。

### POST /api/novel-promotion/{projectId}/episodes

- 用途：创建/提交 novel-promotion / 指定资源 / episodes。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`episode`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/episodes/route.ts`。

### GET /api/novel-promotion/{projectId}/export-artifact

- 用途：查询 novel-promotion / 指定资源 / export-artifact。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`redirect`。
- 请求体：无。
- 响应：JSON；核心字段：`cardId`, `contentType`, `createdAt`, `downloadUrl`, `episodeId`, `fileName`, `id`, `outputStorageKey`, `projectId`, `source`, `taskId`, `updatedAt`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/export-artifact/route.ts`。

### GET /api/novel-promotion/{projectId}/export-history

- 用途：查询 novel-promotion / 指定资源 / export-history。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；返回对应业务结果。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/export-history/route.ts`。

### POST /api/novel-promotion/{projectId}/export-history

- 用途：创建/提交 novel-promotion / 指定资源 / export-history。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：`application/json`；字段：`cardId`。
- 响应：JSON；返回对应业务结果。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/export-history/route.ts`。

### GET /api/novel-promotion/{projectId}/export-manifest

- 用途：查询 novel-promotion / 指定资源 / export-manifest。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；返回对应业务结果。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/export-manifest/route.ts`。

### POST /api/novel-promotion/{projectId}/export-preflight-review

- 用途：创建/提交 novel-promotion / 指定资源 / export-preflight-review。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`locale`。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`model`, `promptPayload`, `reasoning`, `review`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/export-preflight-review/route.ts`。

### GET /api/novel-promotion/{projectId}/export-queue

- 用途：查询 novel-promotion / 指定资源 / export-queue。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；返回对应业务结果。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/export-queue/route.ts`。

### POST /api/novel-promotion/{projectId}/export-queue

- 用途：创建/提交 novel-promotion / 指定资源 / export-queue。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：`application/json`；字段：`cardId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/export-queue/route.ts`。

### POST /api/novel-promotion/{projectId}/generate-character-image

- 用途：创建/提交 novel-promotion / 指定资源 / generate-character-image。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`appearanceId`, `artStyle`, `characterId`, `count`, `meta`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/generate-character-image/route.ts`。

### POST /api/novel-promotion/{projectId}/generate-image

- 用途：创建/提交 novel-promotion / 指定资源 / generate-image。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`id`, `type`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/generate-image/route.ts`。

### POST /api/novel-promotion/{projectId}/generate-video

- 用途：创建/提交 novel-promotion / 指定资源 / generate-video。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`, `storyboardId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/generate-video/route.ts`。

### POST /api/novel-promotion/{projectId}/insert-panel

- 用途：创建/提交 novel-promotion / 指定资源 / insert-panel。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`insertAfterPanelId`, `storyboardId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/insert-panel/route.ts`。

### POST /api/novel-promotion/{projectId}/lip-sync

- 用途：创建/提交 novel-promotion / 指定资源 / lip-sync。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`lipSyncModel`, `storyboardId`, `voiceLineId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/lip-sync/route.ts`。

### POST /api/novel-promotion/{projectId}/location/confirm-selection

- 用途：创建/提交 指定资源 / location / confirm-selection。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`deletedCount`, `message`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/location/confirm-selection/route.ts`。

### DELETE /api/novel-promotion/{projectId}/location

- 用途：删除 novel-promotion / 指定资源 / location。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`id`。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/location/route.ts`。

### PATCH /api/novel-promotion/{projectId}/location

- 用途：更新 novel-promotion / 指定资源 / location。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`artStyle`, `availableSlots`, `count`, `description`, `name`, `summary`。
- 响应：JSON；核心字段：`image`, `location`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/location/route.ts`。

### POST /api/novel-promotion/{projectId}/location

- 用途：创建/提交 novel-promotion / 指定资源 / location。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`artStyle`, `availableSlots`, `count`, `description`, `name`, `summary`。
- 响应：JSON；核心字段：`location`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/location/route.ts`。

### POST /api/novel-promotion/{projectId}/modify-asset-image

- 用途：创建/提交 novel-promotion / 指定资源 / modify-asset-image。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`characterId`, `locationId`, `type`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts`。

### POST /api/novel-promotion/{projectId}/modify-storyboard-image

- 用途：创建/提交 novel-promotion / 指定资源 / modify-storyboard-image。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`extraImageUrls`, `modifyPrompt`, `selectedAssets`, `storyboardId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts`。

### POST /api/novel-promotion/{projectId}/panel-link

- 用途：创建/提交 novel-promotion / 指定资源 / panel-link。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/panel-link/route.ts`。

### POST /api/novel-promotion/{projectId}/panel-variant

- 用途：创建/提交 novel-promotion / 指定资源 / panel-variant。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`insertAfterPanelId`, `sourcePanelId`, `storyboardId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/panel-variant/route.ts`。

### POST /api/novel-promotion/{projectId}/panel/select-candidate

- 用途：创建/提交 指定资源 / panel / select-candidate。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`cosKey`, `imageUrl`, `message`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/panel/select-candidate/route.ts`。

### DELETE /api/novel-promotion/{projectId}/panel

- 用途：删除 novel-promotion / 指定资源 / panel。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`panelId`。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/panel/route.ts`。

### PATCH /api/novel-promotion/{projectId}/panel

- 用途：更新 novel-promotion / 指定资源 / panel。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`changed`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/panel/route.ts`。

### POST /api/novel-promotion/{projectId}/panel

- 用途：创建/提交 novel-promotion / 指定资源 / panel。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`panel`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/panel/route.ts`。

### PUT /api/novel-promotion/{projectId}/panel

- 用途：替换/保存 novel-promotion / 指定资源 / panel。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/panel/route.ts`。

### PUT /api/novel-promotion/{projectId}/photography-plan

- 用途：替换/保存 novel-promotion / 指定资源 / photography-plan。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/photography-plan/route.ts`。

### GET /api/novel-promotion/{projectId}/rebuild-impact

- 用途：查询 novel-promotion / 指定资源 / rebuild-impact。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/rebuild-impact/route.ts`。

### POST /api/novel-promotion/{projectId}/reference-to-character

- 用途：创建/提交 novel-promotion / 指定资源 / reference-to-character。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`appearanceId`, `characterId`, `count`, `isBackgroundJob`, `referenceImageUrl`, `referenceImageUrls`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/reference-to-character/route.ts`。

### POST /api/novel-promotion/{projectId}/regenerate-group

- 用途：创建/提交 novel-promotion / 指定资源 / regenerate-group。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/regenerate-group/route.ts`。

### POST /api/novel-promotion/{projectId}/regenerate-panel-image

- 用途：创建/提交 novel-promotion / 指定资源 / regenerate-panel-image。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`panelId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/regenerate-panel-image/route.ts`。

### POST /api/novel-promotion/{projectId}/regenerate-single-image

- 用途：创建/提交 novel-promotion / 指定资源 / regenerate-single-image。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`appearanceId`, `id`, `type`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/regenerate-single-image/route.ts`。

### POST /api/novel-promotion/{projectId}/regenerate-storyboard-text

- 用途：创建/提交 novel-promotion / 指定资源 / regenerate-storyboard-text。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`storyboardId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/regenerate-storyboard-text/route.ts`。

### POST /api/novel-promotion/{projectId}/screenplay-conversion

- 用途：创建/提交 novel-promotion / 指定资源 / screenplay-conversion。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/screenplay-conversion/route.ts`。

### POST /api/novel-promotion/{projectId}/script-to-storyboard-stream

- 用途：创建/提交 novel-promotion / 指定资源 / script-to-storyboard-stream。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/script-to-storyboard-stream/route.ts`。

### PATCH /api/novel-promotion/{projectId}/seedance-assets/character

- 用途：更新 指定资源 / seedance-assets / character。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`appearanceId`, `characterId`。
- 响应：JSON；核心字段：`assetId`, `assetUri`, `error`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/seedance-assets/character/route.ts`。

### POST /api/novel-promotion/{projectId}/seedance-assets/character

- 用途：创建/提交 指定资源 / seedance-assets / character。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`appearanceId`, `characterId`, `imageIndex`。
- 响应：JSON；核心字段：`assetId`, `assetUri`, `error`, `groupId`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/seedance-assets/character/route.ts`。

### POST /api/novel-promotion/{projectId}/select-character-image

- 用途：创建/提交 novel-promotion / 指定资源 / select-character-image。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`appearanceId`, `characterId`, `selectedIndex`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/select-character-image/route.ts`。

### POST /api/novel-promotion/{projectId}/select-location-image

- 用途：创建/提交 novel-promotion / 指定资源 / select-location-image。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`locationId`, `selectedIndex`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/select-location-image/route.ts`。

### GET /api/novel-promotion/{projectId}/speaker-voice

- 用途：查询 novel-promotion / 指定资源 / speaker-voice。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；核心字段：`speakerVoices`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/speaker-voice/route.ts`。

### PATCH /api/novel-promotion/{projectId}/speaker-voice

- 用途：更新 novel-promotion / 指定资源 / speaker-voice。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/speaker-voice/route.ts`。

### POST /api/novel-promotion/{projectId}/story-to-script-stream

- 用途：创建/提交 novel-promotion / 指定资源 / story-to-script-stream。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`content`, `episodeId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/story-to-script-stream/route.ts`。

### DELETE /api/novel-promotion/{projectId}/storyboard-group

- 用途：删除 novel-promotion / 指定资源 / storyboard-group。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`storyboardId`。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/storyboard-group/route.ts`。

### POST /api/novel-promotion/{projectId}/storyboard-group

- 用途：创建/提交 novel-promotion / 指定资源 / storyboard-group。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`clip`, `panel`, `storyboard`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/storyboard-group/route.ts`。

### PUT /api/novel-promotion/{projectId}/storyboard-group

- 用途：替换/保存 novel-promotion / 指定资源 / storyboard-group。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/storyboard-group/route.ts`。

### GET /api/novel-promotion/{projectId}/storyboards

- 用途：查询 novel-promotion / 指定资源 / storyboards。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；核心字段：`storyboards`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/storyboards/route.ts`。

### PATCH /api/novel-promotion/{projectId}/storyboards

- 用途：更新 novel-promotion / 指定资源 / storyboards。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`storyboardId`。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/storyboards/route.ts`。

### GET /api/novel-promotion/{projectId}/timeline

- 用途：查询 novel-promotion / 指定资源 / timeline。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/timeline/route.ts`。

### PATCH /api/novel-promotion/{projectId}/timeline

- 用途：更新 novel-promotion / 指定资源 / timeline。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`, `reorder`, `updates`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/timeline/route.ts`。

### POST /api/novel-promotion/{projectId}/undo-regenerate

- 用途：创建/提交 novel-promotion / 指定资源 / undo-regenerate。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`id`, `type`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/undo-regenerate/route.ts`。

### POST /api/novel-promotion/{projectId}/update-appearance

- 用途：创建/提交 novel-promotion / 指定资源 / update-appearance。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/update-appearance/route.ts`。

### POST /api/novel-promotion/{projectId}/update-asset-label

- 用途：创建/提交 novel-promotion / 指定资源 / update-asset-label。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/update-asset-label/route.ts`。

### POST /api/novel-promotion/{projectId}/update-location

- 用途：创建/提交 novel-promotion / 指定资源 / update-location。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/update-location/route.ts`。

### POST /api/novel-promotion/{projectId}/update-prompt

- 用途：创建/提交 novel-promotion / 指定资源 / update-prompt。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`field`, `shotId`, `value`。
- 响应：JSON；核心字段：`shot`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/update-prompt/route.ts`。

### POST /api/novel-promotion/{projectId}/upload-asset-image

- 用途：创建/提交 novel-promotion / 指定资源 / upload-asset-image。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`multipart/form-data`；字段：`appearanceId`, `file`, `id`, `imageIndex`, `labelText`, `type`。
- 响应：JSON；核心字段：`imageIndex`, `imageKey`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 上传类字段使用 `multipart/form-data`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/upload-asset-image/route.ts`。

### GET /api/novel-promotion/{projectId}/video-proxy

- 用途：查询 novel-promotion / 指定资源 / video-proxy。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`key`。
- 请求体：无。
- 响应：文件或媒体流响应；包含合适的 `content-type` / 下载头。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/video-proxy/route.ts`。

### POST /api/novel-promotion/{projectId}/video-urls

- 用途：创建/提交 novel-promotion / 指定资源 / video-urls。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`projectName`, `videos`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/video-urls/route.ts`。

### POST /api/novel-promotion/{projectId}/voice-analyze

- 用途：创建/提交 novel-promotion / 指定资源 / voice-analyze。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/voice-analyze/route.ts`。

### POST /api/novel-promotion/{projectId}/voice-design

- 用途：创建/提交 novel-promotion / 指定资源 / voice-design。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`language`, `preferredName`, `previewText`, `voicePrompt`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/voice-design/route.ts`。

### POST /api/novel-promotion/{projectId}/voice-generate

- 用途：创建/提交 novel-promotion / 指定资源 / voice-generate。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`audioModel`, `episodeId`, `lineId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/voice-generate/route.ts`。

### DELETE /api/novel-promotion/{projectId}/voice-lines

- 用途：删除 novel-promotion / 指定资源 / voice-lines。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`lineId`。
- 请求体：无。
- 响应：JSON；核心字段：`deletedId`, `remainingCount`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/voice-lines/route.ts`。

### GET /api/novel-promotion/{projectId}/voice-lines

- 用途：查询 novel-promotion / 指定资源 / voice-lines。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`, `speakersOnly`。
- 请求体：无。
- 响应：JSON；核心字段：`count`, `speakerStats`, `speakers`, `voiceLines`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/voice-lines/route.ts`。

### PATCH /api/novel-promotion/{projectId}/voice-lines

- 用途：更新 novel-promotion / 指定资源 / voice-lines。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`speaker`, `success`, `updatedCount`, `voiceLine`, `voicePresetId`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/voice-lines/route.ts`。

### POST /api/novel-promotion/{projectId}/voice-lines

- 用途：创建/提交 novel-promotion / 指定资源 / voice-lines。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`, `voiceLine`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/voice-lines/route.ts`。

### POST /api/novel-promotion/{projectId}/voice-mapping

- 用途：创建/提交 novel-promotion / 指定资源 / voice-mapping。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`locale`。
- 请求体：`application/json`；字段：`dialogueSamples`, `voiceLibrary`。
- 响应：JSON；核心字段：`applied`, `mapping`, `mappingMetadataStored`, `model`, `plan`, `promptPayload`, `reasoning`, `speakerVoicePlans`, `speakerVoicesApplied`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/voice-mapping/route.ts`。

### GET /api/novel-promotion/{projectId}

- 用途：查询 api / novel-promotion / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`capabilityOverrides`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/route.ts`。

### PATCH /api/novel-promotion/{projectId}

- 用途：更新 api / novel-promotion / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`capabilityOverrides`。
- 响应：JSON；核心字段：`project`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/[projectId]/route.ts`。

### GET /api/novel-promotion/episodes/{episodeId}/storyboards

- 用途：查询 episodes / 指定资源 / storyboards。
- 鉴权：需要登录用户会话。
- 路径参数：`episodeId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`groups`, `storyboards`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/novel-promotion/episodes/[episodeId]/storyboards/route.ts`。

## 全局资产中心接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/asset-hub/ai-design-character` | 创建/提交 api / asset-hub / ai-design-character |
| POST | `/api/asset-hub/ai-design-location` | 创建/提交 api / asset-hub / ai-design-location |
| POST | `/api/asset-hub/ai-modify-character` | 创建/提交 api / asset-hub / ai-modify-character |
| POST | `/api/asset-hub/ai-modify-location` | 创建/提交 api / asset-hub / ai-modify-location |
| POST | `/api/asset-hub/ai-modify-prop` | 创建/提交 api / asset-hub / ai-modify-prop |
| DELETE | `/api/asset-hub/appearances` | 删除 api / asset-hub / appearances |
| PATCH | `/api/asset-hub/appearances` | 更新 api / asset-hub / appearances |
| POST | `/api/asset-hub/appearances` | 创建/提交 api / asset-hub / appearances |
| PATCH | `/api/asset-hub/character-voice` | 更新 api / asset-hub / character-voice |
| POST | `/api/asset-hub/character-voice` | 创建/提交 api / asset-hub / character-voice |
| DELETE | `/api/asset-hub/characters/{characterId}/appearances/{appearanceIndex}` | 删除 指定资源 / appearances / 指定资源 |
| PATCH | `/api/asset-hub/characters/{characterId}/appearances/{appearanceIndex}` | 更新 指定资源 / appearances / 指定资源 |
| POST | `/api/asset-hub/characters/{characterId}/appearances/{appearanceIndex}` | 创建/提交 指定资源 / appearances / 指定资源 |
| DELETE | `/api/asset-hub/characters/{characterId}` | 删除 asset-hub / characters / 指定资源 |
| GET | `/api/asset-hub/characters/{characterId}` | 查询 asset-hub / characters / 指定资源 |
| PATCH | `/api/asset-hub/characters/{characterId}` | 更新 asset-hub / characters / 指定资源 |
| GET | `/api/asset-hub/characters` | 查询 api / asset-hub / characters |
| POST | `/api/asset-hub/characters` | 创建/提交 api / asset-hub / characters |
| DELETE | `/api/asset-hub/folders/{folderId}` | 删除 asset-hub / folders / 指定资源 |
| PATCH | `/api/asset-hub/folders/{folderId}` | 更新 asset-hub / folders / 指定资源 |
| GET | `/api/asset-hub/folders` | 查询 api / asset-hub / folders |
| POST | `/api/asset-hub/folders` | 创建/提交 api / asset-hub / folders |
| POST | `/api/asset-hub/generate-image` | 创建/提交 api / asset-hub / generate-image |
| DELETE | `/api/asset-hub/locations/{locationId}` | 删除 asset-hub / locations / 指定资源 |
| GET | `/api/asset-hub/locations/{locationId}` | 查询 asset-hub / locations / 指定资源 |
| PATCH | `/api/asset-hub/locations/{locationId}` | 更新 asset-hub / locations / 指定资源 |
| GET | `/api/asset-hub/locations` | 查询 api / asset-hub / locations |
| POST | `/api/asset-hub/locations` | 创建/提交 api / asset-hub / locations |
| POST | `/api/asset-hub/modify-image` | 创建/提交 api / asset-hub / modify-image |
| GET | `/api/asset-hub/picker` | 查询 api / asset-hub / picker |
| POST | `/api/asset-hub/reference-to-character` | 创建/提交 api / asset-hub / reference-to-character |
| POST | `/api/asset-hub/select-image` | 创建/提交 api / asset-hub / select-image |
| POST | `/api/asset-hub/undo-image` | 创建/提交 api / asset-hub / undo-image |
| POST | `/api/asset-hub/update-asset-label` | 创建/提交 api / asset-hub / update-asset-label |
| POST | `/api/asset-hub/upload-image` | 创建/提交 api / asset-hub / upload-image |
| POST | `/api/asset-hub/upload-temp` | 创建/提交 api / asset-hub / upload-temp |
| POST | `/api/asset-hub/voice-design` | 创建/提交 api / asset-hub / voice-design |
| DELETE | `/api/asset-hub/voices/{id}` | 删除 asset-hub / voices / 指定资源 |
| PATCH | `/api/asset-hub/voices/{id}` | 更新 asset-hub / voices / 指定资源 |
| POST | `/api/asset-hub/voices/upload` | 创建/提交 asset-hub / voices / upload |
| GET | `/api/asset-hub/voices` | 查询 api / asset-hub / voices |
| POST | `/api/asset-hub/voices` | 创建/提交 api / asset-hub / voices |

### POST /api/asset-hub/ai-design-character

- 用途：创建/提交 api / asset-hub / ai-design-character。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`userInstruction`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/ai-design-character/route.ts`。

### POST /api/asset-hub/ai-design-location

- 用途：创建/提交 api / asset-hub / ai-design-location。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`userInstruction`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/ai-design-location/route.ts`。

### POST /api/asset-hub/ai-modify-character

- 用途：创建/提交 api / asset-hub / ai-modify-character。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/ai-modify-character/route.ts`。

### POST /api/asset-hub/ai-modify-location

- 用途：创建/提交 api / asset-hub / ai-modify-location。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/ai-modify-location/route.ts`。

### POST /api/asset-hub/ai-modify-prop

- 用途：创建/提交 api / asset-hub / ai-modify-prop。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`currentDescription`, `modifyInstruction`, `propId`, `variantId`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/ai-modify-prop/route.ts`。

### DELETE /api/asset-hub/appearances

- 用途：删除 api / asset-hub / appearances。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`appearanceIndex`, `characterId`。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/appearances/route.ts`。

### PATCH /api/asset-hub/appearances

- 用途：更新 api / asset-hub / appearances。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/appearances/route.ts`。

### POST /api/asset-hub/appearances

- 用途：创建/提交 api / asset-hub / appearances。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`appearanceIndex`, `artStyle`, `changeReason`, `characterId`, `description`。
- 响应：JSON；核心字段：`appearance`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/appearances/route.ts`。

### PATCH /api/asset-hub/character-voice

- 用途：更新 api / asset-hub / character-voice。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/character-voice/route.ts`。

### POST /api/asset-hub/character-voice

- 用途：创建/提交 api / asset-hub / character-voice。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`multipart/form-data`；字段：`characterId`, `file`。
- 响应：JSON；核心字段：`audioUrl`, `success`。
- 备注：上传类字段使用 `multipart/form-data`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/character-voice/route.ts`。

### DELETE /api/asset-hub/characters/{characterId}/appearances/{appearanceIndex}

- 用途：删除 指定资源 / appearances / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`appearanceIndex`, `characterId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts`。

### PATCH /api/asset-hub/characters/{characterId}/appearances/{appearanceIndex}

- 用途：更新 指定资源 / appearances / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`appearanceIndex`, `characterId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts`。

### POST /api/asset-hub/characters/{characterId}/appearances/{appearanceIndex}

- 用途：创建/提交 指定资源 / appearances / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`appearanceIndex`, `characterId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`appearance`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts`。

### DELETE /api/asset-hub/characters/{characterId}

- 用途：删除 asset-hub / characters / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`characterId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/characters/[characterId]/route.ts`。

### GET /api/asset-hub/characters/{characterId}

- 用途：查询 asset-hub / characters / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`characterId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`character`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/characters/[characterId]/route.ts`。

### PATCH /api/asset-hub/characters/{characterId}

- 用途：更新 asset-hub / characters / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`characterId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`character`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/characters/[characterId]/route.ts`。

### GET /api/asset-hub/characters

- 用途：查询 api / asset-hub / characters。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`folderId`。
- 请求体：无。
- 响应：JSON；核心字段：`characters`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/characters/route.ts`。

### POST /api/asset-hub/characters

- 用途：创建/提交 api / asset-hub / characters。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`character`, `success`。
- 备注：多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/characters/route.ts`。

### DELETE /api/asset-hub/folders/{folderId}

- 用途：删除 asset-hub / folders / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`folderId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/folders/[folderId]/route.ts`。

### PATCH /api/asset-hub/folders/{folderId}

- 用途：更新 asset-hub / folders / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`folderId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`folder`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/folders/[folderId]/route.ts`。

### GET /api/asset-hub/folders

- 用途：查询 api / asset-hub / folders。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`folders`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/folders/route.ts`。

### POST /api/asset-hub/folders

- 用途：创建/提交 api / asset-hub / folders。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`folder`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/folders/route.ts`。

### POST /api/asset-hub/generate-image

- 用途：创建/提交 api / asset-hub / generate-image。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`id`, `type`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/generate-image/route.ts`。

### DELETE /api/asset-hub/locations/{locationId}

- 用途：删除 asset-hub / locations / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`locationId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/locations/[locationId]/route.ts`。

### GET /api/asset-hub/locations/{locationId}

- 用途：查询 asset-hub / locations / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`locationId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`location`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/locations/[locationId]/route.ts`。

### PATCH /api/asset-hub/locations/{locationId}

- 用途：更新 asset-hub / locations / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`locationId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`location`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/locations/[locationId]/route.ts`。

### GET /api/asset-hub/locations

- 用途：查询 api / asset-hub / locations。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`folderId`。
- 请求体：无。
- 响应：JSON；核心字段：`locations`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/locations/route.ts`。

### POST /api/asset-hub/locations

- 用途：创建/提交 api / asset-hub / locations。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`availableSlots`, `count`, `folderId`, `name`, `summary`。
- 响应：JSON；核心字段：`location`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/locations/route.ts`。

### POST /api/asset-hub/modify-image

- 用途：创建/提交 api / asset-hub / modify-image。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`id`, `type`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/modify-image/route.ts`。

### GET /api/asset-hub/picker

- 用途：查询 api / asset-hub / picker。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`type`。
- 请求体：无。
- 响应：JSON；核心字段：`characters`, `locations`, `voices`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/picker/route.ts`。

### POST /api/asset-hub/reference-to-character

- 用途：创建/提交 api / asset-hub / reference-to-character。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`appearanceId`, `characterId`, `count`, `isBackgroundJob`, `referenceImageUrl`, `referenceImageUrls`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/reference-to-character/route.ts`。

### POST /api/asset-hub/select-image

- 用途：创建/提交 api / asset-hub / select-image。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`id`, `type`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/select-image/route.ts`。

### POST /api/asset-hub/undo-image

- 用途：创建/提交 api / asset-hub / undo-image。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`id`, `type`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/undo-image/route.ts`。

### POST /api/asset-hub/update-asset-label

- 用途：创建/提交 api / asset-hub / update-asset-label。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；返回对应业务结果。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/update-asset-label/route.ts`。

### POST /api/asset-hub/upload-image

- 用途：创建/提交 api / asset-hub / upload-image。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`multipart/form-data`；字段：`appearanceIndex`, `file`, `id`, `imageIndex`, `labelText`, `type`。
- 响应：JSON；核心字段：`imageIndex`, `imageKey`, `success`。
- 备注：上传类字段使用 `multipart/form-data`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/upload-image/route.ts`。

### POST /api/asset-hub/upload-temp

- 用途：创建/提交 api / asset-hub / upload-temp。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`key`, `success`, `url`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/upload-temp/route.ts`。

### POST /api/asset-hub/voice-design

- 用途：创建/提交 api / asset-hub / voice-design。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`language`, `preferredName`, `previewText`, `voicePrompt`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/voice-design/route.ts`。

### DELETE /api/asset-hub/voices/{id}

- 用途：删除 asset-hub / voices / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`id`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/voices/[id]/route.ts`。

### PATCH /api/asset-hub/voices/{id}

- 用途：更新 asset-hub / voices / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`id`。
- Query 参数：无。
- 请求体：`application/json`；字段：`description`, `folderId`, `name`。
- 响应：JSON；核心字段：`success`, `voice`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/voices/[id]/route.ts`。

### POST /api/asset-hub/voices/upload

- 用途：创建/提交 asset-hub / voices / upload。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`multipart/form-data`；字段：`description`, `file`, `folderId`, `name`。
- 响应：JSON；核心字段：`customVoiceUrl`, `success`, `voice`。
- 备注：上传类字段使用 `multipart/form-data`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/voices/upload/route.ts`。

### GET /api/asset-hub/voices

- 用途：查询 api / asset-hub / voices。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`folderId`。
- 请求体：无。
- 响应：JSON；核心字段：`voices`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/voices/route.ts`。

### POST /api/asset-hub/voices

- 用途：创建/提交 api / asset-hub / voices。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`, `voice`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/asset-hub/voices/route.ts`。

## 项目资产接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/assets/{assetId}/copy` | 创建/提交 assets / 指定资源 / copy |
| POST | `/api/assets/{assetId}/generate` | 创建/提交 assets / 指定资源 / generate |
| POST | `/api/assets/{assetId}/modify-render` | 创建/提交 assets / 指定资源 / modify-render |
| POST | `/api/assets/{assetId}/revert-render` | 创建/提交 assets / 指定资源 / revert-render |
| POST | `/api/assets/{assetId}/select-render` | 创建/提交 assets / 指定资源 / select-render |
| POST | `/api/assets/{assetId}/update-label` | 创建/提交 assets / 指定资源 / update-label |
| PATCH | `/api/assets/{assetId}/variants/{variantId}` | 更新 指定资源 / variants / 指定资源 |
| DELETE | `/api/assets/{assetId}` | 删除 api / assets / 指定资源 |
| PATCH | `/api/assets/{assetId}` | 更新 api / assets / 指定资源 |
| GET | `/api/assets` | 查询 api / assets |
| POST | `/api/assets` | 创建/提交 api / assets |
| GET | `/api/projects/{projectId}/assets` | 查询 projects / 指定资源 / assets |

### POST /api/assets/{assetId}/copy

- 用途：创建/提交 assets / 指定资源 / copy。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`assetId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`globalAssetId`, `kind`, `projectId`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/[assetId]/copy/route.ts`。

### POST /api/assets/{assetId}/generate

- 用途：创建/提交 assets / 指定资源 / generate。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`assetId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`kind`, `projectId`, `scope`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/[assetId]/generate/route.ts`。

### POST /api/assets/{assetId}/modify-render

- 用途：创建/提交 assets / 指定资源 / modify-render。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`assetId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`kind`, `projectId`, `scope`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/[assetId]/modify-render/route.ts`。

### POST /api/assets/{assetId}/revert-render

- 用途：创建/提交 assets / 指定资源 / revert-render。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`assetId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`kind`, `projectId`, `scope`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/[assetId]/revert-render/route.ts`。

### POST /api/assets/{assetId}/select-render

- 用途：创建/提交 assets / 指定资源 / select-render。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`assetId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`kind`, `projectId`, `scope`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/[assetId]/select-render/route.ts`。

### POST /api/assets/{assetId}/update-label

- 用途：创建/提交 assets / 指定资源 / update-label。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`assetId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`kind`, `newName`, `projectId`, `scope`。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/[assetId]/update-label/route.ts`。

### PATCH /api/assets/{assetId}/variants/{variantId}

- 用途：更新 指定资源 / variants / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`assetId`, `variantId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`kind`, `projectId`, `scope`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/[assetId]/variants/[variantId]/route.ts`。

### DELETE /api/assets/{assetId}

- 用途：删除 api / assets / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`assetId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`kind`, `projectId`, `scope`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/[assetId]/route.ts`。

### PATCH /api/assets/{assetId}

- 用途：更新 api / assets / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`assetId`。
- Query 参数：无。
- 请求体：`application/json`；字段：`kind`, `projectId`, `scope`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/[assetId]/route.ts`。

### GET /api/assets

- 用途：查询 api / assets。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：无。
- Query 参数：`folderId`, `kind`, `projectId`, `scope`。
- 请求体：无。
- 响应：JSON；核心字段：`assets`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/route.ts`。

### POST /api/assets

- 用途：创建/提交 api / assets。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`kind`, `projectId`, `scope`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/assets/route.ts`。

### GET /api/projects/{projectId}/assets

- 用途：查询 projects / 指定资源 / assets。
- 鉴权：需要登录用户会话。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`characters`, `locations`, `props`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/assets/route.ts`。

## 项目与画布接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| DELETE | `/api/projects/{projectId}/canvas/{canvasId}/edges/{edgeId}` | 删除 指定资源 / edges / 指定资源 |
| POST | `/api/projects/{projectId}/canvas/{canvasId}/edges` | 创建/提交 canvas / 指定资源 / edges |
| DELETE | `/api/projects/{projectId}/canvas/{canvasId}/nodes/{nodeId}` | 删除 指定资源 / nodes / 指定资源 |
| PATCH | `/api/projects/{projectId}/canvas/{canvasId}/nodes` | 更新 canvas / 指定资源 / nodes |
| POST | `/api/projects/{projectId}/canvas/{canvasId}/nodes` | 创建/提交 canvas / 指定资源 / nodes |
| POST | `/api/projects/{projectId}/canvas/{canvasId}/production-sync` | 创建/提交 canvas / 指定资源 / production-sync |
| DELETE | `/api/projects/{projectId}/canvas/{canvasId}` | 删除 指定资源 / canvas / 指定资源 |
| GET | `/api/projects/{projectId}/canvas/{canvasId}` | 查询 指定资源 / canvas / 指定资源 |
| PATCH | `/api/projects/{projectId}/canvas/{canvasId}` | 更新 指定资源 / canvas / 指定资源 |
| GET | `/api/projects/{projectId}/canvas` | 查询 projects / 指定资源 / canvas |
| POST | `/api/projects/{projectId}/canvas` | 创建/提交 projects / 指定资源 / canvas |
| GET | `/api/projects/{projectId}/costs` | 查询 projects / 指定资源 / costs |
| GET | `/api/projects/{projectId}/data` | 查询 projects / 指定资源 / data |
| GET | `/api/projects/{projectId}/navigation-state` | 查询 projects / 指定资源 / navigation-state |
| GET | `/api/projects/{projectId}/workflow-stage-review` | 查询 projects / 指定资源 / workflow-stage-review |
| PUT | `/api/projects/{projectId}/workflow-stage-review` | 替换/保存 projects / 指定资源 / workflow-stage-review |
| GET | `/api/projects/{projectId}/workflow-state` | 查询 projects / 指定资源 / workflow-state |
| DELETE | `/api/projects/{projectId}` | 删除 api / projects / 指定资源 |
| GET | `/api/projects/{projectId}` | 查询 api / projects / 指定资源 |
| PATCH | `/api/projects/{projectId}` | 更新 api / projects / 指定资源 |
| GET | `/api/projects` | 查询 api / projects |
| POST | `/api/projects` | 创建/提交 api / projects |

### DELETE /api/projects/{projectId}/canvas/{canvasId}/edges/{edgeId}

- 用途：删除 指定资源 / edges / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`canvasId`, `edgeId`, `projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/[canvasId]/edges/[edgeId]/route.ts`。

### POST /api/projects/{projectId}/canvas/{canvasId}/edges

- 用途：创建/提交 canvas / 指定资源 / edges。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`canvasId`, `projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`edge`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/[canvasId]/edges/route.ts`。

### DELETE /api/projects/{projectId}/canvas/{canvasId}/nodes/{nodeId}

- 用途：删除 指定资源 / nodes / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`canvasId`, `nodeId`, `projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/route.ts`。

### PATCH /api/projects/{projectId}/canvas/{canvasId}/nodes

- 用途：更新 canvas / 指定资源 / nodes。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`canvasId`, `projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`updated`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/[canvasId]/nodes/route.ts`。

### POST /api/projects/{projectId}/canvas/{canvasId}/nodes

- 用途：创建/提交 canvas / 指定资源 / nodes。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`canvasId`, `projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`node`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/[canvasId]/nodes/route.ts`。

### POST /api/projects/{projectId}/canvas/{canvasId}/production-sync

- 用途：创建/提交 canvas / 指定资源 / production-sync。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`canvasId`, `projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`canvas`, `edges`, `nodes`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/[canvasId]/production-sync/route.ts`。

### DELETE /api/projects/{projectId}/canvas/{canvasId}

- 用途：删除 指定资源 / canvas / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`canvasId`, `projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/[canvasId]/route.ts`。

### GET /api/projects/{projectId}/canvas/{canvasId}

- 用途：查询 指定资源 / canvas / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`canvasId`, `projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`canvas`, `edges`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/[canvasId]/route.ts`。

### PATCH /api/projects/{projectId}/canvas/{canvasId}

- 用途：更新 指定资源 / canvas / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`canvasId`, `projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`canvas`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/[canvasId]/route.ts`。

### GET /api/projects/{projectId}/canvas

- 用途：查询 projects / 指定资源 / canvas。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`canvases`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/route.ts`。

### POST /api/projects/{projectId}/canvas

- 用途：创建/提交 projects / 指定资源 / canvas。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`canvas`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/canvas/route.ts`。

### GET /api/projects/{projectId}/costs

- 用途：查询 projects / 指定资源 / costs。
- 鉴权：需要登录用户会话。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`currency`, `projectId`, `projectName`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/costs/route.ts`。

### GET /api/projects/{projectId}/data

- 用途：查询 projects / 指定资源 / data。
- 鉴权：需要登录用户会话。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`locations`, `novelPromotionData`, `project`, `props`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/data/route.ts`。

### GET /api/projects/{projectId}/navigation-state

- 用途：查询 projects / 指定资源 / navigation-state。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`navigationLocked`, `projectId`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/navigation-state/route.ts`。

### GET /api/projects/{projectId}/workflow-stage-review

- 用途：查询 projects / 指定资源 / workflow-stage-review。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；核心字段：`episodeId`, `projectId`, `source`, `states`, `updatedAt`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/workflow-stage-review/route.ts`。

### PUT /api/projects/{projectId}/workflow-stage-review

- 用途：替换/保存 projects / 指定资源 / workflow-stage-review。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：`application/json`；字段：`source`, `states`, `updatedAt`。
- 响应：JSON；核心字段：`episodeId`, `projectId`, `source`, `states`, `updatedAt`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/workflow-stage-review/route.ts`。

### GET /api/projects/{projectId}/workflow-state

- 用途：查询 projects / 指定资源 / workflow-state。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；核心字段：`episodeId`, `projectId`, `reviewStateSource`, `reviewStates`, `source`, `stages`, `updatedAt`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/workflow-state/route.ts`。

### DELETE /api/projects/{projectId}

- 用途：删除 api / projects / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`bailianVoicesDeleted`, `bailianVoicesSkippedReferenced`, `cosFilesDeleted`, `cosFilesFailed`, `success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/route.ts`。

### GET /api/projects/{projectId}

- 用途：查询 api / projects / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`project`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/route.ts`。

### PATCH /api/projects/{projectId}

- 用途：更新 api / projects / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`projectId`。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`project`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/[projectId]/route.ts`。

### GET /api/projects

- 用途：查询 api / projects。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`page`, `pageSize`, `search`。
- 请求体：无。
- 响应：JSON；核心字段：`page`, `pageSize`, `pagination`, `projects`, `total`, `totalPages`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/route.ts`。

### POST /api/projects

- 用途：创建/提交 api / projects。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`project`。
- 备注：多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/projects/route.ts`。

## 工作流阶段接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/workflow/projects/{projectId}/stages/{stage}/approve` | 创建/提交 stages / 指定资源 / approve |
| POST | `/api/workflow/projects/{projectId}/stages/{stage}/cancel` | 创建/提交 stages / 指定资源 / cancel |
| POST | `/api/workflow/projects/{projectId}/stages/{stage}/retry` | 创建/提交 stages / 指定资源 / retry |
| POST | `/api/workflow/projects/{projectId}/stages/{stage}/run` | 创建/提交 stages / 指定资源 / run |
| POST | `/api/workflow/projects/{projectId}/stages/{stage}/unapprove` | 创建/提交 stages / 指定资源 / unapprove |
| GET | `/api/workflow/projects/{projectId}/stages/{stage}` | 查询 指定资源 / stages / 指定资源 |
| GET | `/api/workflow/projects/{projectId}/stages` | 查询 projects / 指定资源 / stages |
| GET | `/api/workflow/projects/{projectId}` | 查询 workflow / projects / 指定资源 |

### POST /api/workflow/projects/{projectId}/stages/{stage}/approve

- 用途：创建/提交 stages / 指定资源 / approve。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`, `stage`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workflow/projects/[projectId]/stages/[stage]/approve/route.ts`。

### POST /api/workflow/projects/{projectId}/stages/{stage}/cancel

- 用途：创建/提交 stages / 指定资源 / cancel。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`, `stage`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workflow/projects/[projectId]/stages/[stage]/cancel/route.ts`。

### POST /api/workflow/projects/{projectId}/stages/{stage}/retry

- 用途：创建/提交 stages / 指定资源 / retry。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`, `stage`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`, `input`。
- 响应：JSON；核心字段：`success`。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workflow/projects/[projectId]/stages/[stage]/retry/route.ts`。

### POST /api/workflow/projects/{projectId}/stages/{stage}/run

- 用途：创建/提交 stages / 指定资源 / run。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`, `stage`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`, `input`, `options`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workflow/projects/[projectId]/stages/[stage]/run/route.ts`。

### POST /api/workflow/projects/{projectId}/stages/{stage}/unapprove

- 用途：创建/提交 stages / 指定资源 / unapprove。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`, `stage`。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workflow/projects/[projectId]/stages/[stage]/unapprove/route.ts`。

### GET /api/workflow/projects/{projectId}/stages/{stage}

- 用途：查询 指定资源 / stages / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`, `stage`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；核心字段：`blocker`, `episodeId`, `errorCode`, `errorMessage`, `label`, `lastRunId`, `lastTaskId`, `locked`, `progress`, `projectId`, `readonly`, `reviewState` 等。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workflow/projects/[projectId]/stages/[stage]/route.ts`。

### GET /api/workflow/projects/{projectId}/stages

- 用途：查询 projects / 指定资源 / stages。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；核心字段：`activeStage`, `episodeId`, `projectId`, `scopeId`, `stages`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workflow/projects/[projectId]/stages/route.ts`。

### GET /api/workflow/projects/{projectId}

- 用途：查询 workflow / projects / 指定资源。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：`projectId`。
- Query 参数：`episodeId`。
- 请求体：无。
- 响应：JSON；核心字段：`activeStage`, `episodeId`, `projectId`, `scopeId`, `stages`, `workflow`。
- 备注：`projectId` 必须属于当前用户可访问项目。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workflow/projects/[projectId]/route.ts`。

## 任务与运行时接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/runs/{runId}/cancel` | 创建/提交 runs / 指定资源 / cancel |
| GET | `/api/runs/{runId}/events` | 查询 runs / 指定资源 / events |
| POST | `/api/runs/{runId}/steps/{stepKey}/retry` | 创建/提交 steps / 指定资源 / retry |
| GET | `/api/runs/{runId}` | 查询 api / runs / 指定资源 |
| GET | `/api/runs` | 查询 api / runs |
| POST | `/api/runs` | 创建/提交 api / runs |
| GET | `/api/sse` | 查询 api / sse |
| POST | `/api/task-target-states` | 创建/提交 api / task-target-states |
| DELETE | `/api/tasks/{taskId}` | 删除 api / tasks / 指定资源 |
| GET | `/api/tasks/{taskId}` | 查询 api / tasks / 指定资源 |
| POST | `/api/tasks/dismiss` | 创建/提交 api / tasks / dismiss |
| GET | `/api/tasks` | 查询 api / tasks |

### POST /api/runs/{runId}/cancel

- 用途：创建/提交 runs / 指定资源 / cancel。
- 鉴权：需要登录用户会话。
- 路径参数：`runId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`run`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/runs/[runId]/cancel/route.ts`。

### GET /api/runs/{runId}/events

- 用途：查询 runs / 指定资源 / events。
- 鉴权：需要登录用户会话。
- 路径参数：`runId`。
- Query 参数：`afterSeq`, `limit`。
- 请求体：无。
- 响应：JSON；核心字段：`afterSeq`, `events`, `runId`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/runs/[runId]/events/route.ts`。

### POST /api/runs/{runId}/steps/{stepKey}/retry

- 用途：创建/提交 steps / 指定资源 / retry。
- 鉴权：需要登录用户会话。
- 路径参数：`runId`, `stepKey`。
- Query 参数：无。
- 请求体：`application/json`；字段：`modelOverride`, `reason`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/runs/[runId]/steps/[stepKey]/retry/route.ts`。

### GET /api/runs/{runId}

- 用途：查询 api / runs / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`runId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`artifacts`, `checkpoints`, `events`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/runs/[runId]/route.ts`。

### GET /api/runs

- 用途：查询 api / runs。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：无。
- Query 参数：`episodeId`, `limit`, `projectId`, `status`, `targetId`, `targetType`, `workflowType`。
- 请求体：无。
- 响应：JSON；核心字段：`runs`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/runs/route.ts`。

### POST /api/runs

- 用途：创建/提交 api / runs。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`episodeId`, `input`, `projectId`, `targetId`, `targetType`, `taskId`, `taskType`, `workflowType`。
- 响应：JSON；核心字段：`run`, `runId`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/runs/route.ts`。

### GET /api/sse

- 用途：查询 api / sse。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：无。
- Query 参数：`episodeId`, `projectId`。
- 请求体：无。
- 响应：SSE 事件流；持续返回任务/项目事件。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/sse/route.ts`。

### POST /api/task-target-states

- 用途：创建/提交 api / task-target-states。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`projectId`, `targetId`, `targetType`, `targets`, `types`。
- 响应：JSON；核心字段：`states`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/task-target-states/route.ts`。

### DELETE /api/tasks/{taskId}

- 用途：删除 api / tasks / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`taskId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`cancelled`, `error`, `success`, `task`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/tasks/[taskId]/route.ts`。

### GET /api/tasks/{taskId}

- 用途：查询 api / tasks / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`taskId`。
- Query 参数：`eventsLimit`, `includeEvents`。
- 请求体：无。
- 响应：JSON；核心字段：`error`, `task`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/tasks/[taskId]/route.ts`。

### POST /api/tasks/dismiss

- 用途：创建/提交 api / tasks / dismiss。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`dismissed`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/tasks/dismiss/route.ts`。

### GET /api/tasks

- 用途：查询 api / tasks。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`limit`, `projectId`, `status`, `targetId`, `targetType`, `type`。
- 请求体：无。
- 响应：JSON；核心字段：`tasks`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/tasks/route.ts`。

## 用户配置、费用与偏好接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/user-preference` | 查询 api / user-preference |
| PATCH | `/api/user-preference` | 更新 api / user-preference |
| POST | `/api/user/ai-story-expand` | 创建/提交 api / user / ai-story-expand |
| POST | `/api/user/api-config/assistant/probe-media-template` | 创建/提交 api-config / assistant / probe-media-template |
| POST | `/api/user/api-config/assistant/validate-media-template` | 创建/提交 api-config / assistant / validate-media-template |
| POST | `/api/user/api-config/probe-model-llm-protocol` | 创建/提交 user / api-config / probe-model-llm-protocol |
| POST | `/api/user/api-config/test-connection` | 创建/提交 user / api-config / test-connection |
| POST | `/api/user/api-config/test-provider` | 创建/提交 user / api-config / test-provider |
| GET | `/api/user/api-config` | 查询 api / user / api-config |
| PUT | `/api/user/api-config` | 替换/保存 api / user / api-config |
| POST | `/api/user/assistant/chat` | 创建/提交 user / assistant / chat |
| GET | `/api/user/balance` | 查询 api / user / balance |
| GET | `/api/user/costs/details` | 查询 user / costs / details |
| GET | `/api/user/costs` | 查询 api / user / costs |
| GET | `/api/user/models` | 查询 api / user / models |
| POST | `/api/user/seedance-assets-config/test` | 创建/提交 user / seedance-assets-config / test |
| GET | `/api/user/seedance-assets-config` | 查询 api / user / seedance-assets-config |
| PUT | `/api/user/seedance-assets-config` | 替换/保存 api / user / seedance-assets-config |
| GET | `/api/user/storage-config` | 查询 api / user / storage-config |
| POST | `/api/user/storage-config` | 创建/提交 api / user / storage-config |
| PUT | `/api/user/storage-config` | 替换/保存 api / user / storage-config |
| GET | `/api/user/transactions` | 查询 api / user / transactions |

### GET /api/user-preference

- 用途：查询 api / user-preference。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`preference`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user-preference/route.ts`。

### PATCH /api/user-preference

- 用途：更新 api / user-preference。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`preference`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user-preference/route.ts`。

### POST /api/user/ai-story-expand

- 用途：创建/提交 api / user / ai-story-expand。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`prompt`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/ai-story-expand/route.ts`。

### POST /api/user/api-config/assistant/probe-media-template

- 用途：创建/提交 api-config / assistant / probe-media-template。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`modelId`, `providerId`, `sampleImage`, `samplePrompt`, `template`。
- 响应：JSON；核心字段：`code`, `issues`, `success`, `verified`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/api-config/assistant/probe-media-template/route.ts`。

### POST /api/user/api-config/assistant/validate-media-template

- 用途：创建/提交 api-config / assistant / validate-media-template。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`providerId`, `template`。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/api-config/assistant/validate-media-template/route.ts`。

### POST /api/user/api-config/probe-model-llm-protocol

- 用途：创建/提交 user / api-config / probe-model-llm-protocol。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`modelId`, `providerId`。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/api-config/probe-model-llm-protocol/route.ts`。

### POST /api/user/api-config/test-connection

- 用途：创建/提交 user / api-config / test-connection。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`latencyMs`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/api-config/test-connection/route.ts`。

### POST /api/user/api-config/test-provider

- 用途：创建/提交 user / api-config / test-provider。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`latencyMs`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/api-config/test-provider/route.ts`。

### GET /api/user/api-config

- 用途：查询 api / user / api-config。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`capabilityDefaults`, `defaultModels`, `models`, `pricingDisplay`, `providers`, `workflowConcurrency`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/api-config/route.ts`。

### PUT /api/user/api-config

- 用途：替换/保存 api / user / api-config。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`capabilityDefaults`, `defaultModels`, `models`, `providers`, `workflowConcurrency`。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/api-config/route.ts`。

### POST /api/user/assistant/chat

- 用途：创建/提交 user / assistant / chat。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`assistantId`, `context`, `messages`。
- 响应：JSON；返回对应业务结果。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/assistant/chat/route.ts`。

### GET /api/user/balance

- 用途：查询 api / user / balance。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`balance`, `currency`, `frozenAmount`, `success`, `totalSpent`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/balance/route.ts`。

### GET /api/user/costs/details

- 用途：查询 user / costs / details。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`page`, `pageSize`。
- 请求体：无。
- 响应：JSON；核心字段：`currency`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/costs/details/route.ts`。

### GET /api/user/costs

- 用途：查询 api / user / costs。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`byProject`, `currency`, `total`, `userId`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/costs/route.ts`。

### GET /api/user/models

- 用途：查询 api / user / models。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`audio`, `image`, `lipsync`, `llm`, `text`, `video`, `vision`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/models/route.ts`。

### POST /api/user/seedance-assets-config/test

- 用途：创建/提交 user / seedance-assets-config / test。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`assetGroupCount`, `code`, `configured`, `latencyMs`, `message`, `projectName`, `success`, `totalAssetGroupCount`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/seedance-assets-config/test/route.ts`。

### GET /api/user/seedance-assets-config

- 用途：查询 api / user / seedance-assets-config。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`accessKeyId`, `configured`, `hasAccessKeyId`, `hasSecretAccessKey`, `projectName`, `secretAccessKey`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/seedance-assets-config/route.ts`。

### PUT /api/user/seedance-assets-config

- 用途：替换/保存 api / user / seedance-assets-config。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/seedance-assets-config/route.ts`。

### GET /api/user/storage-config

- 用途：查询 api / user / storage-config。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`config`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/storage-config/route.ts`。

### POST /api/user/storage-config

- 用途：创建/提交 api / user / storage-config。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`httpStatus`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/storage-config/route.ts`。

### PUT /api/user/storage-config

- 用途：替换/保存 api / user / storage-config。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`accessKey`, `bucket`, `endpoint`, `publicEndpoint`, `region`, `secretKey`。
- 响应：JSON；核心字段：`config`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/storage-config/route.ts`。

### GET /api/user/transactions

- 用途：查询 api / user / transactions。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`endDate`, `page`, `pageSize`, `startDate`, `type`。
- 请求体：无。
- 响应：JSON；核心字段：`currency`, `page`, `pageSize`, `pagination`, `total`, `totalPages`, `transactions`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/user/transactions/route.ts`。

## Super Agent 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/super-agent/chat-edit` | 创建/提交 api / super-agent / chat-edit |
| POST | `/api/super-agent/execute` | 创建/提交 api / super-agent / execute |
| POST | `/api/super-agent/plan` | 创建/提交 api / super-agent / plan |
| GET | `/api/super-agent/skills` | 查询 api / super-agent / skills |

### POST /api/super-agent/chat-edit

- 用途：创建/提交 api / super-agent / chat-edit。
- 鉴权：需要登录并具备项目访问权限。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`allowVideoGeneration`, `episodeId`, `executionMode`, `instruction`, `projectId`, `referenceImageUrls`, `selectedSkill`。
- 响应：JSON；返回对应业务结果。
- 备注：多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/super-agent/chat-edit/route.ts`。

### POST /api/super-agent/execute

- 用途：创建/提交 api / super-agent / execute。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/super-agent/execute/route.ts`。

### POST /api/super-agent/plan

- 用途：创建/提交 api / super-agent / plan。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；返回对应业务结果。
- 备注：多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/super-agent/plan/route.ts`。

### GET /api/super-agent/skills

- 用途：查询 api / super-agent / skills。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；返回对应业务结果。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/super-agent/skills/route.ts`。

## 视频增强接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/video-enhance/{taskId}/download` | 查询 video-enhance / 指定资源 / download |
| GET | `/api/video-enhance/{taskId}` | 查询 api / video-enhance / 指定资源 |
| POST | `/api/video-enhance/save-to-path` | 创建/提交 api / video-enhance / save-to-path |
| POST | `/api/video-enhance/select-directory` | 创建/提交 api / video-enhance / select-directory |
| GET | `/api/video-enhance` | 查询 api / video-enhance |
| POST | `/api/video-enhance` | 创建/提交 api / video-enhance |

### GET /api/video-enhance/{taskId}/download

- 用途：查询 video-enhance / 指定资源 / download。
- 鉴权：需要登录用户会话。
- 路径参数：`taskId`。
- Query 参数：无。
- 请求体：无。
- 响应：文件或媒体流响应；包含合适的 `content-type` / 下载头。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/video-enhance/[taskId]/download/route.ts`。

### GET /api/video-enhance/{taskId}

- 用途：查询 api / video-enhance / 指定资源。
- 鉴权：需要登录用户会话。
- 路径参数：`taskId`。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`finishedAt`, `record`, `result`, `uploadedAt`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/video-enhance/[taskId]/route.ts`。

### POST /api/video-enhance/save-to-path

- 用途：创建/提交 api / video-enhance / save-to-path。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`directoryPath`, `taskIds`。
- 响应：JSON；核心字段：`directoryPath`, `failed`, `failedCount`, `saved`, `savedCount`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/video-enhance/save-to-path/route.ts`。

### POST /api/video-enhance/select-directory

- 用途：创建/提交 api / video-enhance / select-directory。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`directoryPath`, `selected`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/video-enhance/select-directory/route.ts`。

### GET /api/video-enhance

- 用途：查询 api / video-enhance。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`limit`。
- 请求体：无。
- 响应：JSON；核心字段：`success`, `tasks`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/video-enhance/route.ts`。

### POST /api/video-enhance

- 用途：创建/提交 api / video-enhance。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`multipart/form-data`；字段：`callbackArgs`, `clientToken`, `file`, `fps`, `resolution`, `resolutionLimit`, `scene`, `toolVersion`, `videoUrl`。
- 响应：JSON；异步任务结果，核心字段通常为 `async: true`、`taskId`，部分接口包含 `runId`、`targetType`、`targetId` 或业务对象。
- 备注：上传类字段使用 `multipart/form-data`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/video-enhance/route.ts`。

## 认证接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/auth/{nextauth...}` | 查询 NextAuth 内部认证端点 |
| POST | `/api/auth/{nextauth...}` | 提交 NextAuth 内部认证端点；credentials 登录回调带 IP 限流 |
| POST | `/api/auth/register` | 创建/提交 api / auth / register |

### GET /api/auth/{nextauth...}

- 用途：查询 NextAuth 内部认证端点，例如 session、csrf、providers 等。
- 鉴权：公开/NextAuth 认证流程。
- 路径参数：`nextauth`。
- Query 参数：由 NextAuth 内部协议定义。
- 请求体：无。
- 响应：NextAuth 标准响应；可能为 JSON、重定向或框架内部响应。
- 源码：`src/app/api/auth/[...nextauth]/route.ts`。

### POST /api/auth/{nextauth...}

- 用途：提交 NextAuth 内部认证端点；`callback/credentials` 登录行为会先按客户端 IP 做限流。
- 鉴权：公开/NextAuth 认证流程。
- 路径参数：`nextauth`。
- Query 参数：由 NextAuth 内部协议定义。
- 请求体：由 NextAuth 内部协议定义；credentials 登录回调通常包含登录凭据。
- 响应：NextAuth 标准响应；限流时返回 JSON `{ url }`，状态码 `429`，并设置 `Retry-After`。
- 源码：`src/app/api/auth/[...nextauth]/route.ts`。

### POST /api/auth/register

- 用途：创建/提交 api / auth / register。
- 鉴权：公开/NextAuth 认证流程。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`name`, `password`。
- 响应：JSON；核心字段：`id`, `message`, `name`, `success`, `user`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/auth/register/route.ts`。

## 系统、存储、文件与基础设施接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/admin/download-logs` | 查询 api / admin / download-logs |
| GET | `/api/cos/image` | 查询 api / cos / image |
| GET | `/api/feedback` | 查询 api / feedback |
| PATCH | `/api/feedback` | 更新 api / feedback |
| POST | `/api/feedback` | 创建/提交 api / feedback |
| GET | `/api/files/{path...}` | 查询 api / files / 指定资源 |
| GET | `/api/prompt-templates` | 查询 api / prompt-templates |
| PATCH | `/api/prompt-templates` | 更新 api / prompt-templates |
| GET | `/api/service-records` | 查询 api / service-records |
| GET | `/api/storage/sign` | 查询 api / storage / sign |
| GET | `/api/system/boot-id` | 查询 api / system / boot-id |
| GET | `/api/system/pricing` | 查询 api / system / pricing |
| GET | `/api/system/status` | 查询 api / system / status |
| GET | `/api/system/update-check` | 查询 api / system / update-check |
| POST | `/api/system/update-check` | 创建/提交 api / system / update-check |
| PATCH | `/api/workspace/team-overview/seats` | 更新 workspace / team-overview / seats |
| GET | `/api/workspace/team-overview` | 查询 api / workspace / team-overview |

### GET /api/admin/download-logs

- 用途：查询 api / admin / download-logs。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：文件或媒体流响应；包含合适的 `content-type` / 下载头。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/admin/download-logs/route.ts`。

### GET /api/cos/image

- 用途：查询 api / cos / image。
- 鉴权：基础设施接口；按部署环境和调用方控制访问。
- 路径参数：无。
- Query 参数：`expires`, `key`。
- 请求体：无。
- 响应：JSON 签名 URL/代理 URL，或存储相关访问地址。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/cos/image/route.ts`。

### GET /api/feedback

- 用途：查询 api / feedback。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`records`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/feedback/route.ts`。

### PATCH /api/feedback

- 用途：更新 api / feedback。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`description`, `id`, `route`, `status`, `title`, `type`, `userAgent`。
- 响应：JSON；核心字段：`records`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/feedback/route.ts`。

### POST /api/feedback

- 用途：创建/提交 api / feedback。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：`description`, `id`, `route`, `title`, `type`, `userAgent`。
- 响应：JSON；核心字段：`records`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/feedback/route.ts`。

### GET /api/files/{path...}

- 用途：查询 api / files / 指定资源。
- 鉴权：基础设施接口；按部署环境和调用方控制访问。
- 路径参数：`path`。
- Query 参数：无。
- 请求体：无。
- 响应：文件或媒体流响应；包含合适的 `content-type` / 下载头。
- 源码：`src/app/api/files/[...path]/route.ts`。

### GET /api/prompt-templates

- 用途：查询 api / prompt-templates。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：`locale`, `promptId`。
- 请求体：无。
- 响应：JSON；核心字段：`defaultTemplate`, `locale`, `promptId`, `prompts`, `userTemplate`, `variableKeys`。
- 备注：多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/prompt-templates/route.ts`。

### PATCH /api/prompt-templates

- 用途：更新 api / prompt-templates。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`success`。
- 备注：多语言参数通常支持 `zh` / `en`。 统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/prompt-templates/route.ts`。

### GET /api/service-records

- 用途：查询 api / service-records。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/service-records/route.ts`。

### GET /api/storage/sign

- 用途：查询 api / storage / sign。
- 鉴权：基础设施接口；按部署环境和调用方控制访问。
- 路径参数：无。
- Query 参数：`expires`, `key`。
- 请求体：无。
- 响应：JSON 签名 URL/代理 URL，或存储相关访问地址。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/storage/sign/route.ts`。

### GET /api/system/boot-id

- 用途：查询 api / system / boot-id。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`bootId`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/system/boot-id/route.ts`。

### GET /api/system/pricing

- 用途：查询 api / system / pricing。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`byApiType`, `currency`, `success`, `totalModels`, `version`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/system/pricing/route.ts`。

### GET /api/system/status

- 用途：查询 api / system / status。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；返回查询到或创建/更新后的业务对象。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/system/status/route.ts`。

### GET /api/system/update-check

- 用途：查询 api / system / update-check。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`records`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/system/update-check/route.ts`。

### POST /api/system/update-check

- 用途：创建/提交 api / system / update-check。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`records`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/system/update-check/route.ts`。

### PATCH /api/workspace/team-overview/seats

- 用途：更新 workspace / team-overview / seats。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：`application/json`；字段：按业务对象提交（route 将整个 JSON 传入下游服务）。
- 响应：JSON；核心字段：`displayName`, `id`, `mode`, `profile`, `seatLimit`, `source`, `success`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workspace/team-overview/seats/route.ts`。

### GET /api/workspace/team-overview

- 用途：查询 api / workspace / team-overview。
- 鉴权：需要登录用户会话。
- 路径参数：无。
- Query 参数：无。
- 请求体：无。
- 响应：JSON；核心字段：`displayName`, `email`, `id`, `mode`, `name`, `profile`, `seatLimit`, `source`, `success`, `teamProfileId`, `teamStateSource`。
- 备注：统一错误由 `apiHandler` 包装，常见错误形态为 `{ error: { code, message? } }`。
- 源码：`src/app/api/workspace/team-overview/route.ts`。

## 覆盖校验

- Route 文件数：190
- 方法级接口数：255
- 生成口径：扫描 `src/app/api/**/route.ts` 中导出的 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`。
