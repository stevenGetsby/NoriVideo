# TGG 视频模型接入（2026-11-17）

## 发布范围

仅发布 TGG 视频服务商相关的增量代码，基线为线上 `20261117-perf-media`（source `b7cf2cc8…`）。未携带当前工作区中 2026-11-17 03:31 之后的小程序（mp）消费者端未审查改动，这些改动未上线。

增量文件（15 个修改 + 3 个删除，已逐个 `cmp` 与工作区一致）：

- TGG 适配：`src/lib/providers/tgg/{catalog,types,video}.ts`、`model-profiles.json`；删除 `tgg/routes.ts`。
- 服务配置与路由：`src/lib/platform-services/{config,model-selection}.ts`；删除 `video-provider-switch.ts` 与 `admin/services/video-provider` 路由。模型按业务键分别路由，不再有 Kuaizi ↔ TGG 整体切换。
- 模型目录与展示：`src/lib/nori-model-catalog.ts`、`generation-config/route.ts`（「TGG · …」「Kuaizi · …」标签）、`model-pricing/version.ts`（`2026-11-17.1`）。
- 标准表：`standards/capabilities/tgg.catalog.json`、`standards/pricing/tgg.pricing.json`。
- 管理台：`PlatformAdminServicesClient.tsx`、`PlatformAdminServicesPanels.tsx`、`platform-admin-services.ts`；`scripts/guards/api-route-contract-guard.mjs`。

## TGG 修正（线上实测后）

- 上游拒绝 `generate_audio`（400 unsupported request field），适配器不再发送；音频总是生成，目录标记 `supportGenerateAudio: false`。
- 上游时长仅接受 5–30 秒（4 秒返回 invalid_duration），目录与定价改为 5–30，共 26 档。
- 定价：`seedance_v2.5_full` 每条 6.5 元；`vig-S2.5-480-秒` 5 秒 2.0 元，每秒 +0.4，30 秒 12.0 元。

## 发布记录

- 发布目录：`/opt/norivideo/releases/20261117-tgg-video`
- source fingerprint：`24ec1ed29d59a5aa254ee68ba8ae8f63e780d0a88ab485fa5a9998009c549981`
- 构建产物 sha256：`29710e205212358e3a92a9c245bb588afa34d3fb4e16ebbd2b492955f1805b8a`
- 候选镜像：`norivideo:release-20261117-tgg-video`（`sha256:73500335…`，amd64）
- 上一版本：`norivideo:release-20261117-perf-media`（`sha256:20fda0a8…`，source `b7cf2cc8…`）
- 备份：`/opt/norivideo/backups/20261117-tgg-video/`（受保护文件、`nori.sql.gz`、`nori-pre-switch.sql.gz`、`previous-image-id`）

## Schema

无变更。switch 要求候选镜像与线上数据库的 `prisma migrate diff` 为空，否则拒绝切换；未执行 `prisma db push`。

## 切换前置

- switch 开始前活动任务（`queued`/`processing`）数量为 0 才执行；发布前曾有 1–2 个 processing 任务，等待其完成后切换。
- 切换为分离进程执行，状态见 `switch.done` / `switch.log`。

## 验证

- load 阶段：候选镜像 `source-sha256` 标签正确；TGG 标准表 `durationOptions` 5–30、`supportGenerateAudio=false`、定价档位 5–30；`/app/.next/server` 中已无 `video-provider` 路由；perf-media 与 billing-fix 标记仍在。
- switch 后：app/admin healthy 且同为候选镜像；受保护文件与备份逐字节一致；`data/services.prod.json` 未改动，Kuaizi 与 OpenLux 路由完全保留；`/api/tasks` → 401，`/zh/auth/signin` → 200，管理台登录页 → 200；app 最近 6 分钟 error 日志 0 条；`BILLING_MODE=ENFORCE`、测试模式关闭。
- 构建：服务器 `--network none` 容器内 `npm run build`，178 静态页，exit 0。
- 构建目录 `/opt/norivideo/build` 已清理；`/data` 未触碰。

## 线上状态与注意

- 线上配置中没有 `nori::tgg-*` 路由，TGG 两个模型在画布/工具箱中**不可选**，直到管理员在管理台为对应业务键配置路由并填入 TGG 服务密钥。本次未写入任何 TGG 密钥到服务器、仓库或文档。
- **2026-11-17 17:35 修复**：`getPlatformServiceConfigResponse` 中 `readMaterializedPlatformServiceConfig()` 被 webpack 错误内联为工厂函数，导致 `materializeEnvironmentConfig` 未被调用，TGG 默认路由未生效。已改为直接调用 `materializeEnvironmentConfig(readServiceConfig())`，重新构建并切换（`20261117-tgg-fix`）。现在 TGG key 存在时自动填充默认路由，画布/工具箱中应显示「TGG · Seedance 2.5」「TGG · vig-S2.5-480」。
- 「生成声音」开关对 TGG 模型显示「当前模型不支持生成声音」，但上游实际总是生成音频，文案待修正。
- TGG 计费尚未与上游账单核对，属于待验证项。
- 同一上游在多个业务键下出现时，标签可能重名，需管理员区分。
- 本次为当日第二次生产发布（首次为 `20261117-perf-media`）。
- 建议轮换此前在对话中出现过的 TGG 密钥。

## 追加发布：cgtid 查看（20261117-cgtid-view，2026-11-17 21:35）

- 功能：视频节点右键新增「查看生成任务 ID」，展示内部 canvas generation task id（Task.id uuid，非素材 id、非上游 externalId），凭此可在 `/api/tasks/{id}` 或 tasks 表 payload 中核对发给火山的实际提示词与参数。无任务记录（如上传视频）时 toast 提示，不打开空对话框。
- 增量：仅 4 个文件（`CanvasGraph.tsx`、`canvas.css`、`CanvasMenus.tsx`、`CanvasDialogs.tsx`），以线上 `20261117-tgg-fix` 源码树为基线（基线指纹 `07ce26e7…` 与线上镜像标签逐位一致；工作区其余未审查改动未上线）。
- source fingerprint：`fd503222bde8fc23047f4014a9259ceede98fe5ff97297a408203335107631e9`；产物 sha256：`1abb8654…`；候选镜像 `norivideo:release-20261117-cgtid-view`（`sha256:e526087a…`，amd64）。
- Schema 无变更（migrate diff 为空守卫通过）；活动任务 0 时切换；备份 `/opt/norivideo/backups/20261117-cgtid-view/`。
- 验证：静态 chunk 含菜单文案与 toast；`services.prod.json` 逐字节不变；`/api/tasks`→401、登录页→200；6 分钟 error 日志 0 条；tgg/perf/billing 标记与标准表检查全部通过；构建目录已清理，`/data` 未触碰。
- 当日第三次生产发布。
