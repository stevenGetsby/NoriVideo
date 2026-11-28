# 备案机修复影游画布重进后显示已删除节点（2026-11-26）

- 症状：删除节点并保存后离开，再进入画布仍显示已删除节点；随便点一下后节点才消失。
- 根因：`useCanvasGraph`（react-query）缓存了进入前的画布图，保存并不更新该缓存；全局默认 `staleTime` 5s / `gcTime` 10min，重进时先用旧缓存渲染 `CanvasEditor initialGraph`，随后后台刷新/一次交互才拿到新数据。
- 修复：只改 `src/features/canvas/state/useCanvasSync.ts`，该 query 设 `staleTime: 0`、`gcTime: 0`、`refetchOnMount: 'always'`、`refetchOnWindowFocus: false`，进入画布始终读取服务器最新版本。
- 基线：线上 `release-20261126-canvas-edge-dedupe-fix`（image `1d117ae7fca8`）的 source.tar.gz + 仅覆盖该文件。源码 sha256 `2ef4f055…`。
- 候选/切换：`norivideo:release-20261126-canvas-cache-fix`（image `4ad54833204d`）；verify 通过；`drain-and-switch.sh` → `switch.done=0`，app/admin healthy，nginx 已恢复。
- 备份：`/opt/norivideo/backups/20261126-canvas-cache-fix/`。
- 回滚：`norivideo:release-20261126-canvas-edge-dedupe-fix` 重新 tag 为 latest 并 force-recreate app/admin；无 schema 变更。
- 遗留：未做真实浏览器的「删除→保存→离开→重进」冒烟，需用户验证。
