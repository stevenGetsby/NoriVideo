# 2026-11-15 备案机当前工作区版本

## 发布范围

- 用户明确授权将当前工作区版本部署到生产备案机 `14.103.65.61`。
- 相对上一份生产镜像 `norivideo:release-20261112-kuaizi-health`，本次包含成员积分方式与实际点击者付费、影游三层画布、画布主题与编辑修复、性能优化及视频转绘台词保护等当前工作区变更；不是仅发布转绘文件。
- 新镜像：`norivideo:release-20261115-current-workspace` / `norivideo:latest`，ID `sha256:52e7ba36b3c8416f70d48b7e51aeb56e48c595f7c35f619960898ca2d316ee6e`。
- 源码 fingerprint：`81eb0c0f37ac28c5846b3a06367d3eabb82036725707dd5148da07d73e80d472`。源码包 SHA-256：`2b4ab35fe715377bfe1e56465f5672766be36b3b2d3d46a47ee27c335dc14773`；1856 个纳入指纹的文件，321 项相对旧版本的变化。
- 未提交或推送源码，未执行真实付费生成。

## 数据库与备份

- 使用受保护的 additive schema 检查及 `prisma db push`，未删除或改写已有列：
  - `works.productLine` 与 `works_workspaceOwnerId_productLine_idx`。
  - `projects.creationMode`。
  - `user.pointMode`，默认 `unlimited`。
- 影游及画布创建方式按 `scripts/sql/20261114-backfill-product-line-creation-mode.sql` 幂等回填。
- 最终复核：19 条影游关联对应 work 均为 `story`；其中 13 条为未删除 work，其余为已删除历史。全部影游章节均为 `canvas`；story/chapter 分类遗漏均为 0。未删除普通 work 15 个；未删除 project 中 canvas 51 个、workflow 19 个。
- 最终 Prisma schema diff 为空迁移；未新增生成任务，复核时活动任务数为 0。
- 数据库备份：`/opt/norivideo/backups/20261115-current-workspace/nori.sql.gz`、`nori-pre-switch.sql.gz`，均约 191 MiB 且 gzip 校验通过。受保护配置已备份并在切换后比对一致。

## 运行验证

- app/admin 均 healthy，使用相同新镜像。
- 公网 `https://lanmiaoai.com/zh/auth/signin` 和 `:8080/zh/admin/signin` 返回 200；未登录 `/api/tasks` 返回 401。
- 固定 TOS 配置检查、上传/读取/签名读取/临时对象删除探针通过。
- `BILLING_MODE=ENFORCE`，测试模式关闭；新 Prisma client、schema 及 HuiMeng/OpenLux standards 均在运行镜像中。
- 发布后按 error/exception/unhandled/Prisma unknown 过滤 app/admin 日志，未发现异常。
- 本地验证：转绘相关 14 文件 265 项、当前工作区其他回归 76 文件 726 项通过；Prisma validate 通过。既有 TypeScript 错误来自脚本、测试 fixture 和 Finder 重复文件，未以这些文件替代正式源码检查。

## 收尾与偏差

- 首次自动回填命令缺少 `docker exec -i`，SQL 没有进入容器；发现后立即用同一幂等 SQL 重新执行并确认零遗漏。本地和远端 `deploy.sh` 均已修正并增加 story/chapter 零遗漏断言，不需要也不应重复执行已完成的 switch。
- 已清理 `/opt/norivideo/build` 中本次构建临时内容；未触碰 `/data` 的实时数据库文件。
- 没有以容器健康替代业务测试；本轮生产未发起付费模型抽测，因此不宣称真实模型对白措辞或付费生成已在线验证。
