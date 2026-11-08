# 2026-11-07 视频首次生成对照节点修复

## 变更范围

- 空视频节点第一次生成直接更新原节点，不创建对照节点，也不复制输入连线。
- 已存在成功视频时再次生成仍创建对照节点，继承输入并保留旧视频。
- 本地或服务器处于运行中的节点不创建对照；失败、无视频的节点也不创建对照。
- 相比 `20261107-huimengi-seedance` 线上源清单，只有 `src/features/canvas/CanvasGraph.tsx` 与 `src/features/canvas/video-comparison.ts` 变化。
- schema 无变更，服务路由、API 密钥、模型、计费与 TOS 配置均未改动。

## 验证

- `npx vitest run tests/unit/canvas/video-comparison.test.ts`：3 项通过。
- 相关 `clone-node-data`、`mention-references` 单测：8 项通过。
- `npx tsc --noEmit`：通过。
- 真实 CanvasGraph headless Chromium 回归通过：首次生成请求复用原节点，21 个节点与 1 条输入连线不增加，不持久化对照草稿；已有视频对照保留原视频和输入；失败清理后可重试；其他画布交互与边界场景通过。
- 浏览器测试使用本地 mock，未创建真实生成任务，未产生模型费用。

## 发布

- 基础镜像：`norivideo:release-20261107-huimengi-seedance`。
- 候选镜像：`norivideo:release-20261107-canvas-first-generation`。
- 源指纹：`af0a5c21b5ee6f661075fe93e5ca5812e3a2d4512b75ed6778a344d90462d83e`。
- 制品 SHA256：`5eaed6131d13a6f1b9863b2aa36968d0d301a667a121ff0fb51589a374f60034`。
- 镜像 ID：`sha256:b6749a61bdde57ef38610fa4a55a003329b50b17b40fab42bf8b4a75c08ffe75`。
- 服务器使用 `--network none` 构建；切换前备份业务数据库及受保护配置，校验 schema diff 与 queued/processing 任务数。
- 仅重建 app/admin，自动健康检查与失败回滚沿用部署脚本。
- 切换时 queued/processing 任务为 0，schema diff 无变更。
- 线上 app/admin 均为同一候选镜像且 healthy，billing=ENFORCE、test-mode=OFF，TOS 守卫与探针通过，登录页均为 HTTP 200。
- 受保护配置文件与备份逐字节一致，未覆盖业务数据库。
- 临时 `/opt/norivideo/build` 已清理；发布制品和备份保留。

## 回滚

- 重新将 `norivideo:release-20261107-huimengi-seedance` 标记为 `norivideo:latest`，仅重建 app/admin。
- 无数据库变更，无需数据回退。
