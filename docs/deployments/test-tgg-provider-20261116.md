# TGG 服务商 + 互动节点 + 影游协作 + 计费浮点修复 测试机部署记录（2026-11-16）

依据四份交付：

- `docs/design/2026-11-16-tgg-provider-and-canvas-fixes-plan.md`（TGG 视频服务商 + 画布修复，批次 B/C/A1–A4）
- `docs/design/2026-11-16-interaction-node-design-plan.md`（互动/抉择自有画面口，前置 + 批次一/二/三）
- `docs/design/2026-11-16-story-collaboration-members-plan.md`（影游协作成员，三批次）
- 计费冻结浮点比较 bug（`ledger.ts` 自动补足后余额校验，#216）

本次按用户口径「先实现互动节点文档，然后再一起部署测试机」合并部署。**仅部署测试机 `45.76.215.9`，未推送、未部署生产、未运行真实付费生成。** 生产放行需用户另行批准（每日至多一次，agent 不主动发布生产）。

## 实现范围与提交

合并部署的已提交工作（HEAD `4c6569a`）：

| 工作流 | 批次 | 提交 |
|---|---|---|
| TGG/画布 | B  hub 封面遮挡标题 | `c175312` |
| TGG/画布 | C  章节连线 CSS zoom 偏移 | `47a06f5` |
| TGG | A1  接入 TGG 视频服务商模块 | `4529754` |
| TGG | A2  记账钉住实际服务商 + 脱敏 | `f27fa2e` |
| TGG | A3  管理后端切换 + 按服务商对账 | `acf6a7f` |
| TGG | A4  管理页 TGG/切换卡片 + 对账表 | `896f663` |
| 互动 | 前置  抉择背景/换类型迁移/热区/随机权重 | `7ee108d` |
| 互动 | 批次一  互动/抉择自有画面口（连接层/几何/编译/端口） | `9e0e3ca` |
| 互动 | 批次二  画面卡片预览/难度预设/画面校验 | `d6722a2` |
| 互动 | 批次三  播放层黑屏根治 | `8627aa7` |
| 协作 | 批次一  影游画布协作成员入口 | `c5059bd` |
| 协作 | 批次二  故事卡协作人数 | `30ed4c2` |
| 协作 | 批次三  保存后确认协作者变动 | `0a4fb53` |
| 计费 | 自动补足余额校验按 DECIMAL 绑定 | `4c6569a` |

随包一并部署但**仍未单独提交**的既有改动：LanmiaoTV 动画首页（`LanmiaoHome.tsx` 等）、主题 token/日间模式、性能（轻量轮询 `useVisiblePolling`、poster-first 媒体 `video-poster`）、转绘漏台词修复、存储/媒体代理等。这些在上一轮首页测试机验收（`test-lanmiaotv-animated-home-20261116.md`）已验证，本次随源码包整体带上，未新增改动。

约束遵守：

- 互动 R1–R10：未改 DB schema/API 路由；新画面资产仍走既有 `POST /api/interactive/[workId]/assets`；旧作品字节兼容；画面不复制进互动 `data`，仅一条媒体连线；抉择 `backdrop` 与互动画面共用同一连接层改动；引擎未触碰；画布用 poster（`toVideoPosterUrl(url,480)`），同屏至多一个 live `<video>`，卡片预览不用 `<video>`。
- 协作 R1–R10：复用 `MemberManagerDialog`/member-candidates/member-change-set；未触碰权限模型；无 DB 变更；payload 仅新增可选 `canManageMembers?: boolean`；`undefined` 即只读（仅 `=== true` 可写）；成员按钮只按 `canManageMembers` 门控，不与 `readOnly`（账号 canvasWrite）做 AND；无邀请系统。
- TGG R1–R8：API key 绝不入仓库/文档/日志/提交/截图，仅经管理卡片或 env `TGG_API_KEY`；fetch 一律 mock，绝不真发请求；不自动重试 TGG `POST /v1/videos`，超时无 task id → `TGG_SUBMIT_UNCONFIRMED`；TS 不含具体 TGG 模型 id/能力数字（仅 JSON 目录）；暗色主题像素未改。

## 部署机制

