# 备案机对齐 caoshuang 资产绑定写法（2026-11-26）

- 范围：`src/lib/novel-promotion/seedance-prompt-assets.ts` 与 caoshuang 分支 `fix/asset-match-scope-and-capacity`（c7f86a1）对齐两处。无 schema 变更。
  - 图序号：`indexedAssets` 用素材在数组中的位置 `index + 1`（原为去重后 `result.length + 1`）。
  - 纯数字名判断：直接绑定改用 `isBarePromptName`（`\p{Nd}`，含全角数字），删除自写的 `isBareBindableName` 与未使用的 `replaceOutsideQuotes`。
- 基线：`release-20261126-audio-default`（source sha `0fec490f…`）+ 覆盖。新源码 sha256 `ac87fef3…`。镜像 `norivideo:release-20261126-seedance-bind-fix`，verify 通过，`switch.done=0`，app/admin healthy。
- 回滚：`norivideo:release-20261126-audio-default` 重新 tag 为 latest 并 force-recreate app/admin。
- 遗留：本机 node_modules 缺 vitest，未跑单测；只用 node 做了独立脚本冒烟（编号、台词保护、全角数字名不再裸绑）。线上仍比 caoshuang 分支多出未识别 @ 报错、无源素材报错、声音解绑、个人素材范围等改动；这些改动与她的分支均未进本地 main。
