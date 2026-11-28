# 备案机整树发布 main@cdad110（2026-11-24）

- 范围：origin/main `cdad110`（本地 main 已推送，`a004d54..cdad110`）。包含画布生成面板热修移植（`a004d54`）、算力账本（`6c80265`、`1da4818`）、喵导画布助手（`478849c`）、首页改版与主题令牌（`8f718dd`）、大画布渲染与缩放（`9843889`）、素材选择器虚拟列表（`dde1c36`）、互动播放器（`3f6e406`）、TGG 视频上游与存储签名（`4692ef5`）。
- 基线：线上 `norivideo:release-20261123-canvas-9390405`（`sha256:3cc01ffac315…`，源码指纹 `9292c0f0…`）。
- 候选：`norivideo:release-20261124-main-cdad110`（`sha256:71bcf4aa0e88…`，amd64）。源码指纹 `ae83ccaa…`（3,213 个受控文件，取自 `git ls-files`，工作区对已跟踪文件无未提交改动），源码包 sha256 `39e23ae0…`，产物包 sha256 `35060ce7…`。
- 构建：离线 `--network none` 容器内 `FROM` 基线镜像，复用基线 `node_modules` 与 linux tailwind/lightningcss 覆盖层；`npm run build`（prisma generate + next build + build-workers）。唯一新增的依赖变化为 devDependency `happy-dom`，运行时不需要。
- 产物：`.next dist public messages standards lib prisma prisma-client docker-start.sh fixed-tos-config-guard.mjs next.config.ts middleware.ts`。`lib/prompts` 与 `standards` 必须随镜像更新（画布助手提示词、DeepSeek 喵导定价等为新增文件）。
- 数据库：纯增量。守护脚本校验仅允许 `CREATE TABLE canvas_agent_threads` 与其 `canvasId` 外键（`ON DELETE CASCADE`），其余语句一律拒绝。切换前 `prisma db push --skip-generate` 写入，push 后 `migrate diff` 为空。无既有表 ALTER/DROP。算力账本四表此前已在线上。
- 切换：2026-11-24 00:58–01:00（北京时间，服务器时钟），切换前活动生成任务为 0。`norivideo-app-1` 与 `norivideo-admin-1` 均运行候选镜像，状态 healthy、重启 0 次。
- 验证：受保护配置（`.env` `.env.local` `.deploy.env` `docker-compose.prod.yml` `data/services.prod.json`）切换前后逐字节一致；TOS 固定桶 guard 与上传/读取/签名读/删除 probe 通过；`BILLING_MODE=ENFORCE`、test-mode=OFF；计费修复与算力账本标记在线上存在；`canvas_agent_threads` 已建（0 行），账本四表存在；`/api/tasks` 与画布助手 `/api/projects/.../agent/threads` 未登录返回 401；主站与管理端登录页 200；提示词与定价资产存在；worker/watchdog 运行正常。
- 切换后日志：仅有 Next.js `themeColor` metadata 弃用告警（`/[locale]/auth/signin`、`/[locale]/admin/signin`），属非阻断告警，待后续在 viewport 导出中修正。
- 已知无关项（随整树发布，非本次切换引入，已如实记录）：
  - 灰度/渐变守卫：`lanmiao-home.css` 命中 20 处（另有既有 7 处）。
  - 浏览器测试 `canvas-text-edit-flow`、`canvas-video-prompt` 在 HEAD 上失败；`theme-contrast` 因缺少 `test-results/gallery/shoot.mjs` 无法运行。
  - 快子（kuaizi）单测仅在全量负载下超时，单独运行 15/15 通过。
  - 构建告警：`bullmq` 依赖的动态 require 提示（Critical dependency），非本次改动引入。
- 回滚：上一镜像 `norivideo:release-20261123-canvas-9390405`（`sha256:3cc01ffac315…`）。仅切换应用镜像，不回写业务数据库；新增 `canvas_agent_threads` 为纯增量，旧代码忽略该表，可保留。
  - 命令：`docker tag norivideo:release-20261123-canvas-9390405 norivideo:latest && cd /opt/norivideo && docker compose --env-file .deploy.env -f docker-compose.prod.yml up -d --no-deps --no-build --pull never --force-recreate app admin`
- 备份：`/opt/norivideo/backups/20261124-main-cdad110/`（`nori.sql.gz` 切换前准备阶段、`nori-pre-schema.sql.gz` push 前、`nori-pre-switch.sql.gz` 切换前，均 gzip 校验通过；受保护配置副本；`previous-image-id`）。
- 发布目录：`/opt/norivideo/releases/20261124-main-cdad110/`（`deploy.sh`、`build-in-container.sh`、`Artifact.Dockerfile`、`application-artifacts.tar.gz`、`schema-diff.sql`、`db-push.log`、`package.log`）。
