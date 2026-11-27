# Beian Production Deployment — `20261127-canvas-perf-admin-ui`

- **Date**: 2026-11-27
- **Target**: Beian server `14.103.65.61` (`lanmiaoai.com`)
- **Release**: `20261127-canvas-perf-admin-ui` (port `13920`, tag `perfadmin`)
- **Baseline**: `20261127-model-view-snapshot-opt` (source sha256 `9e8f6b3c77803d4f7e7d186d065ff71b25e5fd74f86fdf239e94aaeee8c0e5b7`)
- **Source Tarball SHA256**: `4ca8b71aa4926eaa6e4522f1afef017f5e8bc393228d1d0d76dacc3682c9b6e1`
- **Built Image**: `norivideo:release-20261127-canvas-perf-admin-ui` (`sha256:e2cc6006623c8f658cc56a9a9e3ae6707cbd60b7f52833577ece6aa5fe0754c5`)

## Scope (43 Modified/Added Files)

1. **Canvas Frontend Performance (`@canvas-ui`, 17 files)**:
   - Panning/zooming `is-panning` CSS isolation & GPU compositing optimizations.
   - Minimap update throttling via `minimapNodeVersion` (decoupled from selection/hover re-renders).
   - Thumbnail-first canvas image rendering (`?thumbnail=480` on `/m/[publicId]`).
   - Memoized node/connection selectors & reduced redundant React re-renders during drag/pan.
2. **Canvas Backend & Media Performance (`@provider-backend`, 14 files)**:
   - On-demand WebP thumbnail generation & TOS caching on `/m/[publicId]?thumbnail=<width>` with `Cache-Control` headers.
   - Canvas state/bootstrap payload & query optimizations, snapshot & media lookup improvements.
3. **Admin Studio UI Redesign (`@admin-ui`, 12 files)**:
   - Unified `admin-console.css` design system imported in `PlatformAdminShell.tsx` and `PlatformAdminSignInClient.tsx`.
   - Upgraded Platform Admin dashboard & Services panels (`客户白标视图`, `立即保存生效`, `nori-admin-statgrid`, responsive layout, clean token hierarchy).
4. **MySQL Runtime Optimization (Pre-Switch)**:
   - Online `SET PERSIST innodb_buffer_pool_size = 2147483648` (128 MiB -> 2 GiB, zero restart).

## Pre-Deploy Verification

- **Diff & Hygiene Audit**: Verified all 43 changed files against `20261127-model-view-snapshot-opt`; pure line endings, zero Node/server imports in `'use client'` files, `model-selection.ts` strictly browser-safe.
- **Standalone Unit Tests (`/tmp/vedittest/`)**: **44 / 44 PASS**
  - `run-be-perf-tests.mts`: 5/5 PASS
  - `run-fe-perf-tests.mts`: 2/2 PASS
  - `run-snapshot-tests.mts`: 4/4 PASS
  - `run-model-view-tests.mts`: 8/8 PASS
  - `run-tests.mts` (video-edit): 18/18 PASS
  - `run-sd25-intl-tests.mts`: 7/7 PASS

## Release Pipeline Results

- `mkrelease2.sh` + `ship2.sh 20261127-canvas-perf-admin-ui`:
  - `build=0` (`next build` + TypeScript check clean via `/opt/norivideo/shared/node_modules.tar.gz`)
  - `verify=0` (`candidate standalone web: HTTP 200, image verified`, `mini audio defaults OK`)
  - `switch=0` (gracefully drained 2 active generation tasks, switched cleanly, admission restored, original nginx config verified)
  - `billing=ENFORCE`, `test-mode=OFF`, protected `.env` & `/opt/norivideo/data/services.prod.json` preserved untouched.
- Post-switch cleanup: removed `build/app`, `build/artifacts`, `artifacts` inside `/opt/norivideo/releases/20261127-canvas-perf-admin-ui` (final release dir size: `88M`).

## Post-Deploy Live Verification

