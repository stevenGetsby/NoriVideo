# 备案机发布：画布视频放大续播

完成时间：2026-10-29 13:00（Asia/Shanghai）。发布目录标签：`20261029-canvas-playback`。

## 发布内容

- 修复画布视频节点「小卡片播放 → 放大预览从头重播」的问题。新增 `src/features/canvas/media-playback.ts`，按视频地址记录播放位置/播放状态并登记同文件的播放器。
- `CanvasNodeVideo` 在播放、暂停、进度变化时记录位置，卡片重新挂载时恢复上次位置。
- `CanvasMediaPreviewDialog` 打开时接管播放（暂停卡片、跳到同一秒、按原状态续播），关闭时把位置同步回卡片并恢复原播放状态。
- 新增单测 `tests/unit/canvas/media-playback.test.ts`（5 项）。

## 构建与制品

| 源码指纹 | 制品 SHA-256 | 镜像 |
| --- | --- | --- |
| `e95c4c73a6227104c76122e4408a89dffdad016ade33e641d1db0852ac09748c` | `01f3f25f1afe488df5bbcf9080489bc92663cc68f502117e58ce4e0d0a48f5c5` | `norivideo:release-20261029-canvas-playback` / `sha256:cc307ed1958042018c8ceb9ab5c5ed2d3b92190143f570f3c07cc09c9599869b` |

- 相对上一版源码仅变化 3 个文件（哈希根目录内），另有 1 个新增测试文件参与打包但不计入指纹。
- `package.json` / `package-lock.json` 未变；沿用上一版镜像依赖与 Linux 原生包 `node_modules.tar.gz`，全程 `--network none` 构建。
- `prisma/schema.prisma` 未变，`schemaChanged=false`。

## 数据库

- `prisma migrate diff` 结果为空（`-- This is an empty migration.`），无结构变更，未执行 `prisma db push`。
- 切换前备份业务库：`/opt/norivideo/backups/20261029-canvas-playback/nori.sql.gz` 与 `nori-pre-switch.sql.gz`（各 7.2M）。

## 切换记录

- 发布前 `fixed-tos-config-guard` 通过（bucket `nori-test`）。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 切换时 queued/processing 任务为 0；仅重建 app/admin，MySQL/Redis 未重建。
- `BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261029-interactive-story` / `sha256:f7a31ed57eeafaac493cf31679b96c6e2e28945c683aa4819c7509599aa3005f`。

## 线上验证

- app/admin 均 healthy，使用同一镜像 `sha256:cc307ed1…`，源码标签 `e95c4c73…` 一致。
- 容器内 Prisma 查询 `interactive_stories` 成功（0 行），新制品与既有表兼容。
- 工作台 `https://lanmiaoai.com/zh/auth/signin`、管理台 `https://lanmiaoai.com:8080/zh/admin/signin` 均返回 200。
- 本地 `tsc --noEmit` 无错误；画布相关单测 36 项通过（含新增 5 项）。
- 未在真实浏览器内点验放大续播，建议上线后手动试一遍：卡片播放中途点「放大预览」应接续播放，关闭预览后卡片回到该位置。

## 清理

- 已删除 `/opt/norivideo/build`（源码与构建目录），保留发布目录、制品、业务库备份与上一版回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
