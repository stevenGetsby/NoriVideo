# 2026-11-05 生成厂商脱敏与 cgtid 发布

## 版本

- 提交：`cdb68c1 feat: hide generation provider names and expose cgtid`
- 源指纹：`0b851943a63e37823ef80522e1b0c5840c112e099a51eb1cc1999c9eb3395113`
- 制品：`855e5e3bdda896af3c942fdddbb51141d55979acdad419270131204f7a5a23e8`
- 镜像：`norivideo:release-20261105-generation-privacy`（`sha256:8840bfeea628…`）
- 上一镜像：`norivideo:release-20261105-openlux-password`（`558792da44f4…`）
- schema 无变更（`schemaChanged: false`）

## 变更范围

- 新增 `src/lib/task/public-presentation.ts`，统一公共任务序列化：移除内部 `externalId`，只输出 `cgtid`，错误码/错误消息/详情经 `sanitizePublicError()` 脱敏，`provider` 强制为 `null`。
- 公共出口覆盖：`/api/tasks`、`/api/tasks/[taskId]`（含 lifecycle 事件）、`/api/task-target-states`、workflow 项目状态、workflow-state、工具箱资产接口、画布生成对账与操作任务、播放列表渲染任务。
- 画布读取时递归清理旧节点中的 `errorMessage` / `pollErrorMessage` / `externalId`；失败节点展示 `cgtid`。
- 工具箱失败留痕展示并复制 `cgtid`。
- 同步图片生成成功后持久化 OpenLux 返回的 `requestId` 到 `Task.externalId`，作为公共 `cgtid` 使用。
- 脱敏规则覆盖厂商名（Kuaizi/OpenLux/筷子）、厂商域名、`KUAIZI:TYPE:…` durable ID、签名 URL 参数、`kz-…` key 与 Bearer token。
- 管理台服务配置与内部 worker/provider 日志保持原文，不受影响。

## 数据库

- 无 schema 变更，未执行 `prisma db push`；切换前 `migrate diff` 为空。
- 增量备份：`/opt/norivideo/backups/20261105-generation-privacy/nori.sql.gz` 与 `nori-pre-switch.sql.gz`。

## 构建与切换

- 服务器容器内 `--network none` 构建，基于上一版镜像；构建初始失败一次，原因是中断上传导致 `source.tar.gz` 截断，重传并校验 sha256 后重建成功。
- load 校验：制品哈希、源码标签、amd64、Prisma client、OpenLux 计价标准、构建产物含 `GENERATION_SERVICE` 与 `cgtid` 均通过。
- 切换时 queued/processing 任务为 0；仅重建 app/admin，MySQL/Redis 未动。
- 健康检查：app/admin healthy 且同一镜像；billing=ENFORCE、test-mode=OFF；TOS 守卫与探针通过；未登录 `GET /api/tasks` 返回 401；工作台与管理台登录页 200。
- 线上确认服务端产物包含脱敏规则（16 个 server chunk）与 `cgtid` 序列化。

## 线上配置变更

- 无。服务配置、TOS 固定区域/桶均未改动。

## 回滚

- 应用镜像：重新打 tag 到 `norivideo:release-20261105-openlux-password` 并重建 app/admin。
- 无数据库变更，无需数据回退。

## 清理

- 删除 `/opt/norivideo/build` 下的源码与依赖归档。
