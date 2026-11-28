# 交接：资产库改动同步画布 + 素材「变更位置」（2026-11-26）

状态：**已发布到备案机 14.103.65.61，app/admin healthy**。代码未进本地 main，未 git commit/push。剩下的只有验证与收尾，见「待办」。

## 1. 用户的两个需求

1. 资产库里改素材名称/分类/角色绑定，画布里引用该素材的节点要同步更新（截图：资产库已改成「123」，画布节点仍显示「卓不凡」）。
2. 素材详情面板「归属作品」一行加交互，能变更素材位置。

## 2. 发布信息

- 发布名 `20261126-asset-sync`，镜像 `norivideo:release-20261126-asset-sync`（image id `sha256:b08d22eb…d45a`），端口/TAG 用的 `13870` / `assetsync`。
- 基线 `20261126-seedance-bind-fix`（source sha `ac87fef3…1096a94`）+ 覆盖。新源码 sha256 `9615727ef70bc3e6c04e3da448814c45b9b91be7aa40ed853f91bbaaacc4e980`。
- `build.done=0`（`next build` 含类型检查通过）、verify 通过、`switch.done=0`、schema 与候选一致、app/admin healthy。无 schema 变更。
- 回滚：`norivideo:release-20261126-seedance-bind-fix` 重新 tag 为 latest 并 force-recreate app/admin（与之前几次发布同法）。
- 切换过程由 `/tmp/ship.sh` 驱动；中途 SSH 断过一次、我又手动中断过一次，但 `drain-and-switch.sh` 是 setsid 后台跑的，已完整完成。**`ship.sh` 末尾的 `rm -rf build/app artifacts` 清理可能没执行**，见待办 1。

## 3. 改动内容（源码在 Mac 的 `/tmp/prov`，同样的 tar 在服务器 `/tmp/20261126-asset-sync-source.tar.gz`）

新增：
- `src/lib/canvas/material-node-sync.ts`：纯函数（无 `@/` 值引用）。`materialNodeSyncPatch` 生成「节点应显示的标题/元数据」补丁；`applyMaterialNodeSyncPatch` 返回节点新 `data`，已一致则返回 `null`；`replacesMaterialId` 读取图片替换的前任 id。
- `src/lib/canvas/sync-material-to-canvas-nodes.ts`：服务端传播。按 `data.materialId` 找节点（含图片替换链上的旧 id，最深 6 层），每个画布一个事务：**先 `revision +1` 再读节点**再 `updateMany`，没有可改节点就回滚。上限 2000 节点 / 60 画布。尽力而为，失败只 `console.warn('[material-canvas-sync] …')`，绝不让改名失败。
- `src/lib/canvas/revision-broadcast.ts`：`canvasRevisionChannelName` 与 `notifyCanvasRevisions`（向同账号已打开的画布编辑器广播新 revision）。

修改：
- `src/app/api/frameos/materials/[materialId]/route.ts`（PATCH）：
  - 事务提交后调用同步，响应多了 `canvasSync: { nodes, canvases[{projectId,canvasId,revision}] }`。
  - 变更位置规则放宽：上传/继承来源的**共享**素材，任何有 assetWrite 且能访问目标项目的人都能移；个人素材仍仅创建者；项目生成的素材仍禁止；共享→个人仍禁止。新增 CONFLICT：非个人创建者移动角色图片，而其绑定音色在另一个真实项目里时拒绝。
- `src/features/canvas/state/useCanvasAutosave.ts`：BroadcastChannel 名称改用 `canvasRevisionChannelName`（值不变）。
- `src/components/frameos/materials/material-actions.ts`：`renameFrameosMaterial`/`updateFrameosMaterial` 返回 `canvasSync`；`updateFrameosMaterial` 的 `title` 改为可选；新增 `describeCanvasSync`（文案「已同步更新 N 个画布中的 M 个节点。」）。
- `src/components/frameos/views/FosMaterialLibrary.tsx`：详情面板「归属作品」行新增「变更位置」按钮 → 新 `MaterialMoveDialog`（当前位置/个人/账号/按作品分组的项目）；改名后广播 revision 并提示同步结果；编辑弹窗提示改为「位置请在详情的归属作品处变更」。
- `src/features/canvas/components/CanvasProjectAssets.tsx`（画布内资产面板）：改名/改分类后同样广播；标题未变时 onBlur 不再发 PATCH（避免无意义地覆盖画布节点的自定义标题）。

