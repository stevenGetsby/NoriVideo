# 备案机移除 TGG 视频上游（2026-11-26）

- 范围：产品中彻底移除 TGG（tggtoken.org）。删除 `src/lib/providers/tgg/*`、`standards/{capabilities,pricing}/tgg.*.json`、tgg 单测；移除 `MODEL_PROVIDER.TGG`、平台服务里的 tgg provider/模型/密钥环境变量/路由门控、业务模型 `nori::tgg-seedance2.5` 与 `nori::tgg-vig2.5`、`generator-api` 的 tgg 分支、`async-poll` 的 `TGG:` 命名空间、管理端 TGG 卡片与健康探测。无 schema 变更。
- 保留：`TGG_*` 错误码文案、`sanitize-public-error` / `public-presentation` 中的 TGG 脱敏，历史任务与用量记录仍可读、仍不外泄上游信息。`savePlatformServiceConfig` 对仍带 `tgg` provider 的旧客户端载荷静默忽略。
- 影响：旧 `externalId` 为 `TGG:` 的未完成任务会报「ASYNC_TASK_PROVIDER_RETIRED」；发布前库中待处理 TGG 任务为 0。36 个画布节点数据里仍写着 `tgg::` / `nori::tgg-*`，读取时走旧值推断回退（2.5 模型落到 `nori::norivideo2.5` 路由），不改库。
- 基线：`release-20261126-chapter-ops-fix`（source sha `e903833a…`）+ 覆盖。新源码 sha256 `63f370ce…`。镜像 `norivideo:release-20261126-remove-tgg`，verify 通过，`switch.done=0`，app/admin healthy。
- 服务器配置：`/opt/norivideo/data/services.prod.json` 已删除 `tgg` provider（含其 API Key）、tgg 模型、`nori::tgg-*` 路由；改前备份 `/opt/norivideo/backups/20261126-remove-tgg/services.prod.before-remove-tgg.json`。
- 回滚：`norivideo:release-20261126-chapter-ops-fix` 重新 tag 为 latest 并 force-recreate app/admin；配置回滚用上述备份。
- 遗留：未做浏览器冒烟（管理页不再出现 TGG、旧 TGG 节点打开/生成回退）；TGG 密钥已从服务器配置删除，如需彻底作废请在 TGG 后台处理；上线后日志里有单个画布（`d6cba178…`）的 ops 偶发 INVALID_PARAMS（20 分钟内 2 次，非循环），疑为旧页面缓存，建议刷新后观察；本地 main 未包含这些改动。
