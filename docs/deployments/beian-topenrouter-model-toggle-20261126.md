# 备案机发布 TopenRouter Seedance 2.5 + 视频模型开关制（2026-11-26）

- 范围：新增第五个视频上游 TopenRouter（火山官方协议，`https://tp-api.chinadatapay.com:8000`，模型 `doubao-seedance-2-5-260628` / `-exp`）；管理端视频模型由「业务模型→服务商映射」改为逐模型开关；所有 Seedance 2.5 统一官方价；用量按实际服务商区分。无 schema 变更。
- 开关制：`services.prod.json` 的 `llm.modelEnabled`（`provider::modelId → boolean`）。未保存过开关的模型，沿用当前路由指向的模型为开启（旧部署行为不变）。创作端视频选择器直接列出「已开启且服务商有密钥」的 `provider::modelId`；旧 `nori::*` 键经 `modelAliases` 映射到当前路由目标。`resolveModelSelection` 对已知视频模型：未开启则抛 `MODEL_NOT_ADMIN_ENABLED`。文本/图片/语音仍按原路由。
- 计价：huimengi `seedance-2.5` 改为官方 70/42/77/46；topenrouter、ailink、kuaizi 均同表（元/百万 token，无视频输入 70/77，含视频输入 42/46）。**TGG 2.5 仍是按秒计价，未统一**。用量记录按实际 `provider::model` 写入，管理页按服务商分别汇总。
- 基线：`release-20261126-canvas-cache-fix`（source sha `2ef4f055…`）+ 覆盖。新源码 sha256 `7fd58d4b…`。镜像 `norivideo:release-20261126-topenrouter-model-toggle`，verify 通过，`switch.done=0`，app/admin healthy。
- 服务器配置（仅服务器，不入库）：`/opt/norivideo/data/services.prod.json` 新增 topenrouter provider 及 API Key；开启 `topenrouter::doubao-seedance-2-5-260628` 与 `-exp`。改前备份 `backups/20261126-topenrouter-model-toggle/services.prod.before-topenrouter.json`。`/v1/models` 实测 200。
- 回滚：`norivideo:release-20261126-canvas-cache-fix` 重新 tag 为 latest 并 force-recreate app/admin；配置回滚用上述备份。
- 遗留：未做真实生成冒烟（消耗额度，需批准）；`lib/canvas/operation-task.ts` 仍硬编码 `nori::norivideo2.5`，依赖 kuaizi 2.5 开启；聊天中暴露过的 TopenRouter / AILink Key 建议轮换；本地 main 未包含这些改动。
