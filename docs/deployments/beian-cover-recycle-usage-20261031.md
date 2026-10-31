# 备案机发布：项目封面、回收站与用量归集

完成时间：2026-10-31 14:28（Asia/Shanghai）。发布目录标签：`20261031-cover-recycle-usage`。

## 发布内容

- 项目支持自定义封面：可上传、更换、预览、移除；未设置封面时继续使用渐变彩字，项目列表与无限画布共用同一份封面数据。
- 作品与项目支持回收站恢复；仅永久删除后才清理封面存储对象。
- 修复按住空格拖动画布时出现框选的问题；空格只平移，普通左键框选保持可用。
- 修复首页因 session 轮询重复加载导致的不定时闪黑、闪灰。
- 用量报表按账单中的实际执行账号归集，支持查看单账号、单项目的积分与调用消耗。
- 前端可见品牌统一为 `LanMiaoTV`，内部 `norivideo` 标识、模型 key、存储 schema 不变。
- Seedance Mini 时长统一为整数 4–15 秒，UI、运行时校验、请求映射与报价使用同一能力来源。
- `middleware` 放行 `.webm/.mp4/.mov` 静态视频请求。

## 构建与制品

| 源码指纹 | 制品 SHA-256 | 镜像 |
| --- | --- | --- |
| `f775534c8ea24e53c326516a13bdbbf38131ec550b5c4324226ec5110622a0b3` | `4b70fbe2d5ccde5bcb334304ee40b48e4e62e81de450ae132fc993e8d128ffa7` | `norivideo:release-20261031-cover-recycle-usage` / `sha256:ebdfd739f9c32e3078b268d555f85b4d13bbdc596ac4490072f7b1b308a9ace6` |

- 提交 `16c7ad3`（99 个文件，+2381 / −300）。指纹覆盖 1686 个文件，其中 44 个与线上 `20261030-creative-login` 源码不同；`package.json` / `package-lock.json` 未变，依赖树沿用上一版镜像。
- 应用在服务器容器内以 `--network none`、基于 `norivideo:release-20261030-creative-login` 构建（Next.js 静态页生成与 worker 打包完成），制品 22M。
- 候选镜像校验：源码标签一致、`amd64`、`prisma/schema.prisma` 与 `node_modules/.prisma/client` 均含 `coverImageKey`。

## 数据库

- `prisma migrate diff` 仅有一条增量：`ALTER TABLE projects ADD COLUMN coverImageKey VARCHAR(512) NULL;`，无删除、重命名或改列。
- 切换前备份业务库：`/opt/norivideo/backups/20261031-cover-recycle-usage/nori.sql.gz` 与 `nori-pre-switch.sql.gz`。
- 已执行 `prisma db push`，切换后 schema diff 为空。
- 确认字段存在：`projects.coverImageKey`、`projects.deletedWithWork`、`works.deletedAt`、`works.deletedById`。

## 切换记录

- 发布前 `fixed-tos-config-guard` 通过（bucket `nori-test`），固定 TOS 探针上传/读取/签名读取/删除通过。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 切换时 queued/processing 任务为 0；仅重建 app/admin，MySQL/Redis 未重建。
- `BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261030-creative-login` / `sha256:bab3baee6cd4d138f14a941b356c70935639d69fcbc6a289021d8efb0e7f0c67`，源码指纹 `8130bcab…`。

## 线上验证

- app/admin 均 healthy，使用同一镜像 `sha256:ebdfd739…`，源码标签 `f775534c…` 一致；`norivideo:latest` 已指向该镜像。
- 容器内 `fixed-tos-config-guard` 与 TOS 探针通过，Prisma schema 存在。
- 工作台 `https://lanmiaoai.com/zh/auth/signin`、管理台 `https://lanmiaoai.com:8080/zh/admin/signin` 均返回 200。
- 本地 `tsc --noEmit` 通过；封面、回收站、Seedance 时长、用量归集、品牌与共享账号相关测试通过；报表真实组件在浏览器中验证账号与项目筛选。
- 仓库内 `character-bound-voice-surface`、`writer-and-seedance-surface` 两项源码字符串断言在发布前基线即失败，与本次改动无关。

## 清理

- 删除 `/opt/norivideo/build`，保留制品、`runtime.env`、备份与回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
