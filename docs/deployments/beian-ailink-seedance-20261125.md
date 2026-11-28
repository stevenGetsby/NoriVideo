# 备案机发布 AILink Seedance 2.5（2026-11-25）

- 范围：新增第四个视频上游 AILink（火山方舟原厂协议），模型 `doubao-seedance-2-5` 与 `doubao-seedance-2-5-flash`。无依赖、无 schema 变化。
- **基线**：线上源码 `20261125-canvas-mention-poster-hotfix`（head `382f09a`，该提交在另一台机器，未推送；本地 main c8eb8c3 落后于线上）。发布源码 = 线上 `build/source.tar.gz` 解包 + 仅 AILink 相关 17 个文件覆盖/新增，逐文件 diff 确认无夹带。本地画布三个未提交文件（canvas-offline-store 等）**未包含**。
- 改动面：`src/lib/providers/ailink/`（client/catalog/video/poll/external-id/types/index）、generator-api、async-poll、model-provider-contract、platform-services（config/discovery/health/model-selection）、nori-model-catalog、canvas/generator-options、billing/cost（token 计价集合）、errors/sanitize-public-error、official/model-registry、`standards/{capabilities,pricing}/ailink.*.json`。
- 价格（火山官方，元/百万 token）：2.5 为 70/42（480p/720p）、77/46（1080p）；flash 为 46/28（480p/720p 同价）。两个模型均在 `fixedPlatformModels`（有价即可选）。
- 测试：`tests/unit/providers/ailink/ailink.test.ts`（15）、`tests/unit/billing/ailink-pricing.test.ts`（5）新增；`platform-service-config.test.ts` 提供商列表加入 ailink。相关 23 个测试文件 177 用例全过；tsc 无新增错误（本地 node_modules 损坏，借用 /private/tmp/hotfix-wt 的工具链）。
- 构建：备案机离线 `--network none` 容器，基底 `norivideo:release-20261125-canvas-mention-poster-hotfix`，源码 sha256 `7ad2f8ce…`，产物 sha256 `73fe7d7a…`。
- 候选：`norivideo:release-20261125-ailink-seedance`；load 校验 + 独立 web 预检（13841 端口 sign-in 200）通过。
- 切换：`drain-and-switch.sh` 拦截新生成 → 队列排空 → `deploy.sh switch`（schema diff 为空、备份、健康检查、失败自动回滚）。2026-11-25 14:33（北京时间）`SWITCH_EXIT=0`，app/admin 均 healthy，nginx 已恢复。
- 上线后配置（已通过编译后的 `savePlatformServiceConfig` 在 app 容器内完成，走正常校验与写入路径）：`data/services.prod.json` 的 `ailink` provider 已写入 API Key（仅存服务器，不入库）；**未改动任何现有路由**（`nori::norivideo2.5` 仍为 `huimengi::seedance-2.5` 等）。写入前备份 `backups/20261125-ailink-seedance/services.prod.before-ailink.json`。
- 健康验证：`probeProviderHealth('ailink')` = healthy（479ms，发现 3 个模型）；admin 容器同样读到 ailink key；公网 sign-in 200；切换后新任务已正常 completed。
- **选择器可见性**：与 TGG 相同机制，画布/工具箱的模型选择器按业务模型路由过滤。要看到 AILink，需在管理后台把某个视频业务模型的路由指到 `ailink::doubao-seedance-2-5`（或 `-flash`），或后续在 `nori-model-catalog.ts` 增加 AILink 专属业务模型。本次未改默认路由。
- 回滚：`norivideo:release-20261125-canvas-mention-poster-hotfix` 重新 tag 为 latest 并 force-recreate app/admin；无数据库变更。
- 备份：`/opt/norivideo/backups/20261125-ailink-seedance/`。
- 本地补丁备份：`.runtime/ailink-seedance-20261125.patch`。
- 遗留：AILink key 仅配置在服务器；上线后未跑真实生成冒烟（消耗测试金，需用户批准）；`382f09a` 及本次改动均未提交/推送。
