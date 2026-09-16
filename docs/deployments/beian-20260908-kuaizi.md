# 备案机发布记录：2026-09-08

用户明确指定部署到备案机 `14.103.65.61`，并取消 MiniMax H3。未修改 `45.76.215.9`，未访问退役服务器。

## 版本与备份

- 发布镜像：`norivideo:release-20260908T050705Z-kuaizi`
- 镜像 ID：`20e0d9ed0f3b2e6ca335ddb93b58c13327309a8927a309872123948833ad24c5`
- 平台：原生 `linux/amd64`。
- 旧镜像：`norivideo:predeploy-20260908T050705Z-kuaizi`（`3db4af1801e3`）。
- 源码及构建记录：`/opt/norivideo/releases/20260908T050705Z-kuaizi`。
- 数据库与配置备份：`/opt/norivideo/backups/20260908T050705Z-kuaizi`，目录权限 700，数据库备份权限 600。

构建在独立目录完成，使用服务器原生依赖，按现有 lockfile 补齐构建依赖；未上传本地密钥文件。构建期间保留旧服务，切换时无排队或进行中的生成任务。

## 数据库

经 `prisma migrate diff` 确认，仅新增两个可空字段：

- `character_appearances.seedanceAssetScope VARCHAR(191) NULL`
- `service_usage_records.metadata JSON NULL`

通过现有 `prisma db push --skip-generate` 工作流同步，未删除表或已有列。

## 验证结果

- 233 项回归测试、独立 TypeScript 检查通过。
- 固定 TOS 守卫在部署前及新容器中通过。
- 候选镜像和上线后的容器均通过 TOS 上传、直接读取、签名读取、删除探测；临时对象已删除。
- 应用、管理台健康，新 schema 可读，新 worker 计费与素材逻辑存在，`BILLING_MODE=ENFORCE`。
- 公网工作台 `https://lanmiaoai.com/zh/auth/signin`、管理台 `https://lanmiaoai.com:8080/zh/admin/signin` 均返回 HTTP 200，响应为实际 Next.js 应用页面，TLS 验证正常。
- `.env`、`data/services.prod.json`、`.deploy.env`、`.env.local`、`docker-compose.prod.yml` 与备份逐字节一致。
- 未进行付费生成实测，未接入 MiniMax H3。

此前连接异常在切换版本前已恢复；本次未修改 Nginx、DNS 或证书。

## 后续操作说明

TOS 探测入口为 `scripts/guards/fixed-tos-probe.ts`，构建产物为 `dist/fixed-tos-probe.js`。在应用容器内执行该产物时，会先运行固定 TOS 守卫；不会输出 AK/SK、签名 URL 或上游原始错误。

旧角色私有素材若缺少账号归属记录，需要重新注册后使用。Seedance 2.5 的 1080p、独立 EP 仍未启用。
