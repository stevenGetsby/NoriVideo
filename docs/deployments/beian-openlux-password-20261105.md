# 2026-11-05 首登改密与 OpenLux 生图发布

## 版本

- 提交：`2ee0ed8 feat: require initial password change and move image generation to OpenLux`
- 源指纹：`f57f1fd8fd35a88a53466ea5b963445ac72ca459678ddd180c74956c6a8019d0`
- 制品：`7a32113d41ad3dcfcf2164e095856b5d072cc2d996e7d56f88bbca82947e17aa`
- 镜像：`norivideo:release-20261105-openlux-password`（`sha256:558792da44f4…`）
- 上一镜像：`norivideo:release-20261104-seedance-25-pricing`（`2c1a2424d8cf…`）
- schema 有变更（`schemaChanged: true`）

## 变更范围

- 管理员新建子账号、管理员重置密码后置 `passwordChangeRequired=true`；JWT/session 透传，边缘中间件、业务 API 守卫、独立改密 API 与改密页面共同拦截，改密成功后清除标记（不递增 `sessionVersion`）。
- 生图改走 OpenLux：mini/fast → `gpt-image-2.5-flare`，standard/pro → `gpt-image-2.5-sunburst`；文生图、参考图编辑、蒙版重绘沿用画布入参。
- 平台 Provider 收敛为 DeepSeek（文本）、OpenLux（图片）、Kuaizi（视频/音频），管理台服务配置同步展示三家与 OpenLux 能力项。
- 新增 `standards/capabilities/openlux.catalog.json` 与 `standards/pricing/openlux.pricing.json`（图片按次 flat 计价）。

## 数据库

- 增量同步（`prisma db push`）：`user.passwordChangeRequired BOOLEAN NOT NULL DEFAULT false`。
- schema diff 仅一条 `ALTER TABLE ... ADD COLUMN`，无破坏性语句；同步后 diff 为空。
- 备份：`/opt/norivideo/backups/20261105-openlux-password/nori.sql.gz` 与 `nori-pre-switch.sql.gz`。

## 构建与切换

- 服务器容器内 `--network none` 构建，基于上一版镜像，Next 静态页 164/164，产物 18.6MB。
- prepare：保护文件与业务库备份；load：制品哈希、源码标签、amd64、Prisma client 与 OpenLux 标准文件校验通过。
- 切换时 queued/processing 任务为 0；仅重建 app/admin，MySQL/Redis 未动。
- 健康检查：app/admin healthy 且同一镜像；billing=ENFORCE、test-mode=OFF；TOS 守卫与探针通过；工作台与管理台登录页 200；改密页 200；未登录 `POST /api/auth/change-password` 返回 401；管理台未登录访问改密页按设计 307 回登录页。

## 线上配置变更

部署后单独写入 `/opt/norivideo/data/services.prod.json`（mode 600，原文件备份为 `services.prod.json.bak-pre-openlux-20261105055858`）：

- providers：`deepseek`（无密钥）、`openlux`（有密钥）、`kuaizi`（保留原密钥与 `assetGroupId`）。
- 路由：文本 → `deepseek::deepseek-chat/reasoner`；四档图片 → OpenLux flare/sunburst；视频与音频保持原 Kuaizi 模型；TOS 与固定区域/桶未变。
- 切换阶段的“保护文件一致”断言在写入配置前已通过；本次配置写入为发布后的显式运维操作。

## 生成服务状态

- OpenLux：容器内 `GET /v1/models` 返回 200，4 个模型，含 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`。
- Kuaizi：空任务探针返回 400 `InvalidParameter`，Bearer 鉴权通过且未创建付费任务。
- DeepSeek：服务器上无可用官方密钥（历史备份中的同名字段为非 ASCII 占位值），文本生成**尚未验证**，需在管理台服务配置中填入真实 `DeepSeek Api Key` 后才能确认健康。
- 未执行任何付费生图。

## 回滚

- 应用镜像：重新打 tag 到 `norivideo:release-20261104-seedance-25-pricing` 并重建 app/admin。
- 数据库新增列为带默认值的可空兼容变更，旧镜像忽略该列；如需回退可保留列，无需立即删除。
- 服务配置可恢复 `services.prod.json.bak-pre-openlux-20261105055858`。

## 清理

- 删除临时 OpenLux 密钥文件（服务器 `.openlux.key` / `.openlux.env` 与本地 `/tmp/openlux_key.txt`），密钥仅保留在 `services.prod.json`。
- 删除 `/opt/norivideo/build/app` 与解包目录，保留源码、依赖归档与 `runtime.env`。
- 本地 ESLint 曾两次无输出挂起被终止，未完成验证；本次以 52 项鉴权测试、31 项 OpenLux 测试、611 项画布/计费测试、`tsc --noEmit` 与 Prisma 校验为准。
