# 备案机发布：画布节点拖动修复与 Dreamo 风格画布视觉

完成时间：2026-10-26 15:31（Asia/Shanghai）。

## 发布内容

- 修复画布视频/图片节点无法拖动：锚定生成器在空间不足时不再被压到节点上抢占指针事件，改为缩小滚动或回落到底部停靠；选中节点后的自动聚焦改为在节点下方预留生成器空间。
- 媒体节点增加 14px 可拖拽边框带，视频中心区域仍保持可播放；标题栏仍可拖动。
- 故事板/分镜/视频生产节点按 Dreamo 深色卡片风格重写（#1f1f1f 卡面、0.5px 边框、16px 圆角、蓝色选中光晕、状态角标）。
- 生成器面板与视图控制条对齐 Dreamo：玻璃质感、胶囊控件、聚焦光圈、连接点悬停显示。
- 窄视口下生成器最大宽度让出左侧工具栏，避免遮挡。

## 构建与制品

- 源码指纹：`4efdc59d7fc90732b9725d9993cd2266a4c760945b4483ad0650fcf242a788df`。
- 相对上一版仅 5 个画布前端源码文件变化：`CanvasGraph.tsx`、`canvas.css`、`generator-anchor.ts`、`nodes/CreativeNode.tsx`、`nodes/ProductionNode.tsx`；`package.json`、`package-lock.json`、`prisma/schema.prisma`、`Dockerfile` 未变，无数据库 schema 变更。
- 以上一版镜像 `norivideo:release-20261025-character-voice-trace` 为基底，在备案机隔离容器 `norivideo-build-canvas-dreamo` 内构建（`--network none`，Node 22，amd64）；`next build` 与 worker 构建均退出码 0。
- 构建产物归档 `application-artifacts.tar.gz`（仅 `.next`、`dist`、`public`、`messages`，无 `.next/cache`），SHA-256 `763cd0957f1fd692e21b9658a8dbefde7443e99f51086f94fb8aceab6d02ff06`。
- 发布镜像：`norivideo:release-20261026-canvas-dreamo` / `sha256:cf0c31bcd3ebc5e329ee4ad84ee7a0d5f5eed8e6efe3ab54d5bff6ace1b70655`，源码标签与指纹一致。
- 静态产物包含 `nori-canvas-node-drag-frame`、`nori-canvas-generator-head-actions`、`拖动节点`。

## 切换记录

- 发布前固定 TOS 守卫通过（bucket `nori-test`，凭证指纹锁定）。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 业务库备份：`/opt/norivideo/backups/20261026-canvas-dreamo/nori.sql.gz`；切换前再次备份 `nori-pre-switch.sql.gz`。
- Prisma schema diff 无 DDL；切换时 queued/processing 任务为 0。
- 候选镜像先以 `SERVICE_MODE=web` 在 `127.0.0.1:13000` 隔离启动，登录页、管理登录页、工具箱均返回 200，固定 TOS 守卫与上传/读取/签名读取/删除探测通过后停止。
- 仅重建 app/admin；MySQL/Redis 未重建。`BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261025-character-voice-trace` / `sha256:457f8f26c7afd2f45877f9be1992be05ed72f182c6671b06938f81fd6cf1e693`。

## 线上验证

- app/admin 均 healthy，使用同一 amd64 镜像，源码标签一致。
- `https://lanmiaoai.com/zh/auth/signin` 返回 200；`https://lanmiaoai.com:8080/zh/admin/signin` 返回 200。
- 受保护文件与备份逐字节一致。
- 未提交真实登录后的付费生成与画布拖拽点击验收；拖动与视觉需在真实账号下确认。

## 清理

- 已删除构建容器 `norivideo-build-canvas-dreamo`、`build-input/` 与仅 root 可读的 `runtime.env`。
- 保留发布目录、应用制品、业务库备份与上一版回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