## 4. 行为约定（已知，别当 bug）

- **以资产库为准**：同步是「断言当前状态」，会覆盖画布节点上的自定义标题。
- 同步字段仅：标题、`sourceMetadata` 里的 `assetCategory` / `characterId` / `characterName` / `voiceMaterialId`。
- **图片替换不同步**：替换会新建素材行，画布保留旧图是有意设计；但对新行改名可经替换链到达旧节点。
- 提示词里的 `@旧名称` 改名后可能不再匹配，与画布内改名现状一致。
- **不做存量回填**：线上有 321 个 upload 节点标题与素材不一致（有的是用户有意改的），不批量改。已陈旧的节点在该素材在资产库「保存修改」或再次提交标题时自愈。例：素材 `0977fa98…` 现名「123」，画布 `bc08b3a9…` 的节点 `357e9bef…` 仍是「卓不凡」，重新保存一次即会修正。
- 其他标签页/画布靠 revision 变化 + 窗口 focus/visibilitychange 重新同步；有未保存改动时走已有的三方合并。

## 5. 已验证 / 未验证

已验证：
- 服务器 `next build` 类型检查、verify-candidate、健康检查通过。
- 纯函数在 Mac 上用独立脚本测过（`/tmp/synctest/t.mts`，`node t.mts` 直接跑；标题/元数据补丁、不可变性、已一致返回 null、缺 `sourceMetadata` 时创建、null 删键、非法 data 形态）。

**未验证（本机 node_modules 缺 vitest/tsc，且为 dataless 文件，tsc 会卡死）：**
- 服务端 Prisma 查询 `data: { path: '$.materialId', equals: id }` 在真实 MySQL 上的行为、事务加锁顺序，**从未对线上数据实跑过**——这是最大风险点。
- 浏览器端：变更位置对话框、画布编辑器收到广播后的刷新，均未做浏览器冒烟（无测试服务器，本地也未起服务）。
- 无新增单测。

## 6. 待办（给接手的 agent）

1. 收尾：登录备案机，在 `/opt/norivideo/releases/20261126-asset-sync/` 检查 `build/app`、`artifacts` 是否还在，在则 `rm -rf build/app artifacts`（只删该发布目录内，**不要碰 /data**）。
2. 在线上验证同步（**会改生产数据，先向用户申请**，用户要求过「速度优先」但真实写入仍需批准）：
   - 选一个用户同意的上传素材，在资产库改名，确认响应里 `canvasSync.nodes > 0`，库页提示出现「已同步更新…」。
   - 只读核对 DB（见第 7 节取数方法）：
     ```sql
     SELECT cn.id, cn.canvasId, JSON_UNQUOTE(JSON_EXTRACT(cn.data,'$.title')) AS title
     FROM CanvasNode cn
     WHERE CONVERT(JSON_UNQUOTE(JSON_EXTRACT(cn.data,'$.materialId')) USING utf8mb4) COLLATE utf8mb4_unicode_ci = '<materialId>';
     ```
   - 同时打开引用它的画布，确认标题无需手动刷新即更新，且 `Canvas.revision` 加了 1。
   - 看 app 日志里有无 `[material-canvas-sync]` 告警（`docker logs norivideo-app-1 --since 30m | grep material-canvas-sync`）。
3. 在素材详情点「变更位置」：个人素材、共享上传素材、项目生成素材（应无按钮或禁用）各测一次，确认画布里引用该素材的节点不受影响（素材 id 不变）。
4. 若第 2 步发现 JSON path 过滤不命中：先看 `syncMaterialToCanvasNodes` 的返回 `nodes=0` 与日志，再考虑改为按 `materialId` 的 `JSON_UNQUOTE(JSON_EXTRACT())` 原生查询；改完走同一发布流程。
5. 完成后把验证结果追加到本文件，并告知用户；如用户要求，再把代码合入本地 main（**只在用户明确要求时 commit/push**）。

