# 备案机发布：角色音色角标、画布音色提示、工作留痕与全能参考默认模式

完成时间：2026-10-25 19:09（Asia/Shanghai）。

## 发布内容

- 素材库与工具箱角色卡增加音色状态角标：已绑定显示“音色”，未绑定显示“缺音色”；修复 72px 参考卡角标被裁切的问题。
- 画布生成器与画布项目素材区展示角色音频绑定状态，引用缺音色角色时给出明确提示。
- 工具箱新增“工作留痕”，记录提示词、模型、模式、参数、参考素材、积分与任务状态；草稿版本升级到 v3，v2 的 `text` 模式自动迁移到 `reference`。
- 视频生成默认模式改为“全能参考（图片 / 视频 / 音色）”。工具箱 `reference` 提交仍映射为 API `text` + `textOnly=false`，保留服务端角色音色自动注入逻辑。

## 构建与制品

- 源码指纹：`9a8452203a00f5500f1c642408634978d490e1a37f29217ab53f0a18060dd8c7`。
- 相对上一版仅 12 个前端源码文件变化；`package.json`、`package-lock.json`、`prisma/schema.prisma`、`Dockerfile` 未变，无数据库 schema 变更。
- 本地 macOS FileProvider 持续抖动，无法可靠完成生产构建；改为在备案机隔离容器内构建：以上一版镜像 `norivideo:release-20261015-webp-fix` 为基底，`--network none`，Node 22，amd64。
- 构建产物归档 `application-artifacts.tar.gz`，SHA-256 `92d90a77ae481114915e3a9e4258f9d93f718b668b594f48ec298e874909d287`，仅包含 `.next`、`dist`、`public`、`messages`；归档结构与上一版一致。
- 发布镜像：`norivideo:release-20261025-character-voice-trace` / `sha256:457f8f26c7afd2f45877f9be1992be05ed72f182c6671b06938f81fd6cf1e693`，标签 `org.norivideo.source-sha256` 与源码指纹一致。
- 发布脚本修正：`BASE_IMAGE` 必须使用本地标签而非镜像 ID，否则 BuildKit 会把 `sha256:...` 解析为远程 `docker.io/library/sha256`。

## 切换记录

- 发布前固定 TOS 守卫通过（bucket `nori-test`，凭证指纹锁定），upload/read/signed-read/delete 探测通过。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 业务库备份：`/opt/norivideo/backups/20261025-character-voice-trace/nori.sql.gz`；切换前再次备份 `nori-pre-switch.sql.gz`。
- Prisma schema diff 无 DDL；切换时 queued/processing 任务为 0。
- 候选镜像先以 `SERVICE_MODE=web` 在 `127.0.0.1:13000` 隔离启动，登录页、管理登录页、工具箱均返回 200，守卫通过后停止。
- 仅重建 app/admin，MySQL/Redis 未重建；`BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261015-webp-fix` / `sha256:4e8f746e03e34bc71753a4b368337393382925d776eb6a664d7cb92abead084f`。

## 线上验证

- 工作台与管理台均 healthy，app/admin 使用同一 amd64 镜像，源码标签一致。
- 静态产物包含 `工作留痕`、`全能参考（图片 / 视频 / 音色）`、`toolbox-ref-voice-badge`、`nori-canvas-generator-ref-voice`、`缺音色`。
- `https://lanmiaoai.com/zh/auth/signin` 返回 200；`https://lanmiaoai.com:8080/zh/admin/signin` 返回 200；工具箱返回 200；管理台根路径 307 跳转。
- 受保护文件与备份逐字节一致；queued/processing 任务为 0。
- 未提交真实登录、付费生成或数据库写入验收；工作留痕与音色角标的登录后交互需在真实账号下点击确认。

## 清理

- 已删除构建容器 `norivideo-build-voice-trace`、`build-input/` 和仅 root 可读的 `runtime.env`。
- 保留发布目录、应用制品、业务库备份与上一版回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
