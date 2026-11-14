# 2026-11-11 工作监督 / 画布剪贴板 / 资产库隔离发布

## 版本

- 线上镜像：`norivideo:release-20261111-staff-activity-canvas`（`norivideo:latest`，id `b1f9b36c…`）
- 源指纹：`19083309768600fd7a194bb7e904248904432de8b59e4940b1d600abff67521d`
- 产物 sha256：`07dec20bb7d4dc71ef9079870f0c1c4972be2c1251bfb6bf5440094e54fc7e3a`
- 上一版本：`release-20261109-video-repaint-streaming`（源指纹 `bf3baf41…`，镜像 `c11971b3…`）
- 纯代码发布，Prisma schema 未变（`schemaChanged: false`）
- 未提交：发布的是工作区当前状态，相对上一版本 37 个文件变化（新增 10、修改 27）

## 变更范围

- 工作监督（仅管理员）：`/account-management/activity` 页面，`/api/admin/activity` 与 `/api/admin/activity/[userId]`，统计在线时长、资产与视频生成数。
- 画布剪贴板：系统剪贴板只放节点正文纯文本；画布 JSON 使用自定义格式 `web application/x-nori-canvas+json`，粘贴时优先识别。
- 工具箱：历史查询支持 `taskIds` 参数与总数统计。
- 其余画布节点、生成器、自动保存等改动，明细见 `git status`。

## 修复

- `POST /api/projects/[projectId]/canvas/[canvasId]/materials` 按 id 复用已有素材时恢复 `projectId` 过滤。上一版本线上代码缺少该过滤，同一用户可跨业务项目引用素材；与 HEAD 版本及 `canvas-asset-library-route.test.ts` 一致。

## 验证

- 部署守卫：备份（`nori.sql.gz` 与 `nori-pre-switch.sql.gz` 各约 88 MB，受保护文件副本）；产物校验；amd64；schema diff 为空；无在跑任务；TOS 探针上传读取删除通过；`billing=ENFORCE test-mode=OFF`。
- 线上：app / admin healthy；`/api/admin/activity` 未登录 401；`/zh/account-management/activity` 307（未登录跳转）；`/zh/auth/signin` 与 `/zh/admin/signin` 200；发布后 6 分钟内 ERROR 日志为 0。
- 本地：tsc 对正式源码无错误（12 条报错均在 Finder 重复副本 ` 2.tsx` 中，发布排除）。相关单测与集成测试 9 个文件 69 项通过。
- 未跑：`tests/integration/projects/project-asset-boundaries.test.ts`，需要一次性 MySQL（`NORI_ASSETS_DB_TEST=1`）。
- 既有失败：`tests/unit/frameos` 与 `tests/unit/canvas` 中 10 个用例在 HEAD 也失败，属于文案与样式断言未跟上 11/09 品牌与导航改版，非本次引入，未修。

## 回滚

```
docker tag sha256:c11971b3b428915f465f14184b334afb5bb2c8b95502ff5bd0c1a8bb85f094df norivideo:latest
cd /opt/norivideo && docker compose --env-file .deploy.env -f docker-compose.prod.yml up -d --no-deps --no-build --pull never --force-recreate app admin
```

## 备注

- 发布后根盘约 15 GB 可用；binlog 增长问题未处理。
- 守卫校验的 TOS bucket 为 `nori-test`，与锁定指纹一致，属既有配置，本次未改。