- **Container Health**: All 4 containers `healthy`:
  - `norivideo-app-1` (`norivideo:latest`) — Up & healthy
  - `norivideo-admin-1` (`norivideo:latest`) — Up & healthy
  - `norivideo-redis-1` (`redis:7-alpine`) — Up & healthy
  - `norivideo-mysql-1` (`mysql:8.0`) — Up & healthy
- **HTTP Endpoints**:
  - Public app: `https://lanmiaoai.com/zh/auth/signin` -> **HTTP 200**
  - Admin console: `https://127.0.0.1:8080/zh/admin/signin` -> **HTTP 200**
- **Live WebP Thumbnail Endpoint (`/m/[publicId]?thumbnail=480`)**:
  - Sample image `m_234d24bb9652ff62fc8fc9519d444b573718cd9d`:
    - 1st request: **HTTP 302** -> `https://nori-test.tos-cn-beijing.volces.com/images/thumbnails/23/4d24bb9652ff62fc8fc9519d444b573718cd9d240cab518cca31313a5a53a6/w480.webp`, `Cache-Control: public, max-age=368`
    - 2nd request: **HTTP 302** -> cached `w480.webp` immediately
- **Compiled Chunk Audit**:
  - `norivideo-app-1`: `minimapNodeVersion` (2), `is-panning` (3), `thumbnail` (9 client chunks + `/m/[publicId]/route.js`), `客户白标视图` (2), `立即保存生效` (2), `nori-admin-statgrid` (4 JS/server + 2 CSS)
  - `norivideo-admin-1`: `客户白标视图` (2), `立即保存生效` (2), `nori-admin-statgrid` (4 JS/server + 2 CSS)
- **Logs (since 10m)**: `0` error-level entries in `norivideo-app-1` and `norivideo-admin-1`; live video generation tasks already submitting and polling normally post-switch.
- **System Resources**:
  - Disk: `/` `25G / 99G (26%, 70G avail)`, `/data` `25G / 196G (13%, 170G avail)`
  - MySQL InnoDB Buffer Pool: `2048.0 MB` (`131,072` total pages, `1,024` free; cumulative hit ratio `97.09%`, warming actively).

---

# Beian Production Deployment — `20261127-customer-routing-clean` (Final Combined Release)

- **Date**: 2026-11-27
- **Target**: Beian server `14.103.65.61` (`lanmiaoai.com`)
- **Release**: `20261127-customer-routing-clean` (port `13930`, tag `custroute`)
- **Baseline**: `20261127-canvas-perf-admin-ui` (source sha256 `4ca8b71aa4926eaa6e4522f1afef017f5e8bc393228d1d0d76dacc3682c9b6e1`)
- **Source Tarball SHA256**: `5a260f3656f10317b7be31a49a8f3116636514a18f3619e38c0f1cc20c4a8192`
- **Built Image**: `norivideo:release-20261127-customer-routing-clean` (`sha256:a3a567d34afd3a86c81dfc3c68bd321560795258524e37397a2c8064820e15a7`)

## Scope (17 Modified Files vs `20261127-canvas-perf-admin-ui`)

1. **Commit `8fcec217` — Remove Redundant Reference Manager Wire Button (`@canvas-ui`, 2 files)**:
   - `CanvasGraph.tsx`, `CanvasGenerator.tsx`: removed unused `changeReferenceWire` / `onChangeReferenceWire` / `在画布连线` UI controls cleanly.
2. **Per-Customer Model Provider Routing Backend (`@provider-backend`, 11 files + architecture doc)**:
   - Added `customerModelRoutingOverrides: Record<string, Record<string, string>>` across `service-config.ts`, `platform-services/config.ts` (strict same-modality PUT validation + automatic pruning), `admin/services/route.ts` (`workspaceOwnerId` enriched `modelViewUsers`), `platform-services/model-selection.ts` (100% browser-safe), `platform-services/model-availability.ts` (authoritative redacted unavailability), `account/request-context.ts` (`getAccountActorContext`), `nori-model-catalog.ts` (ALS propagation with unpolluted `getNoriModelRouting()`), `api-config.ts` (supports globally disabled `modelEnabled: false` per-customer overrides + `seedance25IntlKzep` enforcement), `audio/provider.ts`, `generation-config/route.ts`, and `toolbox/generate/route.ts`.
