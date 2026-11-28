# 备案机发布 frameos-picker a2f71e2（2026-11-24）

- 范围：单个提交 `a2f71e2ba23b3e3defe6782c3ad46e6b2e7e1437`「fix(frameos): 素材选择器卡片按网格排列，工具箱产物归属创建者个人」，叠加在线上 `cdad110` 之上。仅 11 个文件改动，无依赖、无 schema 变化。
- 修复一（素材选择器错位）：`MaterialPickerDialog.tsx` 卡片样式补回内联 `position: 'absolute'`（`frameos-replica.css` 的 `.material-picker-card { position: relative }` 覆盖 Tailwind `absolute` 工具类），top 改为 `Math.floor(index / columnCount) * rowStride`（原写法把行偏移多除了一次列数）。`tests/browser/material-picker-small-viewport.browser.mjs` 新增逐卡片行/列对齐断言，已验证修复后通过、回退后失败。
- 修复二（工具箱素材互相可见，按用户选定 B 方案）：新工具箱产物登记为创建者的个人素材（`projectId='personal'`、`personalOwnerId=actorId`），成员之间不再互相可见。路由 `api/frameos/toolbox/generate` 在 image/video/audio/model3d 四类 payload 写入 `personalOwnerId: workspaceActor.actorId`；worker 端新增 `src/lib/frameos/material-ownership.ts` 的 `ownedMaterialScope`，在 `registerFrameosMaterial` 时决定个人/项目作用域，去重键随作用域变化。**历史共享行不迁移**，仍按原作用域展示。
- 基线：线上 `norivideo:release-20261124-main-cdad110`（`sha256:71bcf4aa0e88…`，源码指纹 `ae83ccaa…`）。
- 候选：`norivideo:release-20261124-frameos-picker`（`sha256:ce2d4b2eca66…`，amd64），镜像标签 `org.norivideo.upstream-commit=a2f71e2`、`org.norivideo.source-sha256=9e331354…`（3,214 个受控文件），产物包 sha256 `ef249d7e…`。
- 构建：离线 `--network none` 容器内 `npm run build`。基线镜像 480 层超过 overlayfs 挂载上限（BuildKit 与 classic builder 均失败），先 `docker export | docker import --change` 生成同配置单层基座 `norivideo:base-flat-20261124-main-cdad110` 作为构建基底；仅用于构建，线上标签不受影响。
- 切换：2026-11-24 11:48–11:50（北京时间）。`wait-switch.sh` 每 45 秒轮询活动生成任务，11:48:28 队列清空后自动执行 `deploy.sh switch`，`SWITCH_EXIT=0`。切换窗口无被中断的生成任务。
- 验证：app/admin 均运行候选镜像且 healthy；受保护配置逐字节一致、schema diff 为空；TOS 固定桶 guard 与 probe 通过；`BILLING_MODE=ENFORCE`、test-mode=OFF；`/api/projects` 未登录 401；切换后工具箱视频 worker 正常接单、推进度，无新增异常。
- 上线后日志中既有的两类业务错误（非本次引入）：`/api/storage/sign` 参数校验 `INVALID_PARAMS`；画布生成 `Unsupported video capability pricing: aspectRatio=adaptive`（12:01 起 5 次，属既有画布生成/定价问题，建议另行定位）。
- 回滚：上一镜像 `norivideo:release-20261124-main-cdad110`（`sha256:71bcf4aa…`），无数据库变更，可直接切回。
  - 命令：`docker tag norivideo:release-20261124-main-cdad110 norivideo:latest && cd /opt/norivideo && docker compose --env-file .deploy.env -f docker-compose.prod.yml up -d --no-deps --no-build --pull never --force-recreate app admin`
- 备份：`/opt/norivideo/backups/20261124-frameos-picker/`（`nori.sql.gz`、受保护配置副本、`previous-image-id`）。
- 发布目录：`/opt/norivideo/releases/20261124-frameos-picker/`（`deploy.sh`、`build-in-container.sh`、`Artifact.Dockerfile`、`application-artifacts.tar.gz`、`switch.log`、`switch.done`）。
- 遗留事项：历史共享工具箱行是否迁移到个人素材待用户决定；`CanvasReferencePickerDialog.tsx` 存在同类 top 计算写法，尚未排查；`a2f71e2` 尚未推送 origin。
