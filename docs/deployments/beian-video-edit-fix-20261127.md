# 发布与验证记录：Seedance 2.5 参考视频编辑修复 + 国际版（kzep）接入（2026-11-27）

状态：**两版均已发布到备案机 `14.103.65.61`，当前线上版本为 `20261127-sd25-intl`，`norivideo-app-1` / `norivideo-admin-1` 均 healthy**。代码未进本地 main，未 `git commit/push`。

---

## 一、发布 1：`20261127-video-edit-fix`（Seedance 2.5 参考视频编辑 & 专用 `video_edit` 节点修复）

### 1.1 发布元数据
- 发布名：`20261127-video-edit-fix`
- 基线发布：`20261126-asset-sync2`（基线源码 sha256：`39896639c4aed8e3565ec15b521c8b7683a5393092cdda964806408af4126cbf`）
- 源码 sha256：`16d2a35fb6ca27401a01cc8223418a273939bd462e0ef03a4e3475c444c58c61`（归档于 `/opt/norivideo/releases/20261127-video-edit-fix/build/source.tar.gz`）
- 镜像：`norivideo:release-20261127-video-edit-fix`（`sha256:2fdf563195262ce8ae47df051a304fb13d883a0b1a930f493ce515550a5ac680`）
- 预检端口 / TAG：`13890` / `videoeditfix`
- 流程结果：`prepare.done=0`、`build.done=0`（`next build` + TypeScript 检查通过）、`verify=0`（独立容器 HTTP 200）、`switch.done=0`，`build/app` 与 `build/artifacts` 已清理。

### 1.2 改动文件（相对 `20261126-asset-sync2` 共 12 个文件，均保持纯 CRLF）
- **参考视频编辑模式 & Provider（5 个文件）**：
  - `src/lib/canvas/generator-options.ts`：导出 `CANVAS_VIDEO_OMNI_REFERENCE_TASK_TYPES`（`'auto' | 'reference' | 'edit' | 'extend'`），在 `normalizeCanvasVideoGenerationOptions` 中校验并透传 `omniReferenceTaskType`（缺省时不注入）。
  - `src/app/api/frameos/toolbox/generate/route.ts`：接收并校验 `options.omniReferenceTaskType`（显式 `'edit' | 'extend'` 要求 Seedance 2.5 + `inputMode === 'text'` + 至少 1 个参考视频），贯穿 `requestHash`、`asset.params`、`payload` 与节点绑定。
  - `src/lib/providers/kuaizi/video.ts`：移除弱提示词正则；将 `omniReferenceTaskType` 解析提前至 `duration` 校验之前，允许 Seedance 2.5 在 `'edit'` 或参考视频自动模式下传入 `duration: -1`；显式 `'edit'` 强制上游 `ratio: 'adaptive'` 与 `duration: -1`；显式 `'extend'` 强制 `ratio: 'adaptive'`；导出 `buildSeedanceRequest`。
  - `src/lib/providers/huimengi/video.ts`：同步移除零散词正则，允许 `'edit'` / 参考视频自动模式下的 `duration: -1` 并按模式强制 `adaptive` / `-1`。
  - `src/lib/workers/handlers/toolbox-video-task-handler.ts`：移除弱词正则，读取显式 `omniReferenceTaskType`；导出 `classifySeedanceReferenceRetry` 并在 `resolveVideoSourceFromGeneration` 外围增加单次安全兜底重试（覆盖 `TaskTypeConstraint` 与 `pe_classification` 400 冲突，且仅在 `!(await getTaskExistingExternalId(taskId))` 时触发）。
- **专用 `video_edit` 画布操作后端（3 个文件）**：
  - `src/app/api/projects/[projectId]/canvas/[canvasId]/operations/route.ts`：`Operation` 类型与 `POST` 白名单补齐 `'video_edit'`；统一使用 `getWorkspaceActor` 解析工作区与子账号作用域并写入 `actorId`。
  - `src/lib/canvas/operation-task.ts`：`CanvasOperationTaskPayload` 透传可选 `actorId`；`resolveCanvasOperationSource` 支持子账号个人素材、跨项目可读素材、`/m/` 与 `/api/storage/sign` 键解析及上游视频节点回退。
  - `src/lib/workers/handlers/canvas-operation-task-handler.ts`：传递正数能力合法时长（4–30s）与 `aspectRatio: 'adaptive'`、`omniReferenceTaskType: 'edit'`；`resolveVideoEditReferenceUrl` 支持子账号个人参考素材与相对 URL 签名回退；写回节点与 `canvas.revision + 1` 包裹在同一 `prisma.$transaction` 内并返回真实 `canvasRevision`。
