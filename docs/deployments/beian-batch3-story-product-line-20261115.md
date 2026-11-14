# 2026-11-14 / 11-15 批次 3：productLine / creationMode、影游画布分离、封面入口

## 变更范围

- 功能提交：`a185484` 包含批次 3 的全部源码（productLine/creationMode 字段、影游画布独立路由、剧情节点隔离、按创建方式路由入口）。
- Prisma schema：`Work.productLine`、`Project.creationMode` 两列新增（已 db push 到测试机）。
- 回填脚本：`scripts/migrations/20261114-backfill-product-line-creation-mode.sql`，本次部署前已在测试机 dry-run 通过。
- 主要源码：
  - 新字段与回填：`prisma/schema.prisma`、`prisma/migrations/20261114213438_.../migration.sql`、`scripts/migrations/20261114-backfill-product-line-creation-mode.sql`。
  - 影游章节路由：`src/app/[locale]/interactive/[workId]/chapters/[projectId]/[[...canvas]]/page.tsx`、`src/components/frameos/StoryChapterCanvasClient.tsx`、`src/lib/interactive/routes.ts`。
  - 旧路由 307 跳转：`src/app/[locale]/canvas/[[...segments]]/page.tsx`、`src/app/[locale]/workflow/[projectId]/workbench-premium2/[[...segments]]/page.tsx`。
  - productLine 列表过滤：`src/app/api/works/route.ts`、`src/lib/works/service.ts`、`src/lib/works/product-line.ts`。
  - 影游画布能力隔离：`src/features/canvas/CanvasGraph.tsx`、`src/features/canvas/CanvasWorkspace.tsx`、`src/features/canvas/story/StoryCanvasContext.tsx`、`src/features/canvas/components/CanvasToolRail.tsx`、`src/features/canvas/components/CanvasChrome.tsx`、`src/features/canvas/components/EmptyCanvasChrome.tsx`、`src/features/canvas/clipboard.ts`、`src/features/canvas/batch-node-connection.ts`。
  - 封面入口按创建方式：`src/components/frameos/works/FosWorkPanels.tsx`、`src/components/frameos/works/types.ts`、`src/components/frameos/works/fetch-all-works.ts`。
  - 影游禁止直接建作品：`src/app/api/projects/route.ts`、`src/lib/interactive/validate.ts`。
  - 协作任务"影游"标签：`src/components/frameos/FosAssignmentsClient.tsx`。
  - 回收站"影游"标签：`src/app/api/projects/recycle-bin/route.ts`。

## 本地验证

- 单测：`works-service / works-route-product-line / works-creation-mode-entry / interactive/service / interactive/routes / interactive/fresh-story-neutral / projects/create-project-story-guard / projects/create-project-canvas / projects/create-project-inherit-assets / frameos/canvas-hierarchy-and-management / frameos/assignments-replica-contract / canvas/story-node-canvas-guards`，共 12 个文件 94 个用例通过。
- 真实组件无头浏览器（`/tmp/nori-work` 镜像）：
  - `tests/browser/interactive-layers.browser.mjs`：三层导航、迁移、排序、预览、可恢复移除、孤儿确认、章节穿透全部通过。
  - 已调整：旧的"无装饰渐变"断言与本批的 WorkCover 风格影游封面冲突，改为只断言 `nori-ix-ov-cover` / `nori-ix-chapter-cover` 保留 generative cover 类。
- `tsc --noEmit`：仅 4 个 Finder 重复文件（`MaterialPickerDialog 2.tsx`、`FosAssetLibrary 2.tsx`、`mention-references.test 2.ts`、`toolbox-regeneration.test 2.ts`）残留错误，本批零新增。
- `prisma validate` 通过；`git diff --check` 干净。
- 未执行付费生成（验收脚本拦截了 `/api/frameos/toolbox/generate`、`/api/canvas/`、`/api/video-generation`、`/api/image-generation` 的 POST generate）。

## 测试机

- 部署目标：`45.76.215.9` (`http://nori.45-76-215-9.sslip.io`)。
- 账号：测试管理员 / 测试组长 / 测试成员 已在测试机 MariaDB 重置密码（bcrypt，60 位），本地保存到 `/tmp/nori-deploy/accounts.json`（仅本机，权限 600）。
- 批次 3 端到端验收：`test-results/ux-audit/batch-3/acceptance.mjs`，8 步全部 PASS：
  1. product line API separation and invalid filter
  2. real chapter ids and both legacy redirects
  3. direct project creation in story is rejected without side effects
  4. canvas cover and quick entry follow creation mode
  5. normal canvas has no story capability or probe
  6. chapter navigation, order, story layers and shared tools
  7. neutral empty story and generative overview cover
  8. full story trial opens without paid generation
- 完整产品流程回归：`test-results/ux-audit/flow.mjs`，18 步全部通过（projects → 新建项目 → 新建作品 → 普通画布添加/右键/☰ → 影游总览 → 新建影游 → 章节画布 → 影游添加面板 → 右键 → 面包屑回退 → 项目列表 → 无限画布入口 → 工作监督）。
- 截图：`test-results/ux-audit/batch-3/01-creation-mode-covers.png`、`02-normal-canvas-isolation.png`、`03-chapter-navigation-tools.png`、`04-story-overview.png`、`05-fresh-story-next-steps.png`、`06-story-trial.png`；`test-results/ux-audit/flow/` 18 张。
- 生成接口被拦截，未触发付费。

## 已知限制

- 4 个 Finder 重复文件（`* 2.tsx` / `* 2.ts`）仍有 TypeScript 报错；按 §0 规则本批不动它们。
- 影游章节路由下添加面板的普通节点数 = 9（含音频占位）；已修正验收脚本断言从 8 → 9，符合 §4 B6。

## 生产

尚未部署；等待用户明确放行。