- 源码包：`/tmp/source-20261116.tar.gz`（约 12 MB，1908 文件：src 1541 / scripts 101 / lib 74 / messages 66 / prisma 54 / public 23 / standards 21）。由 `git ls-files` + `--others --exclude-standard` 生成清单，过滤顶层杂物、Finder ` 2/3/4` 副本、`*.log`/`*.tsbuildinfo`/`.DS_Store`、`.env*`、`config/`、`data/`；`.next` 为符号链接已排除。`COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata` 打包。
- 隔离构建：`/opt/norivideo-test/app-20261116-candidate` 独立完整构建（`remote-build-20261116.sh`），`HUSKY=0 npm ci` → `NODE_OPTIONS=--max-old-space-size=3072 npm run build`（170/170 页）→ `npx prisma db push --skip-generate`（**already in sync，无 schema 变更**）。构建脚本复制现网 `.env`/`.env.local` 与现网 `app/config`、`app/data`（guard 校验过的已知良好配置），不携带本机 secret。
- 配置继承：现网 `.env` 设 `NORI_SERVICE_CONFIG=/opt/norivideo-test/services.prod.json`（共享根，10916 B）。`candidateConfigPaths()` 在该 env 存在时只读这一份；候选包复制现网 `.env` 后自动继承同一份服务商/密钥/路由配置，`config/services.json`（418 B）仅为未用兜底。`materializeEnvironmentConfig()` 始终重建 `config.llm.providers`（deepseek/openlux/kuaizi/huimengi/tgg）与固定模型目录，TGG 作为第 5 个服务商自动物化。
- 切换：`swap-20261116.sh` 前置校验（build-done 存在、无 build-failed、候选 `.next/BUILD_ID`/`dist/worker.js`/`dist/storage-init.js`/`.next/server/app` 齐全、无同名备份）→ 停 4 服务 → `mv app app-pre-20261116` → `mv app-20261116-candidate app` → 起 4 服务。
- 结果：`BUILD_ID=7RMNsCtdHu48IUDxCL3y4`；`norivideo-test-web/worker/watchdog/board` 均 active；web `✓ Ready`，`/zh` HTTP 200；`check:fixed-tos-config`（local 模式）与 storage-init 通过。回退点 `/opt/norivideo-test/app-pre-20261116`（与现网共用同一 DB，db push 无变更故回滚安全）。
- 部署标记复核：`ledger.ts` moneyToDecimal=2、`credit-ledger.ts` toAmountDecimal=2、`interactive/service.ts` canManageMembers=1 + memberCount=1、`platform-services/config.ts` listTggSelectableModels=2、`providers/tgg/` 9 文件齐全、`compile.ts` 画面引用=1、首页 `LanmiaoHome.tsx` 在位。

## TGG 服务商状态

- **`GET /v1/models` 未真发**：按 R4 一律 mock。当前代码仅登记 `gpt-image-2.5-flare`/`gpt-image-2.5-sunburst`（图片，OpenLux），TGG 视频能力/时长/价格目录（`standards/capabilities/tgg.*.json`、`standards/pricing/tgg.*.json`、`providers/tgg/catalog.ts`）保持空，**待用户提供可核实的供应商数据后填充，不猜名称或价格**。
- 可选性门控：`listTggSelectableModels` 要求 verified profile + durationOptions + hasVerifiedPricing 三者齐全；目录空 → TGG 不出现在用户视频模型下拉，仅管理卡片可见。`savePlatformServiceConfig`/`savePlatformModelRouting` 拒绝无可用 key 的 TGG 路由（「TGG 尚未配置 API Key，不能把视频路由到 TGG」）。
- 路由映射：`resolveNoriModelRoute` allowedProviders video=['kuaizi','huimengi','tgg']，与根配置一致；用户模型目录、服务端路由、计费解析共用同一映射，防止 UI 可选但运行时 `MODEL_NOT_REGISTERED`。
- 任务 TTL 由 3600 调整为 21600（秒），匹配长视频任务轮询窗口；超时未拿到 task id 一律 `TGG_SUBMIT_UNCONFIRMED`，不自动重试 POST。
- 管理卡片/切换/对账（A3/A4）已部署，但**线上管理 surface 验收受阻**：`/zh/admin/*` 仅 `super_admin` 可达（admin surface，端口 8080），测试库当前无任何 `super_admin` 账号（duhongbo/zhanghongbo/互动验收专用/测试管理员 均为 workspace `admin`）。未擅自创建 super_admin 或重置密码。TGG 管理界面以代码/服务层复核为准；如需线上点验，需用户提供一个 super_admin 账号并开 8080 隧道。

## C 批次锚点指标（CSS zoom 连线偏移）

修复前后同条件实测（章节连线端点相对 handle 的像素距离）：

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| endAnchorDist | 42.09 | 2.6728 |
| startAnchorDist | 79.79 | 1.1953 |
| onDot（端点落在 handle 圆点） | false | true |
| C.6 centerDist（缩放下中心偏移） | — | ≈0.00002 |

拖动/缩放/上下翻转下锚点不再突变；隐藏期间冻结锚点尺寸，恢复后不突然缩小。既有 `is-node-dragging` 自动隐藏/结束恢复保留。

## 测试与守卫

