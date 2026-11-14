# 2026-11-14 批次 1a：成员积分准备与团队管理

## 变更范围

- 功能提交：`9269539 feat: prepare member credits and unify team management`。
- 恢复单个积分分配，增加原子、幂等的批量分配；分配、收回与批量分配统一按用户 ID 排序锁定账户行。
- 成员消费与流水按点击者隔离，兼容管理账号历史代付；代付行不返回管理账号变动后余额。团队报表包含全部直属账号。
- 子账号管理与工作监督合并为一个「团队管理」入口，页内保留「成员与积分｜工作监督」标签。
- 本批仍为共享钱包：成员生成实际从管理账号扣积分，不启用「谁点生成谁付」。

## 本地验证

- 从提交的暂存快照运行 E1/C 聚焦测试：8 个测试文件、46 项通过。
- 隔离 TypeScript 检查通过。完整工作区 tsc 仅报告未修改的 Finder 重复文件，无本批新增错误。
- `git diff --check` 通过。

## 测试机

- 部署：2026-11-14 21:38–21:41（UTC+8），`45.76.215.9`。
- 部署源码严格来自 `9269539` 的 `git archive`，共 2735 个 tracked paths，无额外 worktree 或测试产物。
- 源码包 SHA-256：`4280232ce16e6c5dfe9a511c0c81b385bb151e36d85a213615b3f3a51ff606a0`。
- `next build` 与 Prisma schema 检查成功，无 schema 变更；`web`、`worker`、`watchdog`、`board` 均已重启并处于 active。
- 验收脚本：`test-results/ux-audit/batch-1a/acceptance.mjs`。
- 结果文件：`test-results/ux-audit/batch-1a/results.json`。
- 通过：测试管理员名下单个分配 100 积分；两名成员各批量分配 10 积分；重复 userId 去重；同幂等键重放不重复扣款；本次分配全部收回，双方金额与初始余额一致。
- 通过：流水同时包含分配双方记录；管理账号与成员页面的共享钱包余额一致，未启用 E2 的本人钱包字段。
- 通过：侧栏只有一个「团队管理」入口；「成员与积分」与「工作监督」标签双向切换；成员勾选与批量分配表单有效。
- 通过：成员只看到自己的记录及历史代付行；所有代付行的 `balanceAfter` 均为 null，消费接口可用。
- 截图：`test-results/ux-audit/batch-1a/01-members.png`、`02-activity.png`、`03-bulk-dialog.png`、`04-member-records.png`。
- 偏差：成员 self 范围包含本人与管理账号之间的分配流水，使用 `description.counterpartId` 兼容历史记录；停用成员历史仍保留在团队报表。验收按账号当前余额计算收回额，未清空测试成员的既有积分。未执行付费生成。

## 生产

尚未部署；等待用户明确放行。
