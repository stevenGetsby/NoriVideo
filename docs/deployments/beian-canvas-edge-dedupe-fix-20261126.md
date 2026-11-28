# 备案机修复影游画布删除节点永远保存失败（2026-11-26）

- 症状：影游画布（canvas `8b7305a1…`，项目 `25c7b7e8…`）删除节点后 Ctrl+S、退出再回来，部分节点仍在。
- 根因：该画布库里有一对历史重复连线（`1608f7e0…` 与 `fad2e55f…`，源/目标/handle 完全相同）。服务端 `persistence.ts` 的 ops 保存在最后做全量唯一性校验，命中旧重复连线就抛 `连线 … 与现有连线重复`（INVALID_PARAMS），整批 ops（含删除）被拒，客户端每秒重试。该画布 revision 停在 9159，最后一次成功保存是 11-24 07:46，之后所有编辑都没落库。上一版「离线恢复」修复不涉及这条路径。全库仅此一个画布有重复连线。
- 修复：只改 `src/lib/canvas/persistence.ts` 的唯一性校验。本次 ops 新增的连线与现有连线重复仍报错；存量历史重复连线不再让整批失败，而是随本次保存一并删除（`deletedEdgeIds`）。
- 基线：线上 `release-20261126-canvas-offline-delete-fix` 的 source.tar.gz + 仅覆盖该文件（注意线上该文件为 CRLF，本地 main 版本与线上不同，因此是在线上副本上做最小补丁，`diff` 只有这一处）。
- 构建：备案机离线容器，基底 `release-20261126-canvas-offline-delete-fix`。源码 sha256 `36da8858…`，产物 sha256 `c8526f5b…`。
- 候选：`norivideo:release-20261126-canvas-edge-dedupe-fix`；verify 通过（web 预检 13854 sign-in 200）。
- 切换：`drain-and-switch.sh` → `switch.done=0`，app/admin healthy，nginx 已恢复。
- 备份：`/opt/norivideo/backups/20261126-canvas-edge-dedupe-fix/`。
- 回滚：`norivideo:release-20261126-canvas-offline-delete-fix` 重新 tag 为 latest 并 force-recreate app/admin；无 schema 变更。
- 遗留：本地 main 的 `persistence.ts` 未包含该补丁（本地版本与线上不同源），下次发布仍以线上 source.tar.gz 为基线。重复连线首次被清理发生在用户下一次保存该画布时。
