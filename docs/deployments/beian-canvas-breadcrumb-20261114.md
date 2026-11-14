# 2026-11-14 批次 1c：画布父项目面包屑

## 变更范围

- 功能提交：`dc528b4 fix: preserve parent project in breadcrumb fallback`。
- 作品详情回退读取包含父项目；空父项目不会覆盖已解析的导航快照。

## 本地验证

- `project-breadcrumb-fallback.test.ts` 6 项通过。
- 真实组件项目层级浏览器回归通过 7 个场景，覆盖直接画布与空画布父项目导航。
- 本批无 schema 变更；未执行付费生成。

## 测试机

- 部署：2026-11-14，验收复核至 22:34（UTC+8），`45.76.215.9`。
- 与批次 1b 使用同一干净部署快照：`git archive dc528b4`，共 2739 个 tracked paths。
- 源码包 SHA-256：`dc6cf5d2d53997cdd32fd19059e3d6e3de847b228bb9900298a878838bc0eb35`。
- `build-done` 存在；`web`、`worker`、`watchdog`、`board` 均为 active。
- 通过：`/zh/canvas/{projectId}/{canvasId}` 直接入口面包屑显示 `UX审计项目0635`。
- 通过：`/zh/workflow/{projectId}/workbench-premium2/canvas` 入口显示同一父项目。
- 验收脚本与结果：`test-results/ux-audit/batch-1b-1c/acceptance.mjs`、`results.json`。
- 截图：`test-results/ux-audit/batch-1b-1c/breadcrumb-direct.png`、`breadcrumb-workflow.png`。

## 生产

尚未部署；等待用户明确放行。
