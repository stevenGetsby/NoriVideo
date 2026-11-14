# 2026-11-09 画布生成进度与资产库分页发布

## 版本

- 源指纹：`dc2bd4b3152efc46fa36aba5412138cce70c06f2a55eec285f280bc5d3c12148`
- 制品：`cad43408d2e1f9654d96b6a724f1f1c59408c6ee366aa7768cfca408d35a29bb`
- 镜像：`norivideo:release-20261109-canvas-progress-material`（`sha256:69533611a4f0…`）
- 上一镜像：`norivideo:release-20261109-generator-libtv`（`sha256:c6a21a40e3de…`，源指纹 `e797db67…`）
- schema 无变更（`schemaChanged: false`）

## 变更范围

- 画布视频生成节点完成态同步：节点缺少 `generation.assetId` 时，服务端用节点自身 `taskId` 精确回查同项目、`targetType=FrameosToolboxAsset` 的任务，经 `task.targetId` 找回素材并投影为 `SUCCEEDED/100`；前端支持 asset/task 双路轮询并回写绑定，修复视频已生成但节点仍停在 45% 或不显示进度的问题。
- `/api/frameos/toolbox/assets` 增加 `taskIds` 精确查询（最多 200 个，允许一项，不允许与 `assetIds` 同传），保留普通历史列表按 `assets` 返回的既有行为。
- 资产库左侧“作品”改为单项选中（不再按同一项目整组高亮/整组加载）；素材改为每页 60 个游标分页，滚动到底部可继续加载，避免一次性渲染全部素材导致页面卡死。
- 同步发布上一轮已完成的模型配置对齐（HuiMeng/OpenLux 目录、生成配置、用户模型与 provider 轮询）等 22 个源码文件。
- `standards/` 无变更，沿用基础镜像中的 HuiMeng/OpenLux 能力与价格表。

## 验证

- 生成节点同步：4 个聚焦测试文件 34/34 通过；真实 `CanvasGraph` 浏览器用例两条通过（45% → 轮询 `assetIds=video-1` 后进度遮罩消失并渲染视频；仅 `taskId` 时 `taskIds=task-1` 回查后显示成片），无页面错误。
- 资产库：`material-interactions.browser.mjs` 实机组件 29/29 场景通过，覆盖单项作品选中、每页 60 个与加载更多、删除与上传回归，无页面错误；相关单元测试 37/37 通过；改动文件 TypeScript 检查 0 错误。
- 构建：服务器容器内 `--network none`，基于 `release-20261109-generator-libtv` 构建，产物 25.2MB（25180894 bytes）。
- load：制品哈希、源码标签、amd64、Prisma client、HuiMeng/OpenLux 标准文件以及本次两条新字符串（`滚动到底部可继续加载`、`assetIds/taskIds 格式无效`）校验通过。
- switch：queued/processing 任务为 0；仅重建 app/admin，MySQL/Redis 未动；app/admin 均 healthy 且同一镜像；`billing=ENFORCE`、`test-mode=OFF`；TOS 守卫与 upload/read/signed-read/delete 探针通过；工作台与管理台登录页 200。
- 未触发任何真实付费生成。

## 备份

- `/opt/norivideo/backups/20261109-canvas-progress-material/nori.sql.gz`
- `/opt/norivideo/backups/20261109-canvas-progress-material/nori-pre-switch.sql.gz`
- 保护文件（`.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json`）发布前后一致。

## 未包含

- storyboard 编辑框滚轮无法滚动、底部文字不可见及刷新机制问题尚在排查，未包含在此次发布。
