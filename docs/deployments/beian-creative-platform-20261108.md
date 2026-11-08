# 2026-11-08 创作平台权限、画布与影游重构

## 发布内容

- 子账号移除创作功能模板，工作区级项目组长由 `User.projectLeader` 表达；项目成员、作品创建与删除边界由服务端统一校验。
- 创建作品简化为画布/工作流入口，工具箱和素材按业务项目隔离，共享项目资产。
- 画布支持图片宫格切分、视频音频区间提取、全局风格同步、两级 @ 引用、粘贴资产匹配及滚轮/中键操作；旧 `VIDEO_FRAME` 草稿仅迁移为 `REF`，服务端仍拒绝未知角色。
- 影游保留剧情分支并增加线性作品片段和下钻制作画布；旧视频转绘恢复为编剧台的一部分。
- OpenLux 图片模型与定价使用受控目录，未定价模型在生成前拒绝；界面移除装饰性渐变。
- 全量 ESLint 为 0 errors / 0 warnings；修复显式 `any`、未使用变量、hooks 依赖和动态图片警告，未关闭源码规则。

## 验证

- TypeScript `tsc --noEmit --pretty false` 通过。
- 完整单元测试：523 文件、2458 项通过。
- 完整 API/集成/回归：72 文件、459 项通过，6 文件、23 项按既有条件跳过；测试显式使用隔离 MySQL/Redis。
- system/regression：8 文件、13 项通过；真实 billing/concurrency 套件通过。
- 真实 headless Chromium 通过项目层级、账号项目权限、素材交互、影游三层、编剧台转绘和五组 IndexedDB 恢复。
- 完整画布真实 Chromium 回归通过：多分辨率下生成节点复用、对照连线、拖动隐藏与尺寸恢复、全局风格唯一与同步、两级 @、粘贴绑定、音频区间、截帧、滚轮/中键、宫格切分、引用/参数/音频/预览/右键菜单及窄屏边界均通过。
- Prisma validate、模型目录/计费、路由契约、无装饰渐变、固定 TOS、生成补偿等静态守卫和 `git diff --check` 通过。
- 未运行真实付费 OpenLux/绘梦生成。

## 发布保护与回滚

- 源指纹：`715aa40620a6c33b884c67bf4952268ce4cd42cb19c0b3750ac0eae70b9f8363`。
- 生产备份位于 `/opt/norivideo/backups/20261108-creative-platform/`；受保护配置保持不变，切换前再次检查活动生成任务。
- schema 仅允许增量新增 `user.projectLeader`，使用受保护 `prisma migrate diff` 与 `prisma db push --skip-generate`；不覆盖生产业务数据。
- 服务器构建和候选镜像打包均使用 `--network none`；制品 SHA256 为 `abc07313998a27b402be381d91c58bc388588dd85f6596e48b71b750e5a7baca`。
- 候选镜像为 `norivideo:release-20261108-creative-platform`，镜像 ID 为 `sha256:07a23bd6416601403a5c8be6036fe8ef54625f6914aedf5be6410e62a9b7e8b6`；源指纹、架构、Prisma client/schema、画布新能力、音频提取和 OpenLux/HuiMeng 标准目录检查通过。
- 切换前预检仅返回 `ALTER TABLE user ADD COLUMN projectLeader BOOLEAN NOT NULL DEFAULT false`，活动生成任务为 0；切换后 schema diff 无差异，字段存在且未覆盖业务数据。
- app/admin 均为上述候选镜像且 healthy；固定 TOS 配置和实际上传/读取/签名读取/删除探测通过，受保护配置与备份逐字一致。
- billing=ENFORCE、test-mode=OFF；未登录访问 tasks/works/projects/admin/accounts/user/models 均为 401，用户和管理员登录页为 200；启动日志未发现未捕获、Prisma 或 fatal 错误。
- 切换失败时仅恢复 `norivideo:release-20261107-canvas-legacy-frame-recovery` 为 `norivideo:latest` 并重建 app/admin，不用旧备份覆盖业务数据库。
