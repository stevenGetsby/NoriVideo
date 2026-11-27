# 发布与验证记录：客户白标/内部全量模型视图 + `canvas_snapshots` 存储优化（2026-11-27）

状态：**已发布到备案机 `14.103.65.61`，`norivideo-app-1` / `norivideo-admin-1` / `norivideo-mysql-1` / `norivideo-redis-1` 均 healthy**。代码未进本地 main，未 `git commit/push`。

## 1. 发布元数据

- 发布名：`20261127-model-view-snapshot-opt`
- 基线发布：`20261127-sd25-intl`（基线源码 sha256：`a46fb312932aaba22308f3fb3fe71edd9d465b8611ca896359b43f39c3987240`）
- 新源码 sha256：`9e8f6b3c77803d4f7e7d186d065ff71b25e5fd74f86fdf239e94aaeee8c0e5b7`（归档于 `/opt/norivideo/releases/20261127-model-view-snapshot-opt/build/source.tar.gz`）
- 镜像：`norivideo:release-20261127-model-view-snapshot-opt`（`sha256:9f478bd414873932158a438fc032c4db73d1d529b4ba885376295d2141ded1af`）
- 预检端口 / TAG：`13910` / `mvsnapopt`
- 公共锁定构建依赖：已重建并持久存放于 `/opt/norivideo/shared/node_modules.tar.gz`（sha256 `61061e7f270c1a633da187f7eeebd8ae7ea5bca43afe9c99e44194e60877866b`），避免后续历史发布目录清理影响 `build-in-container.sh`。
- 流程结果：`prepare.done=0`、`build.done=0`（`next build` + TypeScript 检查通过）、`verify=0`（独立容器 HTTP 200）、`switch.done=0`（等待 1 个在途生成任务 drain 后完成切换，无 schema 变更，`/opt/norivideo/.env` 保持不变），`build/app` 与 `build/artifacts` 已清理。
- 回滚镜像：`norivideo:release-20261127-sd25-intl`

## 2. 本次上线内容（相对 `20261127-sd25-intl` 共 26 个文件，保持原有行尾）

1. **客户白标模型视图 vs 内部全量模型视图（24 个文件）**：
   - 新增业务视频模型 `nori::norivideo2.5-intl`（路由至 `kuaizi::doubao-seedance-2-5-260628-intl`，客户白标名 `Seedance 2.5 国际版`），补齐能力、定价、计费与 Seedance 2.5 特性门控。
   - 在 `services.prod.json` 的 `llm` 下新增 `internalModelViewUserIds`、`customerVisibleModels`、`customerModelOverrides`（按 `actorId` 隔离，子账号绝不继承管理员的内部全量视图）。
   - `GET /api/frameos/generation-config`、`/api/user/models`、`/api/user/api-config`、`/api/projects/.../agent/models` 按视角分化输出：客户视角仅见纯净白标 `nori::*` 模型名、隐藏 `runtimeModelKey`、清空 `modelAliases`、对音频与健康/错误信息做供应商脱敏（含 `kzep_...` 与所有供应商名/域名），并通过服务端布尔字段 `usesReferenceAudio` 替代客户端解析 `runtimeModelKey`。
   - `POST /api/frameos/toolbox/generate`、`generate-video`、`character-audition` 强制 `resolveModelKeyForViewer` 鉴权（未授权直连供应商模型返回 403 `FORBIDDEN`，旧画布直连键若命中客户可见路由则平滑升级为 `nori::*`）。
   - 管理后台新增「03 客户白标模型与内部视图」面板（含客户可见业务模型开关、内部全量视角白名单、按客户/工作区定制覆盖）。
   - 架构设计文档：`/Users/headmasterx/Desktop/LanMiao/LanmiaoTV/docs/architecture/customer-model-view-design-20261127.md`。
