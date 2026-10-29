# 备案机发布：服务配置收敛为 DeepSeek + Kuaizi

完成时间：2026-10-29 19:50（Asia/Shanghai）。发布目录标签：`20261029-service-provider-simplification`。

## 发布内容

- 管理台「服务配置」重做为 `API 连接 → 按用途选择模型 → 素材存储 → 调用用量` 四段，只剩两张固定 Provider 卡片：DeepSeek 官方（文本）与 Kuaizi（图片 / 视频 / 语音合成）。
- 平台模型目录固定由代码生成（`fixedPlatformModels()`），旧 `services.json` 不能再覆盖协议、类型或 modelKey。
- 显式空路由保存为「该能力已停用」，不会在读取时回落到推荐路由；用户侧 API 配置接口拒绝写入 provider/model，并移除 lip-sync、voice-design 默认模型字段。
- AI 声音设计整链路退役：worker、路由、界面与提示词统一以 `VOICE_DESIGN_RETIRED` 明确失败；DeepSeek 文本模型收到视觉请求时以 `VISION_NOT_SUPPORTED` 明确失败，不再伪造分析结果。
- 删除通用素材模板助手及其 probe/validate 路由，删除 Ark / Bailian / Fal / SiliconFlow / MediaKit Provider 适配器与未使用的 gateway-route 迁移脚本。
- 教程类提示词并入本地化提示词目录（`assistant_tutorial_system`）。

## 构建与制品

| 源码指纹 | 制品 SHA-256 | 镜像 |
| --- | --- | --- |
| `18388f1c30e76da475fa25784d10cf5e9186ee4117091b291c3850ecc2b18e41` | `a2867f66ae763cfb8f1744d8399fbc39229af4fb6b5134a600e71250ec85708e` | `norivideo:release-20261029-service-provider-simplification` / `sha256:bf211152bc841ddc9a12e7717a35f21e1275abea06ae26dc265e2fb31fb5d12e` |

- 提交 `3638a8d`（333 个文件，+2850 / −38122）。指纹覆盖 1677 个文件，其中 241 个与上一版不同；`package.json` 有 1 行删除，`package-lock.json` 未变，依赖树沿用上一版镜像。
- 应用在服务器容器内以 `--network none`、基于上一版镜像 `norivideo:release-20261029-canvas-playback` 构建（`✓ Generating static pages (161/161)`），制品 22M。
- 候选镜像校验：源码标签一致、`amd64`、`.prisma/client` 与 `prisma/schema.prisma` 均含 `InteractiveStory`。

## 数据库

- `prisma migrate diff` 为空，无结构变更，未执行 `prisma db push`。
- 切换前备份业务库：`/opt/norivideo/backups/20261029-service-provider-simplification/nori.sql.gz` 与 `nori-pre-switch.sql.gz`。

## 切换记录

- 发布前 `fixed-tos-config-guard` 通过（bucket `nori-test`），固定 TOS 探针上传/读取/签名读取/删除通过。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致；线上服务配置未改动。
- 切换时 queued/processing 任务为 0；仅重建 app/admin，MySQL/Redis 未重建。
- `BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261029-canvas-playback` / `sha256:cc307ed1958042018c8ceb9ab5c5ed2d3b92190143f570f3c07cc09c9599869b`。

## 线上验证

- app/admin 均 healthy，使用同一镜像 `sha256:bf211152…`，源码标签 `18388f1c…` 一致；`norivideo:latest` 已指向该镜像。
- 容器内 `fixed-tos-config-guard` 与 TOS 探针通过，Prisma schema 存在。
- 工作台 `https://lanmiaoai.com/zh/auth/signin`、管理台 `https://lanmiaoai.com:8080/zh/admin/signin` 均返回 200。
- 本地 `tsc --noEmit`、`eslint .`、prompt-i18n / config-center / model-config-contract / requirements-matrix / route-coverage / no-api-direct-llm-call / no-media-provider-bypass 等守卫全部通过；管理台服务配置在桌面与 390px 无横向溢出（headless 截图核验）。

## 清理

- 删除 `/opt/norivideo/build`（源码与构建中间物）与发布目录内解包出的 `artifacts/`，保留制品、`runtime.env`、备份与回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