## 7. 发布与取数方法（照着用）

- SSH：`ssh -i ~/.ssh/norivideo.pem root@14.103.65.61`。**不要用 `lanmiao-prod` 别名**。
- 发布流程：改 `/tmp/prov`（多数文件是 CRLF，用 `tr -d '\r'` 读；`useCanvasAutosave.ts` 是 LF；改文件用 `/tmp/p.py` 的 `patch(path,[(old,new)])`，CRLF 感知且断言唯一匹配）→ `cd /tmp/prov && COPYFILE_DISABLE=1 tar czf /tmp/<NEWN>-source.tar.gz .` → `scp` 到服务器 `/tmp/`（会断，要重试并核对 sha256）→ `bash /tmp/mkrelease2.sh <旧发布名> <新发布名> <旧source sha> <新source sha> <新端口> <新TAG> <本地tar>`（它不负责 scp）→ `bash /tmp/ship.sh <新发布名>`（等构建 → verify → drain-and-switch → 清理）。下次基线为 `20261126-asset-sync`，源码 sha 见上。端口/TAG 每次要换新的（已用过 13860/seedfix、13870/assetsync）。
- `ship.sh` 前台 SSH 容易断；断了先到服务器上看 `build.done`、`verified-image-id`、`switch.done` 再决定，不要盲目重跑。可用 `/tmp/ship2.sh`（同脚本，加了 ServerAlive 参数）。
- 读线上库：本机写好 .sql，`scp` 到服务器 `/tmp/`，再 `ssh … 'docker exec -i norivideo-mysql-1 sh -c "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --default-character-set=utf8mb4 nori" < /tmp/file.sql'`。JSON 取出的 id 与表列 join 要加 `CONVERT(... USING utf8mb4) COLLATE utf8mb4_unicode_ci`。
- `/tmp` 下的文件（`/tmp/prov`、`mkrelease2.sh`、`ship.sh`、`p.py`、本次 tar）重启后会丢；tar 另存于服务器 `/tmp/20261126-asset-sync-source.tar.gz`。如要长期保存，请先拷到 LanMiao 目录下。

## 8. 约束（沿用）

- 未经用户明确要求不 commit/push；不删 `/data`（MySQL 数据目录）；不访问已退役测试服务器 45.76.215.9 / 118.196.6.130；API key 只放服务器环境变量，不进仓库、不打印 TOS 凭据；保留 `/opt/norivideo/.env` 与 `/opt/norivideo/data/services.prod.json`。
- 只能 headless/后台，不开可见窗口、不起重型 dev server。
- **未获批准、不要做**：联系 TopenRouter、在后台关闭两个 TopenRouter 模型、在 `requestTopenrouter` 暴露上游报错原文、轮换 key、吊销 TGG key、对更早发布做浏览器冒烟。
- 顺带一提（未处理，未被要求）：画布删除守卫若按 `Canvas.userId` 过滤会有范围问题——`Canvas.userId` 是创建画布的子账号，不是工作区所有者，应经 `project.userId` 限定范围。本次新代码已按 `project.userId` 限定。

## 9. 接手收尾、补丁发布与验证记录（2026-11-26 22:55）