2. **`canvas_snapshots` 写路径存储优化（2 个文件：`src/lib/canvas/persistence.ts`、`tests/unit/canvas/persistence.test.ts`）**：
   - 画布拥有基线快照后，纯视口平移/缩放（`canvas.update_meta` 无标题/主题色变更）不再读取全量节点或写入重复快照。
   - 新增 `compactCanvasSnapshotDocument`：仅对归档快照副本压缩（不修改实时 `canvas_nodes`），每节点保留最近 3 条 `history`、去掉冗余 `references`/重复 `prompt`/`sourceMetadata.prompt` 及超 8 KB 内联 `data:` 预览图，保持与 `parseCanvasDocumentSaveInput` 100% 恢复兼容。
   - 自动快照节流提高至 15 分钟（批量删 `>=5` 节点与手动/恢复快照仍即时触发），单画布上限调为 20 条自动快照 + 10 条受保护里程碑（`恢复到历史版本...` / `手动保存...`）。

## 3. 生产运行时配置生效（`14.103.65.61:/opt/norivideo/data/services.prod.json`）

- 变更前已备份至 `/opt/norivideo/backups/20261127-model-view-snapshot-opt/services.prod.json.before`（权限 `600`）。
- 原子写入（保留原有所有密钥、供应商配置、`modelEnabled` 与 TopenRouter 配置不变）：
  - `llm.modelRouting["nori::norivideo2.5-intl"] = "kuaizi::doubao-seedance-2-5-260628-intl"`
  - `llm.internalModelViewUserIds = ["9de17f61-92a4-4fc6-8bd2-d97551663e15", "5e389e8d-29a5-4298-8d70-935e034f8cb1", "919094eb-5fe3-43f5-ab8e-3f862b1d0763"]`（`caoshuang`、`王卓`、`admin@caoshuang`）
  - `llm.customerVisibleModels`：启用全部 16 个已配置路由的业务模型（5 个视频 + 6 个图片 + 4 个文本 + 1 个音频），未路由的 `nori::nori-music` / `nori::nori-sfx` 为 `false`。

## 4. 历史冗余视口快照分批清理（非阻塞）

- 仅删除 `changeSummary = '调整画布视图'` 且 `revision < MAX(revision)` 的历史冗余行（严格保留每个画布的最新快照及 100% 真实编辑/恢复/手动快照），按 `LIMIT 200` 分 10 批平滑删除，未执行阻塞式 `OPTIMIZE TABLE`：
  - 清理前：`4,093` 行 / `3,721.91 MB`（其中视口快照 `2,036` 行，覆盖 `132` 个画布）
  - 删除量：**`1,931` 行**（10 批，每批 <= 200 行）
  - 清理后：**`2,162` 行 / `1,786.43 MB`**（逻辑文档体积减少 **`1,935.48 MB` / `-52.0%`**，剩余 `105` 行最新基线视口快照，`132` 个画布全量保留）

## 5. 验证结果

- **独立单元测试（37/37 PASS）**：`run-snapshot-tests.mts`（4/4）+ `run-model-view-tests.mts`（8/8）+ `run-tests.mts`（18/18）+ `run-sd25-intl-tests.mts`（7/7）。
- **线上实时功能验证（`norivideo-app-1` 容器内调用编译后模块）**：
  - `caoshuang`（`9de17f61-...`）与 `王卓`（`5e389e8d-...`）：`isInternalModelViewer = true`，视频返回全部 24 个已配置供应商模型（含 Kuaizi 10 个含 `Kuaizi · Seedance 2.5 国际版`、绘梦工坊 10 个、AILink 2 个、TopenRouter 2 个），图片返回全部 11 个（OpenLux 6 个 + 绘梦工坊 5 个），`modelAliases` 为 11 项。
  - `caoshuang` 名下子账号（`0dadbbbf-20fe-4a5d-965f-5ac98a4c9f1d`）：`isInternalModelViewer = false`，仅返回 16 个客户白标 `nori::*` 模型（5 视频 / 6 图片 / 4 文本 / 1 音频），供应商名称泄露数 **`0`**，`modelAliases` 为 **`{}`**。
- **前端产物、HTTPS 与容器健康**：
  - 管理后台 chunk `/app/.next/static/chunks/app/[locale]/admin/services/page-071c3bb1fb1796e0.js` 已包含 `客户白标模型与内部视图`。
  - `https://lanmiaoai.com/zh/auth/signin` 返回 `HTTP 200`，4 个容器（`norivideo-app-1`、`norivideo-admin-1`、`norivideo-mysql-1`、`norivideo-redis-1`）均为 `healthy`，无启动或运行时异常。
