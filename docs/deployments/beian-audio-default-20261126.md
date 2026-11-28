# 备案机视频生成默认有声（2026-11-26）

- 范围：所有视频生成入口在未显式选择时默认生成声音。无 schema 变更。
  - `src/lib/canvas/generator-options.ts`：`generateAudio` 由 `=== true` 改为 `!== false`（喵导等不带该参数的调用默认有声）。
  - `src/lib/workers/handlers/canvas-operation-task-handler.ts`：视频编辑任务同上。
  - `src/lib/model-capabilities/lookup.ts`：能力表自动补全优先选「开」（原优先「关」），对应单测改为 `generateAudio: true`。
  - `ailink` / `topenrouter` / `huimengi` 的 `video.ts`：调用方未传时，支持有声的模型显式发 `generate_audio: true`。新增 ailink 单测。
- 未改：画布生成器/工具箱/分镜面板/视频编辑节点开关初始值本就为开；Kuaizi 未传时不发该参数（所有应用入口都会传布尔值，实际有声）；`recommended-duration.ts` 中提示词含「无背景音乐」等会关闭声音，属原有设计。
- 基线：`release-20261126-remove-tgg`（source sha `63f370ce…`）+ 覆盖。新源码 sha256 `0fec490f…`。镜像 `norivideo:release-20261126-audio-default`，verify 通过，`switch.done=0`，app/admin healthy。切换前排空了 2 个进行中的生成任务。
- 回滚：`norivideo:release-20261126-remove-tgg` 重新 tag 为 latest 并 force-recreate app/admin。
- 遗留：未做真实生成验证（需在画布/工具箱用 TopenRouter 各生成一条，核对任务记录里 `generateAudio` 与成片是否有音轨）；上游 Seedance 2.5 在未传该参数时的默认行为未实测；代码未进本地 main。