3. **Per-Customer Visibility & Provider Routing Admin Workbench (`@admin-ui`, 4 files)**:
   - `platform-admin-services.ts`, `PlatformAdminServicesClient.tsx`, `PlatformAdminServicesPanels.tsx`, `admin-console.css`: promoted **「单客户独立配置 · 可见模型与底层供应商」** master-detail workbench inside Section 03 with customer rail, `主账号/子账号` + `内部全视图` badges, 3-state visibility segmented control, same-modality `专属底层供应商` selector with readiness warnings, and 1-click `恢复该客户全部默认`.

## Pre-Deploy Verification

- **Hygiene & Bundle Audit**: All 17 changed files verified 100% pure CRLF (`0` bare LF, `0` bare CR); `0` Node/server runtime imports in `'use client'` files and `model-selection.ts`; `0` remaining `changeReferenceWire` / `onChangeReferenceWire` / `在画布连线` references in `src/features/canvas`.
- **Standalone Unit Tests (`/tmp/vedittest/`)**: **51 / 51 PASS**
  - `run-customer-routing-tests.mts`: **7/7 PASS** (Customer A vs B routing + zero provider leak, workspace inheritance + actor precedence, authoritative unkeyed redaction, internal full-view isolation, HTTP & BullMQ worker ALS + `modelEnabled: false` execution + unpolluted `getNoriModelRouting()`, `savePlatformServiceConfig` modality/unknown/prune/omit/clear validation, `seedance25IntlKzep` enforcement)
  - `run-model-view-tests.mts`: 8/8 PASS
  - `run-be-perf-tests.mts`: 5/5 PASS
  - `run-fe-perf-tests.mts`: 2/2 PASS
  - `run-snapshot-tests.mts`: 4/4 PASS
  - `run-tests.mts` (video-edit): 18/18 PASS
  - `run-sd25-intl-tests.mts`: 7/7 PASS

## Release Pipeline Results

- `mkrelease2.sh` + `ship2.sh 20261127-customer-routing-clean`:
  - `prepare=0`, `build=0` (`next build` + TypeScript + worker bundles clean), `verify=0` (`candidate standalone web: HTTP 200, image verified`, `mini audio defaults OK`), `switch=0` (gracefully drained 1 active task, admission restored, original nginx config verified).
  - `billing=ENFORCE`, `test-mode=OFF`, `.env` & `/opt/norivideo/data/services.prod.json` preserved untouched.
  - Post-switch cleanup: removed `build/app`, `build/artifacts`, `artifacts` inside `/opt/norivideo/releases/20261127-customer-routing-clean` (final dir size: `88M`) and removed stale `/tmp/20261127-ref-manager-clean-source.tar.gz`.

## Post-Deploy Whole-System Live Verification

- **Container Health**: All 4 containers `healthy` (`norivideo-app-1`, `norivideo-admin-1`, `norivideo-redis-1`, `norivideo-mysql-1`).
- **Live Compiled Runtime In-Memory Simulation (against production `/app/data/services.prod.json`)**:
  - Compiled chunks verified: `customerModelRoutingOverrides` in server chunks `20483.js` & `52950.js`, `admin/services/route.js` (1), and `/app/dist/worker.js` (5).
  - Customer A (`sim-cust-a` -> `huimengi::seedance-2.5`): `modelKey: "nori::norivideo2.5"`, `name: "Seedance 2.5"`, `runtimeModelKey: "huimengi::seedance-2.5"` (zero provider leak).
  - Sub-account A2 (`sim-sub-a2`, `workspaceOwnerId: "sim-cust-a"`): inherited `runtimeModelKey: "huimengi::seedance-2.5"`, clean `name: "Seedance 2.5"`.
  - Customer B (`sim-cust-b`, default): `modelKey: "nori::norivideo2.5"`, `name: "Seedance 2.5"`, `runtimeModelKey: "kuaizi::doubao-seedance-2-5-260628"`.
  - Internal full-view (`caoshuang` `9de17f61-...` & `王卓` `5e389e8d-...`): `isInternalModelViewer=true`, direct provider models `["kuaizi::doubao-seedance-2-5-260628", "kuaizi::doubao-seedance-2-5-260628-intl", "huimengi::seedance-2.5"]`.