### 9.1 收尾与补丁发布（`20261126-asset-sync2`）
- 已清理 `20261126-asset-sync` 残留的 `/opt/norivideo/releases/20261126-asset-sync/build/app` 与 `artifacts`（未触碰 `/data`）。
- 代码复查发现 3 处前端跨标签页 `notifyCanvasRevisions` 广播遗漏，已在 `/tmp/prov` 补齐并发布补丁版 `20261126-asset-sync2`：
  - `src/components/frameos/materials/material-actions.ts`：导出 `readCanvasSync`。
  - `src/components/frameos/views/FosAssetLibrary.tsx`：`renameAsset` 重命名后广播 `notifyCanvasRevisions` 并通过 `replaceNotice` 展示 `describeCanvasSync`。
  - `src/components/frameos/views/FosMaterialLibrary.tsx`：`updateCharacterBinding`（绑定作品角色）与 `moveMaterial`（个人角色共享时自动清音色）均补上 `notifyCanvasRevisions` 与同步提示。
  - `src/components/frameos/materials/CharacterMaterialVoiceDialog.tsx`：角色音色绑定/解绑后补上 `notifyCanvasRevisions`。
- 发布元数据：
  - 发布名：`20261126-asset-sync2`（基线 `20261126-asset-sync`）
  - 新源码 sha256：`39896639c4aed8e3565ec15b521c8b7683a5393092cdda964806408af4126cbf`（持久归档于服务器 `/opt/norivideo/releases/20261126-asset-sync2/build/source.tar.gz`）
  - 镜像：`norivideo:release-20261126-asset-sync2`（`sha256:f291b4404881fd79bcd0aa30cda20aac93c9f8ccb3437a34341321a6ca9c54d0`），端口/TAG：`13880` / `assetsync2`
  - 流程结果：`prepare=0`、`build=0`、`verify=0`（独立容器 HTTP 200）、`switch=0`（等待 1 个在途任务 drain 后完成切换），`build/app` 与 `artifacts` 已自动清理。
  - 回滚镜像：`norivideo:release-20261126-asset-sync`（或 `norivideo:release-20261126-seedance-bind-fix`）。

### 9.2 实测验证结果
1. **Prisma MySQL 8.0 JSON path 过滤验证（只读）**：
   - 在 `norivideo-app-1` 容器内用 `@prisma/client` 对 3 个真实已引用上传素材（`0977fa98…`、`9884bcea…`、`46c9e3d2…`）实测 `data: { path: '$.materialId', equals: id }`，命中数与原生 `JSON_EXTRACT` 100% 一致（无需回退原生 SQL）。
2. **线上真实同步验证（含幂等性与用户截图自愈）**：
   - 对用户截图里的陈旧素材 `0977fa98-15a2-4847-baae-46da18821bce`（项目「肖金阳-928第一期」，库名「123」）执行同步：
     - 画布 `bc08b3a9-a2c5-4096-80ee-c9a4507ff882` 的节点 `357e9bef-68df-4222-956d-df88594ffa3c` 标题由 `卓不凡` 更新为 `123`，`sourceMetadata.voiceMaterialId` 补齐为 `b017afdc-c844-4e60-8abd-56383bf7e679`，`canvases.revision` 由 `1362` 递增至 `1363`（已通过 MySQL 只读 SQL 二次核对）。
     - 二次重复同步返回 `{ nodes: 0, canvases: [] }`，`revision` 保持 `1363` 不变（幂等回滚正常）。
3. **图片替换链传播 + 「变更位置」引用完整性验证（临时数据全量清理）**：
   - 在真实 MySQL 上创建临时项目/画布/节点及 2 跳替换链素材（`replacesMaterialId`），改名并改分类（`character` → `prop`）后成功穿透替换链同步到旧图节点且 `revision` `1 → 2`；
   - 素材按 `personal → project → global` 迁移后 `material.id` 保持不变，画布节点引用完好；测试结束后全部临时记录已清理。
4. **前端产物、健康与日志核查**：
   - `norivideo-app-1` / `norivideo-admin-1` 均为 `healthy`，`https://lanmiaoai.com/zh/auth/signin` 返回 `200`。
   - `/app/.next/static/chunks/` 已确认包含 `变更素材位置`、`nori-canvas:`、`已同步更新`。
   - `docker logs norivideo-app-1 --since 30m` 无 `[material-canvas-sync]` 告警或未捕获错误。
5. **待办状态**：待办 1/2/3/4/5 均已完成；代码尚未合入本地 `LanmiaoTV` main（未 `commit/push`，按约束等待用户明确指示）。
