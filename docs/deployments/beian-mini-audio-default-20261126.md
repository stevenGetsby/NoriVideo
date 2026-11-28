# 备案机修复 Seedance 2.0 mini 生成声音默认关闭（2026-11-26）

- 范围：仅改 `standards/capabilities/image-video.catalog.json` 一个文件，无代码逻辑改动、无 schema 变化。
- 根因：`nori::seedance2.0-mini` 在该文件里的 entry 为 `supportGenerateAudio:false` 且无 `generateAudioOptions`。`resolveBuiltinCapabilitiesByModelKey('video','nori::seedance2.0-mini')` 按 `nori` provider 精确匹配到这条，**挡在 kuaizi.catalog.json 里正确的 mini（sga:true）前面**。结果：复选框 `disabled`（开关点不开）+ effect 强制 `setGenerateAudio(false)`，且该 false 被 `commitDraft` 写入节点，数据库里 10 个 mini 节点全是 `generateAudio:false`。同文件的 fast / 2.0 均为 `sga:true + gaOpts:[true,false]`，正常。
- 改动：mini entry 对齐 fast —— `supportGenerateAudio:false→true`，新增 `generateAudioOptions:[true,false]`。其余字段不动。
- **基线**：线上 latest = `release-20261125-canvas-reference-checkbox-hotfix`（image id ed002795a10a，source label `9c0d9ab7…`，upstream `2e42dfd7…`）。发布源码 = 该 release 的 `build/source.tar.gz` 解包 + 仅覆盖上述 1 个 standards 文件，`diff -rq` 确认全树只有这一个文件不同。本地 main 的其它未提交改动一律未包含。
- 构建：备案机离线 `--network none` 容器，基底 `norivideo:release-20261124-main-cdad110`，deps 复用 `20261122-seedance-prompt/node_modules.tar.gz`。源码 tar sha256 `7738e2a3…`，artifacts sha256 `a82cf437…`。
- 候选：`norivideo:release-20261126-mini-audio-default`。`deploy.sh load` 全树校验通过；node 断言候选内 mini 为 `sga:true + gaOpts:[true,false]`（`mini audio defaults OK`）；独立 web 预检 13851 端口 sign-in 200。
- 切换：`drain-and-switch.sh` 拦截新生成 → 队列排空 → `deploy.sh switch 7738e2a3…`（schema diff 为空、备份、健康检查、失败自动回滚）。`switch.done=0`，app/admin 均 healthy，nginx 已恢复。latest 与 candidate 同 id `66db3a5c…`。
- 上线后运行时验证：app 容器内 `resolveBuiltinCapabilitiesByModelKey` 实测 mini = `{sga:true, gaOpts:[true,false]}`，norivideo2.5 / 2.0-fast 亦正常。公网 sign-in 200。
- 数据库修复（用户批准）：将 10 个 `nori::seedance2.0-mini` 视频节点的 `data.generation.generateAudio` 由 `false` 改为 `true`（`JSON_SET`，仅该字段）。改前已备份至 `backups/20261126-mini-audio/mini-nodes-before.tsv`（10 行）。改后复查全部为 true。
- 备份：`/opt/norivideo/backups/20261126-mini-audio-default/`（protected files + nori.sql.gz + nori-pre-switch.sql.gz）。
- 回滚：`norivideo:release-20261125-canvas-reference-checkbox-hotfix` 重新 tag 为 latest 并 force-recreate app/admin；数据库如需回滚用上述 tsv 还原。无 schema 变更。
- 注意：standards 运行时从 `/app/standards` 读取，本次已通过 Artifact.Dockerfile 的 `COPY standards ./standards` 打入候选，非仅代码。
- 遗留：本地 main 该 standards 改动未提交/推送；AILink 及画布等历史未提交改动维持原状。