- **画布前端 UI（4 个文件）**：
  - `src/features/canvas/types.ts`、`src/features/canvas/components/CanvasGenerator.tsx`、`src/features/canvas/CanvasGraph.tsx`、`src/features/canvas/nodes/VideoEditNode.tsx`：全能参考关联参考视频时展示「参考视频模式」（`自动` / `编辑参考视频` / `延长参考视频`）与编辑模式提示；`submitVideoEdit` 提交前通过 `prepareNodeForWrite` + `prepareGenerationSubmission()` 落盘并携带 `references`；`VideoEditNode` 补齐 4–30s 区间校验与 `flushSync` 同步写入。

---

## 二、发布 2：`20261127-sd25-intl`（Kuaizi Seedance 2.5 国际版 `kzep` 接入，当前线上版本）

### 2.1 发布元数据
- 发布名：`20261127-sd25-intl`
- 基线发布：`20261127-video-edit-fix`（基线源码 sha256：`16d2a35fb6ca27401a01cc8223418a273939bd462e0ef03a4e3475c444c58c61`）
- 源码 sha256：`a46fb312932aaba22308f3fb3fe71edd9d465b8611ca896359b43f39c3987240`（归档于 `/opt/norivideo/releases/20261127-sd25-intl/build/source.tar.gz`）
- 镜像：`norivideo:release-20261127-sd25-intl`（`sha256:da31a0a736e24989fa0bba1c14e4dba10f09af6947e6c9d8f08c575d30c45bcc`）
- 预检端口 / TAG：`13900` / `sd25intl`
- 流程结果：`prepare.done=0`、`build.done=0`（`next build` + TypeScript 检查通过）、`verify=0`（独立容器 HTTP 200）、`switch.done=0`（无 schema 变更，`/opt/norivideo/.env` 保持不变），`build/app` 与 `build/artifacts` 已清理。
- 回滚镜像：`norivideo:release-20261127-video-edit-fix`（或 `norivideo:release-20261126-asset-sync2`）

### 2.2 改动文件（相对 `20261127-video-edit-fix` 共 18 个文件，均保持纯 CRLF，源码零硬编码 `kzep`）
- **Kuaizi Provider & 素材通道（5 个文件）**：
  - `src/lib/providers/kuaizi/catalog.ts`：注册语义模型 `doubao-seedance-2-5-260628-intl`（`kuaizi::doubao-seedance-2-5-260628-intl`，`Seedance 2.5 国际版 (Kuaizi)`，`family: 'seedance'`）。
  - `src/lib/providers/kuaizi/client.ts`：`postKuaiziApiKey` 支持可选 `extraHeaders`。
  - `src/lib/providers/kuaizi/video.ts`：新增国际版模型限额（`480p/720p/1080p`，4–30s，30 图 / 10 视频 / 10 音频）；提交 Ark v3 时将 `body.model` 替换为配置中的 `seedance25IntlKzep`（缺失或非法时快速失败 `KUAIZI_SEEDANCE_INTL_KZEP_MISSING`），轮询 `externalId` 保持语义 `modelId` 无需 `kzep`。
  - `src/lib/providers/kuaizi/assets.ts` & `src/lib/volcengine/seedance-assets-provider.ts`：写操作（`CreateAssetGroup` / `CreateAsset`）携带 `Kzep` 请求头，读操作不带；国际版素材 `scope` 哈希与国内版隔离。
- **能力表、定价、计费与特性门控（6 个文件）**：
  - `standards/capabilities/kuaizi.catalog.json`：新增 `doubao-seedance-2-5-260628-intl` 能力配置（`4..30s`、`480p/720p/1080p`、`firstlastframe`、`generateAudio`、30/10/10 限额）。
  - `standards/pricing/nori-kuaizi.pricing.json` & `src/lib/billing/cost.ts`：按 2026-11-26 筷子定价表配置 token 阶梯（`480p/720p`: `70/42`，`1080p`: `77/46`）并登记至 `SEEDANCE_2_TOKEN_PRICED_MODEL_IDS`。
  - `src/lib/canvas/generator-options.ts`、`src/app/api/novel-promotion/[projectId]/character-audition/route.ts`、`src/app/api/novel-promotion/[projectId]/generate-video/route.ts`：纳入 `isSeedance25VideoModelKey` 与 Seedance 2.x 判定，画布自动获得 `adaptive` 比例与参考视频编辑/延长控件。
