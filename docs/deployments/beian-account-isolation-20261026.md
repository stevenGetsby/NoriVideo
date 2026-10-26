# 备案机发布：账号隔离的可见权限

完成时间：2026-10-26 20:20（Asia/Shanghai）。发布目录标签：`20261027-account-isolation`。

## 发布内容

- 作品（`projects` 表）可见性按账号隔离：
  - 管理账号（工作区主账号）可见整个工作区的全部项目与作品。
  - 项目负责人（项目创建者，或在所属项目 `work_members` 中有管理权）可见其项目下的全部作品。
  - 其他子账号仅可见自己创建的、被邀请为作品成员的、在任务分工中被分配到阶段的作品。
- 隔离在服务端统一执行：作品/项目查询谓词（`projectReadScopeWhere`、`workReadScopeWhere`）收窄；同时在 API 网关层对路由中的 `projectId` 做一次校验，不属于可见范围时返回 404，无需逐个改写作品路由。
- 工作区级列表同步过滤：作品列表与作品移动、团队概览、任务列表、费用汇总（总额只累计可见作品）。
- 协作模式不变：自由协作/任务分工、任务分配与审核能力沿用原规则；被分配任务即获得该作品可见性。
- 无数据库 schema 变更，无依赖变更，无迁移。

## 构建与制品

| 源码指纹 | 制品 SHA-256 | 镜像 |
| --- | --- | --- |
| `29c4cdd7bb4e0ae2cd486ae54e81721b0736041f06aad1febf6eebb9024e51c0` | `3f185162f730ab617cb7f5570439452ea9ff881304f755d90e1bca25565217e9` | `norivideo:release-20261027-account-isolation` / `sha256:1b29b62ea2afc88dab92fa80bc5ec1702287f5dff54f9e2335b53add3c886a1f` |

- 相对上一版源码仅 8 个服务端文件变化，`package.json`、`package-lock.json`、`prisma/schema.prisma`、`Dockerfile` 未变。
- 在备案机 `--network none` 隔离容器内、从上一版镜像（Node 22.23.3、amd64）构建；补入 Linux 平台的 Tailwind oxide 与 lightningcss 原生包。
- 制品只含 `.next`、`dist`、`public`、`messages`，已剔除 `.next/cache`。

## 切换记录

- 发布前 `fixed-tos-config-guard` 通过（bucket `nori-test`）。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 切换前后各备份一次业务库（`/opt/norivideo/backups/20261027-account-isolation/nori.sql.gz` 与 `nori-pre-switch.sql.gz`）。
- Prisma schema diff 为空；切换时 queued/processing 任务为 0。
- 仅重建 app/admin；MySQL/Redis 未重建。`BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261026-neutral-ui-v2` / `sha256:6222a3412a455b062611ce3e860b7e974e0a6eb092b760b50fce49a21f221433`。

## 线上验证

- app/admin 均 healthy，使用同一镜像，源码标签 `29c4cdd…` 一致；app 与 admin 镜像 ID 相同。
- TOS 上传/读取/签名读取/删除探针通过。
- 已发布的 `.next/server/chunks/92574.js` 中包含新代码标识（`routeProjectId`、`findHiddenProjectIds`、`isProjectHiddenFromActor`、`visibleProjectsWhere`）。
- `https://lanmiaoai.com/zh/auth/signin` 与 `https://lanmiaoai.com:8080/zh/admin/signin` 均返回 200。
- 发布前本地 `tsc --noEmit` 无错误；单测 2270 项全部通过。
- 未用真实子账号登录逐页验收；建议用一个子账号确认「只能看到自己的作品」以及跨作品直链返回 404。

## 清理

- 已删除 `/opt/norivideo/build`（源码、原生包补丁与 2.4G 构建目录），保留发布目录、制品、业务库备份与上一版回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
