# 2026-11-07 绘梦接入与画布对照生成发布

## 版本

- 提交：`5f180dd feat: add HuiMeng provider switching and grouped canvas mentions`，工作区另含画布对照生成与拖动显示改动
- 源指纹：`87121abeee21033651f024f402035a19b484bee78ca37b15e75b0a054fe3980f`
- 制品：`f8fca8004eeae4157e7533ec44b72318f7e7c9aad248022d6af7b33b6f0b4e69`
- 镜像：`norivideo:release-20261107-canvas-comparison`（`sha256:43537556bf77…`）
- 上一镜像：`norivideo:release-20261105-generation-privacy`（`sha256:8840bfeea628…`）
- schema 无变更（`schemaChanged: false`）

## 变更范围

- 接入绘梦工坊图片/视频 provider，能力目录 `standards/capabilities/huimengi.catalog.json`、计价目录 `standards/pricing/huimengi.pricing.json`，管理台按业务模型切换上游。
- 画布 @ 素材分级：已连接节点与个人素材库，素材库按角色、场景、道具、镜头、普通素材折叠，支持搜索与自动建节点连线。
- 修正 Seedance 2.5 共 30 图、10 视频、10 音频的引用上限，不再固定限制 15 个素材；其他模型的分类上限保持不变。
- 视频节点再次生成时在右侧创建对照节点，继承原节点全部输入连线，旧视频与旧连线保留；对照节点和继承连线在提交任务前持久化，提交失败自动清理并可重试。
- 节点拖动时隐藏 storyboard 工具栏/提示与生成器面板，停止拖动后平滑恢复，支持 `prefers-reduced-motion`。

## 数据库

- 无 schema 变更，未执行 `prisma db push`；切换前 `migrate diff` 为空。
- 增量备份：`/opt/norivideo/backups/20261107-canvas-comparison/nori.sql.gz` 与 `nori-pre-switch.sql.gz`。

## 构建与切换

- 服务器容器内 `--network none` 构建，基于上一版镜像；Next、worker、watchdog、storage-init、bull-board 全部构建成功。
- load 校验：制品哈希、源码标签、amd64、Prisma client、绘梦能力/计价标准、构建产物包含绘梦与画布对照代码均通过。
- 切换时 queued/processing 任务为 0；仅重建 app/admin，MySQL/Redis 未动。
- 健康检查：app/admin healthy 且同一镜像；billing=ENFORCE、test-mode=OFF；TOS 守卫与探针通过；工作台与管理台登录页 200。

## 线上配置变更

- 无。服务配置、TOS 固定区域/桶均未改动；本次未切换任何业务模型到绘梦，实际切换在管理台执行。

## 回滚

- 应用镜像：重新打 tag 到 `norivideo:release-20261105-generation-privacy` 并重建 app/admin。
- 无数据库变更，无需数据回退。

## 清理

- 删除 `/opt/norivideo/build` 下的源码与依赖归档。
