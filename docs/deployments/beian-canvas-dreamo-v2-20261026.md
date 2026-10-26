# 备案机发布：Dreamo 设计深化（画布节点、生成器与整体比例）

完成时间：2026-10-26 16:18（Asia/Shanghai）。

## 发布内容

- 画布配色改为 Dreamo 中性深色体系：舞台近黑 `#070707`，节点卡 `#1f1f1f`、0.5px `#3d3d3d` 边框、16px 圆角；悬浮/选中改为灰色高亮，移除蓝色光晕。标题降为 11px 弱化色，积分消耗改为标题后的轻量角标。
- 连接点改为 Dreamo 风格：14px 透明热区，悬浮时在卡片外侧 22px 显示 18px “+” 圆钮；缩放手柄仅悬浮时出现。
- 节点工具栏、面包屑、撤销/重做、历史、保存、只读条、左侧栏与缩放条统一为玻璃胶囊；左侧栏 44px，主按钮使用 Dreamo 渐变；小地图默认隐藏；背景网格降为单层低对比。
- 生成器面板：视频类型顶部增加“全能参考 / 图生视频 / 首尾帧”模式页签；参考图为 42px 圆角磁贴，新增“+ 参考”磁贴；提示词区域改为无边框；模型、生成参数、生成声音、积分预估与渐变“生成”按钮收进同一行胶囊控件；参数弹层去掉残留的深蓝底。
- 行为不变：参考提交仍映射为 API `text` + `textOnly=false`，角色音色自动注入逻辑未改。

## 构建与制品

- 源码指纹：`02d0084854331eb6123f5c9c4fd7a1afe1ed07653e6d02a73975ec9faf8520af`。
- 相对上一版仅 5 个画布前端源码文件变化：`CanvasGraph.tsx`、`canvas.css`、`components/CanvasGenerator.tsx`、`nodes/CreativeNode.tsx`、`nodes/ProductionNode.tsx`；另更新 1 个快照单测。`package.json`、`package-lock.json`、`prisma/schema.prisma`、`Dockerfile` 未变，无数据库 schema 变更。
- 以上一版镜像 `norivideo:release-20261026-canvas-dreamo` 为基底，在备案机隔离容器 `norivideo-build-canvas-dreamo-v2` 内构建（`--network none`，Node 22.23.3，amd64）；`next build` 与 worker 构建均退出码 0。
- 构建产物归档 `application-artifacts.tar.gz`（仅 `.next`、`dist`、`public`、`messages`，无 `.next/cache`），SHA-256 `cdd6ec46056180a1e6eb27c5ba9488a4cc8cf00289ddec5d2d2c8fab8f98139c`。
- 发布镜像：`norivideo:release-20261026-canvas-dreamo-v2` / `sha256:7a2422c0cbafc8805fad13d9471786c35092d02b49726dfa2f1f78767e426e99`，源码标签与指纹一致。

## 切换记录

- 发布前固定 TOS 守卫通过（bucket `nori-test`，凭证指纹锁定）。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 业务库备份：`/opt/norivideo/backups/20261026-canvas-dreamo-v2/nori.sql.gz`；切换前再次备份 `nori-pre-switch.sql.gz`。
- Prisma schema diff 无 DDL；切换时 queued/processing 任务为 0。
- 第一次切换连接被重置，服务未变更；核对候选镜像与备份状态后以 `setsid` 分离方式重跑切换脚本，成功退出码 0。
- 仅重建 app/admin；MySQL/Redis 未重建。`BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261026-canvas-dreamo` / `sha256:cf0c31bcd3ebc5e329ee4ad84ee7a0d5f5eed8e6efe3ab54d5bff6ace1b70655`。

## 线上验证

- app/admin 均 healthy，使用同一 amd64 镜像，源码标签一致。
- 静态产物包含 `nori-canvas-generator-mode-tabs` 与 `首尾帧`。
- `https://lanmiaoai.com/zh/auth/signin` 返回 200；`https://lanmiaoai.com:8080/zh/admin/signin` 返回 200。
- 受保护文件与备份逐字节一致；queued/processing 任务为 0。
- 未提交真实登录后的画布交互验收；模式页签、参考磁贴与节点悬浮控件需在真实账号下点击确认。

## 清理

- 已删除构建容器 `norivideo-build-canvas-dreamo-v2`、`build-input/`、临时制品目录与仅 root 可读的 `runtime.env`。
- 保留发布目录、应用制品、业务库备份与上一版回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