- **Compiled Client Chunks**:
  - Admin (`norivideo-app-1` & `norivideo-admin-1`): `单客户独立配置` (1), `专属底层供应商` (1), `恢复该客户全部默认` (1), `nori-admin-workbench` (2).
  - Canvas (`norivideo-app-1`): `minimapNodeVersion` (1), `is-panning` (2), `在画布连线` (**0**), `changeReferenceWire` (**0**).
- **Live HTTP & Media**:
  - Public app: `https://lanmiaoai.com/zh/auth/signin` -> **HTTP 200**
  - Admin console: `https://127.0.0.1:8080/zh/admin/signin` -> **HTTP 200**
  - WebP thumbnail: `/m/m_234d24bb9652ff62fc8fc9519d444b573718cd9d?thumbnail=480` -> **HTTP 302** -> `.../images/thumbnails/23/.../w480.webp` (`Cache-Control: public, max-age=20792`).
- **Logs & Resources**:
  - Error logs (since 5m): `0` in `norivideo-app-1`, `0` in `norivideo-admin-1`.
  - Disk: `/` `26G / 99G (27%, 69G avail)`, `/data` `25G / 196G (13%, 170G avail)`.
  - MySQL InnoDB Buffer Pool: `2048.0 MB` (`131,072` total pages, `1,024` free; cumulative hit ratio `97.09%`).


---

## 补充上线：`20261127-admin-split`（核心平台 5 页拆分 + 主账号客户选择器）

- **发布版本**：`20261127-admin-split`（基线 `20261127-customer-routing-clean`，端口 `13940`，TAG `adminsplit`）
- **源码 sha256**：`d59c2f918a0676a56b3b3205d82ee90a2e3b28f7b46f71e4b69a1e401c41aedf`
- **镜像 ID**：`sha256:f76435bbfc117e524923f04d52d37c9832da3deb7b61dea7f4c23050e75896b3`
- **变更摘要**：
  - 核心平台侧边栏及路由拆分为 5 个独立专注页面：`/admin/services`（服务商与密钥）、`/admin/models`（模型与全局路由 + 喵导配置）、`/admin/customer-models`（客户模型策略与单客户独立配置）、`/admin/accounts`（账号与积分）、`/admin/usage`（存储与用量）。
  - `GET /api/admin/services` 新增 `modelViewUsers[].subAccountCount`（基于 `prisma.user.groupBy` 聚合各主账号子账号数），确保返回所有工作区主账号 + 管理员 + 历史配置引用账号（无邮箱/密钥）。
  - 「单客户独立配置」客户选择器严格仅展示客户主账号（`workspaceOwnerId == null`、排除超管与内部完整视图账号），展示「含 N 个子账号」标签；手动输入子账号 ID 自动归一到主账号；历史遗留子账号规则仍支持查看与一键移除。
- **上线与实时验证**：
  - 单元测试：`51 / 51 PASS`。
  - 发布流水线：`prepare=0`、`build=0`、`verify=0`、`switch=0`，`build/app` / `build/artifacts` / `artifacts` 已清理（发布目录 `88M`）。
  - 线上路由：`https://127.0.0.1:8080/zh/admin/signin` -> `200`；`/zh/admin/{services,models,customer-models,accounts,usage}` 全部返回 `307 -> /zh/admin/signin`（无 404/500）；`https://lanmiaoai.com/zh/auth/signin` -> `200`。
  - 运行状态：4 个容器全部 `healthy`，`norivideo-app-1` 与 `norivideo-admin-1` 零错误日志。