- **服务配置、模型可用性/展示与管理后台 UI（7 个文件）**：
  - `src/lib/service-config.ts`、`src/lib/api-config.ts`、`src/lib/platform-services/config.ts`、`src/lib/platform-services/model-availability.ts`、`src/lib/platform-services/model-selection.ts`：在 `kuaizi` provider 上支持 `seedance25IntlKzep`（含环境变量 `KUAIZI_SEEDANCE_25_INTL_KZEP` 回退与 `/^kzep_[A-Za-z0-9_-]+$/` 校验）；未配置 EP 时阻止开启或选用国际版模型；展示名映射为 `Kuaizi · Seedance 2.5 国际版`。
  - `src/components/admin/platform-admin-services.ts`、`src/components/admin/PlatformAdminServicesPanels.tsx`：后台 Kuaizi 卡片新增 `Seedance 2.5 国际版 EP (kzep)` 输入框，并对国际版视频开关增加 `未配置 EP` 守卫。

### 2.3 运行时配置生效（`14.103.65.61:/opt/norivideo/data/services.prod.json`）
- 修改前已备份至 `/opt/norivideo/backups/20261127-sd25-intl/services.prod.json.before`（权限 `600`）。
- 原子写入以下两项（其余 provider / key / 模型配置原样保留）：
  - `llm.providers[id="kuaizi"].seedance25IntlKzep = "<REDACTED_KZEP>"`
  - `llm.modelEnabled["kuaizi::doubao-seedance-2-5-260628-intl"] = true`
- `service-config.ts` 通过 `mtimeMs:size:ino` 自动热加载，无需重启容器即可生效。

---

## 三、验证结果汇总

### 3.1 独立 Node 单元测试
- **`/tmp/vedittest/run-tests.mts`（18 / 18 PASS）**：覆盖 `buildSeedanceRequest`（`edit` + `-1` / 正数时长、缺省与 `auto` 零散词不误判、`extend`、无参考视频报错、非 2.5 模型拒绝）、`classifySeedanceReferenceRetry`（`TaskTypeConstraint` / `pe_classification` / 忽略 500 与轮询错误）、`parseCanvasAsyncOperationInput` & `parseCanvasOperationTaskPayload`（4–30s 边界、references、`actorId`）、`normalizeCanvasVideoGenerationOptions`。
- **`/tmp/vedittest/run-sd25-intl-tests.mts`（7 / 7 PASS）**：覆盖国际版 catalog 注册、`buildSeedanceRequest` / `generateKuaiziVideo` 将 `body.model` 替换为 `kzep` 且 `externalId` 保持语义 `modelId`、缺失/非法 `kzep` 拒发、`KuaiziAssetsClient` 仅在写操作带 `Kzep` 头、`seedance-assets-provider` 国内外 `scope` 隔离、`isSeedance25VideoModelKey` / `isSeedance2TokenPricedModel` / `isUsableKuaiziKzep` / `providerModelDisplayName` / `listConfiguredSelectableModels` / `resolveConfiguredModelAvailability`。

### 3.2 线上实时验证（`14.103.65.61`，版本 `20261127-sd25-intl`）
- **热加载与可选视频模型**：在 `norivideo-app-1` 容器内直接执行编译后的 `getPlatformServiceConfigResponse()` 与 `listConfiguredSelectableModels(cfg, 'video')`，确认实时读到 `kuaizi.seedance25IntlKzep = "<REDACTED_KZEP>"`，且 `kuaizi::doubao-seedance-2-5-260628-intl` 已进入可选视频模型列表；编译产物 `/app/.next/server/app/api/frameos/generation-config/route.js` 包含展示名 `Kuaizi · Seedance 2.5 国际版`，`/app/standards/capabilities/kuaizi.catalog.json` 与 `/app/standards/pricing/nori-kuaizi.pricing.json` 均包含该模型。
- **专用 `video_edit` 路由白名单**：`/app/.next/server/app/api/projects/[projectId]/canvas/[canvasId]/operations/route.js` 确认 `POST` 白名单包含 `"video_edit"`。
- **前端编译产物**：
  - `/app/.next/static/chunks/9387-4520e06170f81127.js` 包含 `参考视频模式`、`编辑参考视频`、`视频编辑区间最多支持 30 秒`。
  - `/app/.next/static/chunks/app/[locale]/admin/services/page-fa7f6d2a77a32dde.js` 包含 `Seedance 2.5 国际版 EP (kzep)`。
- **服务健康与 HTTPS**：`norivideo-app-1` 与 `norivideo-admin-1` 均为 `healthy`；`https://lanmiaoai.com/zh/auth/signin` 返回 `HTTP 200`；`docker logs norivideo-app-1 --since 10m` 无启动或运行时报错。