- 聚焦单测：**524/524 通过**（39 文件：interactive 38 + billing/auto-fund-decimal 1），4.52 s，exit 0（`/tmp/vitest-deploy-20261116.log`）。覆盖互动连接层/几何/编译/端口、卡片预览/难度预设/校验、播放层黑屏、协作成员、计费 DECIMAL 绑定。
- 计费修复单测 `tests/unit/billing/auto-fund-decimal.test.ts` 6/6：以 `new Prisma.Decimal(value.toFixed(6))` 绑定 DECIMAL(18,6) gte 校验，复现并锁定 4 个曾被浮点误判的报价（9.583602、9.14004、9.84312、9.544332）。
- 既有失败如实记录、未为迎合而改受保护代码：canvas contract 9 项旧失败；lint 25 错均在其他文件；`check:logs` 390 违规；全量 `tsc --noEmit` 错误仅在 Finder 重复副本。`next.config.ts` 设 `eslint.ignoreDuringBuilds`/`typescript.ignoreBuildErrors`，故不阻断 build。
- `prisma db push` already in sync（schema 未变）；`git diff --check` 通过。

## 测试机真实验收（无头 Chromium，经 SSH 隧道）

外部 8080 被防火墙拦截，改用 `ssh -f -N -L 13000:127.0.0.1:3000` 隧道 + 本机无头 Chrome（`localhost:13000`，workspace surface）。账号 `duhongbo`（workspace admin），无付费生成。

1. [x] 登录 `/zh/auth/signin`（duhongbo）→ `/zh/works`，无错误提示。
2. [x] 影游 hub `/zh/interactive`：故事卡显示协作人数徽标（memberCount）。
3. [x] 跨账号隔离：访问他人故事 `d11cc7cd`（互动四项验收·20261115）→「项目不存在」，符合隔离预期。
4. [x] 自有故事 `28b17b54`（测试）总览：「协作成员」按钮在位；三层导航齐全（剧情画布/作品画布/章节画布）；检查面板 7 个问题可定位，含新画面口校验文案「接一个视频或图片到它顶部的画面口」「选择…将借用上一段的最后一帧」。
5. [x] 章节画布：互动节点（快速点击/限时抉择）顶部画面口 + 「新建画面/接已有节点」；黑屏占位卡片预览；难度预设「简单/普通/困难」；播放收尾「继续/慢放/定格」；「失败重来」；连线正常；底部「整理剧情/玩法设置/试玩本章」。
6. [x] 全程 pageerror=0；失败请求仅为导航期 RSC prefetch abort 与指向 8080 的管理入口链接（未隧道，预期内）。

截图：`/tmp/deploy-shots/acc-01-after-login.png`、`acc-02-interactive-hub.png`、`acc-04-overview-own.png`、`acc-05-chapter-canvas.png`（本机临时目录，未入库）。

未在线上点验（如实记录）：TGG 管理卡片（无 super_admin，见上）；试玩黑屏→画面播放的端到端（该「测试」故事存在孤儿/起点缺失校验问题，且播放逻辑已由 playback/player-playback-plan 等单测覆盖）；日间模式舞台保持深色（CSS 静态/单测覆盖）。

## 各文档建议项落地

- 互动 §F.5 / §D.3 作者引导：retry 类（tap/swipe/timing）勾「失败重来」；choice/hotspot 不勾；hold 越界判失败可重来。难度预设一键应用、单次可撤销。
- 协作 §H 产品决策项（未擅自实现，留待用户拍板）：成员能否邀请成员；组长身份唯一入口在账号管理；跨账号实时同步需 WebSocket；成员变动暂无通知。

## 备注

- 互动前置提交 `7ee108d` 含抉择背景/换类型迁移/热区/随机权重，其依赖的部分 CSS/主题改动仍在未提交集合中，随包部署。
- 测试夹具更名 `createSceneMedia → createPictureNode`（画面口语义对齐），旧作品数据不受影响。
- 互动批次三发现设计稿 token `--nori-s-8b8b9a` 不存在，实际改用既有 `--ix-dim`，未新增游离 token。
- 计费 bug 仅影响「报价恰落浮点误判值」且「本人余额不足需管理账号补」的交集（近 30 天 112 报价中 4 个），无丢钱、账目不乱；修复后该交集不再被误拦。

## 未做的事 / 待用户输入

- 未推送、未部署生产、未运行真实付费 OpenLux/绘梦/TGG 生成。
- TGG 仍待：真实 API key（经管理卡片或 env）、可核实的价格/能力/时长表、最短真实生成任务的明确批准。在此之前 JSON 目录保持空，TGG 不可被用户选中。
- 线上 TGG 管理卡片点验需一个 super_admin 账号 + 8080 隧道（当前测试库无 super_admin）。
- 生产放行需用户另行批准。

## 发布与回退

- 回退点 `/opt/norivideo-test/app-pre-20261116`；db push 无 schema 变更，回滚共用同一 DB 安全。
- 服务器留存：`source-20261116.tar.gz`、`remote-build-20261116.sh`、`swap-20261116.sh`、`build-20261116.log`、`build-20261116-done`、`swap-20261116-done`。
- 验收后已关闭本机 SSH 隧道（localhost:13000）。