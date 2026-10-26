# 备案机发布：全局前端中性化与控件尺寸统一

完成时间：2026-10-26 18:07（Asia/Shanghai）。

## 发布内容

- 全局配色改为 Dreamo 中性深色体系：页面/卡片/悬浮层统一黑灰阶，移除工作台、素材库、工具箱、剧本、分镜、剪辑、账号、个人中心、认证页与画布弹层里的深蓝/藏青底色与蓝色高亮。
- 只保留一个品牌渐变 `linear-gradient(270deg, #8109ff 15%, #3265ff)` 用于主操作按钮（`--fos-gradient-cta`），其余选中态、筛选、标签、图标底改为白色低透明度 wash。
- 平台管理台（`.nori-admin`）此前仍单独定义蓝色 token，本次同步为中性 token 与同一渐变；`AI` 图标渐变、画布 `--canvas-primary`、`--canvas-border-strong` 改为品牌紫蓝。
- 控件尺寸统一：工具栏按钮、输入框、下拉、搜索框、筛选页签字统一 32px（`.fos-btn`、`.fos-input`、`.fos-material-search`、`.works-search`）；28px 仅用于密集内联操作；40px 仅用于弹窗主按钮。素材库/工具箱/作品头部按钮由 28px 提升到 32px，素材筛选页签固定 32px，移除管理台与模型配置弹窗里的 `h-9`/`h-10` 覆盖。
- 行为不变：仅样式与类名调整，未改接口、计费、任务与数据字段；画布数据色（分组调色板、节点类型色、小地图）保持原值。

## 构建与制品

两次构建，最终线上为 v2：

| 阶段 | 源码指纹 | 制品 SHA-256 | 镜像 |
| --- | --- | --- | --- |
| 首次 | `a6910a0132f0eb58b70a468a8b48f24081a9443e88d17338cd52177ba4d125a2` | `df1b6b83c5d4393a706e2d6d1a1f938d95230d66deab1eeeec9e91dd955ff255` | `norivideo:release-20261026-neutral-ui` / `sha256:e0d493f34c83da1740b751820b22a4169501feaed866136b5c5755ec01ab48f1` |
| 收尾 | `e625dbdcf5dd7b938c646d86e051578dc1f7d75f0572b8b0013fa1b7b3d74192` | `235a612dd395302179e5e8614679e7c43d7799898fdc57b6a9fb101fd13e49c5` | `norivideo:release-20261026-neutral-ui-v2` / `sha256:6222a3412a455b062611ce3e860b7e974e0a6eb092b760b50fce49a21f221433` |

- 相对上一版共 56 个前端源码文件变化（CSS 与 TSX 配色/尺寸），`package.json`、`package-lock.json`、`prisma/schema.prisma`、`Dockerfile` 未变，无数据库 schema 变更。
- 在备案机隔离容器（`--network none`，上一版镜像内 Node 22.23.3、amd64）从上一版镜像构建；补入 Linux 平台的 Tailwind (`@tailwindcss/oxide-linux-x64-gnu`) 与 lightningcss 原生包。
- 首次构建因 macOS tar 生成的 `.__*` AppleDouble 文件导致 webpack 报 UTF-8 错误，清理后重建成功；第二次改用 `COPYFILE_DISABLE=1` 打包。
- 制品仅含 `.next`、`dist`、`public`、`messages`，无 `.next/cache`。

## 切换记录

- 发布前固定 TOS 守卫通过（bucket `nori-test`）。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 两次切换前业务库均已备份（`/opt/norivideo/backups/20261026-neutral-ui*/nori.sql.gz` 与 `nori-pre-switch.sql.gz`）。
- Prisma schema diff 为空（`-- This is an empty migration.`）；切换时 queued/processing 任务为 0。
- 仅重建 app/admin；MySQL/Redis 未重建。`BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261026-canvas-dreamo-v2` / `sha256:7a2422c0cbafc8805fad13d9471786c35092d02b49726dfa2f1f78767e426e99`。

## 线上验证

- app/admin 均 healthy，使用同一 amd64 镜像，源码标签 `e625dbd…` 一致。
- 固定 TOS 上传/读取/签名读取/删除探针通过。
- 线上 CSS 中不再存在 `--fos-primary:#3b82f6`；`--canvas-primary:#3265ff`。
- `https://lanmiaoai.com/zh/auth/signin` 与 `https://lanmiaoai.com:8080/zh/admin/signin` 均返回 200。
- 发布前本地 `tsc --noEmit` 无错误；canvas/frameos 单测 705 项全部通过（其中 5 项颜色断言已按新 token 更新）；浏览器回归除原有的 `project-corner-cases`、需登录/本地服务的 `admin-daily-limit`/`studio-node`/`project-hierarchy` 外均通过。
- 未做真实账号下的逐页点击验收；弹窗、超管对话、管理台细节建议登录后复核。

## 清理

- 已删除两个构建容器、`build/`、`node_modules.tar.gz` 与仅 root 可读的 `runtime.env`。
- 保留两个发布目录、应用制品、业务库备份与上一版回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
