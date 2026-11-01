# 备案机部署：作用域权限机制（2026-11-01）

## 概要

上线三层权限机制：管理员（全工作区权限，可配置组长/子用户权限）、项目组长（默认组长预设，可立项、分配人员、管理/删除项目内全部作品，删除进回收站可恢复）、生成师/子用户（按功能权限包区分的共享框架，可在参与项目内创建作品，仅可编辑/删除自己的作品，不自动因项目成员身份获得他人作品管理权）。

- 提交：`63f12ae feat: scope work and project permissions with member roles and overrides`
- 源指纹：`adfe624f19c3e7c7e18a04566bf9b35481a75fa6f2f67bc47aee147cf9370e49`
- 产物：`3ee78449443fa93b73930eb9922ada56a0cfe90ad90e38cede1e533a68ef6dfb`
- 镜像：`norivideo:release-20261101-scoped-permissions`
- 上一镜像：`norivideo:release-20261031-cover-recycle-usage`

## 变更要点

- 账号级 `workCreate` 权限控制立项（默认仅管理员，按账号单独开关）。
- 工作区成员 `role`/`permissions` 覆盖；历史 `NULL` 走角色预设，`manager`/`canManage=true` 仍视为组长。
- 作品成员 `role`/`permissions` 覆盖；`owner` 角色 = 作品负责人。
- 权限键：projectCreate、workManage、workMemberManage、workDelete、projectManage、projectMemberManage、projectDelete、projectMove、assignmentManage、assignmentReview。
- 组长删除项目内任意作品进回收站；项目内成员仅能删除自己的作品。

## 数据库

增量 schema 同步（`prisma db push`），新增 3 列：

- `work_members.permissions` (JSON)
- `project_members.role` (VARCHAR)
- `project_members.permissions` (JSON)

无破坏性变更，无需回填。

## 部署验证

- 构建在 `--network none` 容器内完成。
- prepare：保护文件与业务数据库已备份，线上服务未变。
- load：候选镜像源指纹、架构、prisma client 校验通过。
- switch：schema diff 仅增量、无活跃生成任务；app/admin 健康检查通过；billing=ENFORCE、test-mode=OFF；登录页 200。
- 回滚路径：保留 `norivideo:release-20261031-cover-recycle-usage` 与切换前数据库 dump（`/opt/norivideo/backups/20261101-scoped-permissions/nori-pre-switch.sql.gz`）。

## 注意

- 部署后新组长/子用户默认走角色预设；历史成员（permissions 为 NULL）行为不变。
- 组长权限被显式收窄时立即生效（按 `permissions` 数组判断）。
